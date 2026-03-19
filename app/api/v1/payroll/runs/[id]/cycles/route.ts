import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { evaluatePreparePayoutAction } from "../../../../../../../lib/payroll/cycle-policy";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import type { PayrollCycle, PreparePayoutResponseData } from "../../../../../../../types/payroll-runs";
import {
  buildMeta,
  canViewPayroll,
  jsonResponse,
  PAYROLL_CYCLE_SELECT_COLUMNS,
  PAYROLL_RUN_SELECT_COLUMNS,
  payrollCycleRowSchema,
  payrollRunRowSchema,
  toPayrollCycleSummary,
  toPayrollRunSummary
} from "../../../_helpers";

const preparePayoutBodySchema = z.object({
  overrideHolds: z.boolean().optional().default(false)
});

function formatPayPeriodLabel(startDate: string, endDate: string): string {
  try {
    const end = new Date(endDate + "T00:00:00Z");
    return end.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  } catch {
    return endDate.slice(0, 7);
  }
}

// ── GET: list cycles for a run ──────────────────────────────────────

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  if (!canViewPayroll(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "You are not allowed to view payout cycles." },
      meta: buildMeta()
    });
  }

  const { id: runId } = await params;

  try {
    const supabase = await createSupabaseServerClient();

    const { data: rawCycles, error: cyclesError } = await supabase
      .from("payroll_cycles")
      .select(PAYROLL_CYCLE_SELECT_COLUMNS)
      .eq("org_id", session.profile.org_id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    if (cyclesError) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "PAYROLL_CYCLE_FETCH_FAILED", message: "Unable to load payout cycles." },
        meta: buildMeta()
      });
    }

    const parsed = z.array(payrollCycleRowSchema).safeParse(rawCycles ?? []);

    if (!parsed.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "PAYROLL_CYCLE_PARSE_FAILED", message: "Payout cycle data is invalid." },
        meta: buildMeta()
      });
    }

    const cycles: PayrollCycle[] = parsed.data.map(toPayrollCycleSummary);

    return jsonResponse<{ cycles: PayrollCycle[] }>(200, {
      data: { cycles },
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYROLL_CYCLE_FETCH_FAILED",
        message: error instanceof Error ? error.message : "Unable to load payout cycles."
      },
      meta: buildMeta()
    });
  }
}

// ── POST: prepare payout (creates cycles from approved run) ─────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsedBody = preparePayoutBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: "Invalid request body." },
      meta: buildMeta()
    });
  }

  const { overrideHolds } = parsedBody.data;
  const { id: runId } = await params;
  const profile = session.profile;

  try {
    const supabase = await createSupabaseServerClient();

    // Load the run
    const { data: rawRun, error: runError } = await supabase
      .from("payroll_runs")
      .select(PAYROLL_RUN_SELECT_COLUMNS)
      .eq("org_id", profile.org_id)
      .eq("id", runId)
      .is("deleted_at", null)
      .maybeSingle();

    if (runError || !rawRun) {
      return jsonResponse<null>(runError ? 500 : 404, {
        data: null,
        error: { code: runError ? "PAYROLL_RUN_FETCH_FAILED" : "NOT_FOUND", message: "Unable to load payroll run." },
        meta: buildMeta()
      });
    }

    const parsedRun = payrollRunRowSchema.safeParse(rawRun);
    if (!parsedRun.success) {
      return jsonResponse<null>(404, {
        data: null,
        error: { code: "NOT_FOUND", message: "Payroll run was not found." },
        meta: buildMeta()
      });
    }

    // Check existing cycles
    const { count: existingCycleCount } = await supabase
      .from("payroll_cycles")
      .select("id", { count: "exact", head: true })
      .eq("org_id", profile.org_id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null)
      .neq("status", "cancelled");

    // Count flagged items
    const { count: flaggedCount } = await supabase
      .from("payroll_items")
      .select("id", { count: "exact", head: true })
      .eq("org_id", profile.org_id)
      .eq("payroll_run_id", runId)
      .eq("flagged", true)
      .is("deleted_at", null);

    // Policy check
    const decision = evaluatePreparePayoutAction({
      runStatus: parsedRun.data.status,
      flaggedCount: flaggedCount ?? 0,
      overrideHolds,
      actorRoles: profile.roles,
      existingCycleCount: existingCycleCount ?? 0
    });

    if (!decision.allowed) {
      const httpStatus = decision.code === "FORBIDDEN" ? 403 : 409;
      return jsonResponse<null>(httpStatus, {
        data: null,
        error: { code: decision.code, message: decision.message },
        meta: buildMeta()
      });
    }

    // Load all payroll items for this run
    const { data: rawItems, error: itemsError } = await supabase
      .from("payroll_items")
      .select("id, employee_id, pay_currency, net_amount, gross_amount, deductions")
      .eq("org_id", profile.org_id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null);

    if (itemsError || !rawItems || rawItems.length === 0) {
      return jsonResponse<null>(itemsError ? 500 : 409, {
        data: null,
        error: {
          code: itemsError ? "PAYROLL_RUN_FETCH_FAILED" : "INVALID_STATE",
          message: itemsError ? "Unable to load payroll items." : "No payroll items to process."
        },
        meta: buildMeta()
      });
    }

    // Load payment details for snapshot
    const employeeIds = [...new Set(rawItems.map((item: { employee_id: string }) => item.employee_id))];
    const { data: paymentDetails } = await supabase
      .from("employee_payment_details")
      .select("employee_id, bank_name, account_number, routing_number, account_type, currency, is_primary")
      .eq("org_id", profile.org_id)
      .in("employee_id", employeeIds)
      .is("deleted_at", null);

    const paymentDetailsByEmployee = new Map<string, Record<string, unknown>>();
    for (const detail of paymentDetails ?? []) {
      if (!paymentDetailsByEmployee.has(detail.employee_id) || detail.is_primary) {
        paymentDetailsByEmployee.set(detail.employee_id, {
          bankName: detail.bank_name,
          accountNumber: detail.account_number,
          routingNumber: detail.routing_number,
          accountType: detail.account_type,
          currency: detail.currency
        });
      }
    }

    // Group items by pay_currency
    const itemsByCurrency = new Map<string, typeof rawItems>();
    for (const item of rawItems) {
      const currency = (item as { pay_currency: string }).pay_currency;
      const existing = itemsByCurrency.get(currency) ?? [];
      existing.push(item);
      itemsByCurrency.set(currency, existing);
    }

    const nowIso = new Date().toISOString();
    const payPeriodLabel = formatPayPeriodLabel(
      parsedRun.data.pay_period_start,
      parsedRun.data.pay_period_end
    );
    const createdCycles: PayrollCycle[] = [];

    for (const [currency, items] of itemsByCurrency) {
      let totalGross = 0;
      let totalNet = 0;
      let totalDeductions = 0;

      for (const item of items) {
        const castItem = item as { gross_amount: number | string; net_amount: number | string };
        const gross = typeof castItem.gross_amount === "number"
          ? castItem.gross_amount
          : Number.parseInt(String(castItem.gross_amount), 10) || 0;
        const net = typeof castItem.net_amount === "number"
          ? castItem.net_amount
          : Number.parseInt(String(castItem.net_amount), 10) || 0;
        totalGross += gross;
        totalNet += net;
        totalDeductions += gross - net;
      }

      // Insert the cycle
      const { data: cycleRow, error: cycleError } = await supabase
        .from("payroll_cycles")
        .insert({
          payroll_run_id: runId,
          org_id: profile.org_id,
          label: `${currency} Payout - ${payPeriodLabel}`,
          currency,
          status: "ready",
          target_pay_date: parsedRun.data.pay_date,
          prepared_at: nowIso,
          prepared_by: profile.id,
          total_gross: totalGross,
          total_net: totalNet,
          total_deductions: totalDeductions,
          employee_count: items.length
        })
        .select(PAYROLL_CYCLE_SELECT_COLUMNS)
        .single();

      if (cycleError || !cycleRow) {
        return jsonResponse<null>(500, {
          data: null,
          error: { code: "PAYROLL_CYCLE_CREATE_FAILED", message: `Unable to create payout cycle for ${currency}.` },
          meta: buildMeta()
        });
      }

      // Insert cycle items
      const cycleItemInserts = items.map((item) => {
        const castItem = item as { id: string; employee_id: string; net_amount: number | string };
        const netAmount = typeof castItem.net_amount === "number"
          ? castItem.net_amount
          : Number.parseInt(String(castItem.net_amount), 10) || 0;

        return {
          payroll_cycle_id: cycleRow.id,
          payroll_item_id: castItem.id,
          employee_id: castItem.employee_id,
          org_id: profile.org_id,
          payment_destination_snapshot: paymentDetailsByEmployee.get(castItem.employee_id) ?? {},
          disbursement_status: "pending",
          disbursement_amount: netAmount
        };
      });

      const { error: cycleItemsError } = await supabase
        .from("payroll_cycle_items")
        .insert(cycleItemInserts);

      if (cycleItemsError) {
        return jsonResponse<null>(500, {
          data: null,
          error: { code: "PAYROLL_CYCLE_CREATE_FAILED", message: "Unable to create cycle items." },
          meta: buildMeta()
        });
      }

      const parsedCycle = payrollCycleRowSchema.safeParse(cycleRow);
      if (parsedCycle.success) {
        createdCycles.push(toPayrollCycleSummary(parsedCycle.data));
      }
    }

    // Transition run to processing
    await supabase
      .from("payroll_runs")
      .update({ status: "processing" })
      .eq("id", runId)
      .eq("org_id", profile.org_id);

    await logAudit({
      action: "updated",
      tableName: "payroll_runs",
      recordId: runId,
      oldValue: { status: parsedRun.data.status },
      newValue: {
        status: "processing",
        action: "prepare_payout",
        cycleCount: createdCycles.length,
        overrideHolds
      }
    });

    return jsonResponse<PreparePayoutResponseData>(200, {
      data: {
        cycles: createdCycles,
        runStatus: "processing"
      },
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYROLL_CYCLE_CREATE_FAILED",
        message: error instanceof Error ? error.message : "Unable to prepare payout."
      },
      meta: buildMeta()
    });
  }
}
