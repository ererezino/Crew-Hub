import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { evaluatePreparePayoutAction } from "../../../../../../../lib/payroll/cycle-policy";
import { hasRole } from "../../../../../../../lib/roles";
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
  toPayrollCycleSummary
} from "../../../_helpers";

const holdOverrideSchema = z.object({
  employeeId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500)
});

const preparePayoutBodySchema = z.object({
  holdOverrides: z.array(holdOverrideSchema).optional().default([])
});

function formatPayPeriodLabel(_startDate: string, endDate: string): string {
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

// ── POST: prepare payout (creates draft cycles from approved run) ────

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

  const { holdOverrides } = parsedBody.data;
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

    // Policy check
    const decision = evaluatePreparePayoutAction({
      runStatus: parsedRun.data.status,
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

    // Flagged items hard-block — resolve flags before payout prep
    const { count: flaggedCount } = await supabase
      .from("payroll_items")
      .select("id", { count: "exact", head: true })
      .eq("org_id", profile.org_id)
      .eq("payroll_run_id", runId)
      .eq("flagged", true)
      .is("deleted_at", null);

    if ((flaggedCount ?? 0) > 0) {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "FLAGGED_ITEMS_EXIST",
          message: `${flaggedCount} flagged item(s) must be resolved before payout prep.`
        },
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

    // ── Payment detail validation ────────────────────────────────────
    const employeeIds = [...new Set(rawItems.map((item: { employee_id: string }) => item.employee_id))];
    const nowDate = new Date();
    const { data: paymentDetails } = await supabase
      .from("employee_payment_details")
      .select(
        "employee_id, payment_method, currency, bank_account_last4, mobile_money_last4, crew_tag, is_primary, is_verified, change_effective_at"
      )
      .eq("org_id", profile.org_id)
      .in("employee_id", employeeIds)
      .eq("is_primary", true)
      .is("deleted_at", null);

    // Build a map of employee → validated payment snapshot (non-encrypted fields only)
    const paymentDetailsByEmployee = new Map<string, Record<string, unknown>>();
    const employeesWithHeldPayment: string[] = [];
    const employeesWithUnverifiedPayment: string[] = [];
    const heldPaymentDetails = new Map<string, Record<string, unknown>>();

    for (const detail of paymentDetails ?? []) {
      const effectiveAt = new Date(detail.change_effective_at);
      const isEffective = effectiveAt <= nowDate;

      if (!detail.is_verified) {
        employeesWithUnverifiedPayment.push(detail.employee_id);
        continue;
      }

      if (!isEffective) {
        employeesWithHeldPayment.push(detail.employee_id);
        heldPaymentDetails.set(detail.employee_id, {
          paymentMethod: detail.payment_method,
          currency: detail.currency,
          bankAccountLast4: detail.bank_account_last4,
          mobileMoneyLast4: detail.mobile_money_last4,
          crewTag: detail.crew_tag,
          held: true,
          snapshotAt: nowDate.toISOString()
        });
        continue;
      }

      // Snapshot uses only non-encrypted, safe fields
      paymentDetailsByEmployee.set(detail.employee_id, {
        paymentMethod: detail.payment_method,
        currency: detail.currency,
        bankAccountLast4: detail.bank_account_last4,
        mobileMoneyLast4: detail.mobile_money_last4,
        crewTag: detail.crew_tag,
        snapshotAt: nowDate.toISOString()
      });
    }

    // Hard-block: employees with unverified payment details
    if (employeesWithUnverifiedPayment.length > 0) {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "PAYMENT_DETAILS_UNVERIFIED",
          message: `${employeesWithUnverifiedPayment.length} employee(s) have unverified payment details. Verify payment details before preparing payout.`
        },
        meta: buildMeta()
      });
    }

    // Held employees: overridable with holdOverrides
    if (employeesWithHeldPayment.length > 0) {
      if (holdOverrides.length === 0) {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "PAYMENT_DETAILS_HELD",
            message: `${employeesWithHeldPayment.length} employee(s) have payment detail changes that are not yet effective.`,
            details: { heldEmployeeIds: employeesWithHeldPayment }
          },
          meta: buildMeta()
        });
      }

      // Role check: must be FINANCE_APPROVER or SUPER_ADMIN
      const canOverride =
        hasRole(profile.roles, "FINANCE_APPROVER") ||
        hasRole(profile.roles, "SUPER_ADMIN");

      if (!canOverride) {
        return jsonResponse<null>(403, {
          data: null,
          error: { code: "FORBIDDEN", message: "Only Finance Approver or Super Admin can override payment detail holds." },
          meta: buildMeta()
        });
      }

      // Coverage check: every held employee must be covered
      const overrideEmployeeIds = new Set(holdOverrides.map((o) => o.employeeId));
      const uncoveredHeld = employeesWithHeldPayment.filter((id) => !overrideEmployeeIds.has(id));
      if (uncoveredHeld.length > 0) {
        return jsonResponse<null>(422, {
          data: null,
          error: { code: "VALIDATION_ERROR", message: `Hold overrides missing for ${uncoveredHeld.length} employee(s).` },
          meta: buildMeta()
        });
      }

      // Audit each override and include held employees in the cycle
      for (const override of holdOverrides) {
        await logAudit({
          action: "created",
          tableName: "payroll_cycle_hold_overrides",
          recordId: override.employeeId,
          newValue: { reason: override.reason, overriddenBy: profile.id, payrollRunId: runId }
        });

        const heldDetail = heldPaymentDetails.get(override.employeeId);
        if (heldDetail) {
          paymentDetailsByEmployee.set(override.employeeId, heldDetail);
        }
      }
    }

    // Hard-block: employees missing payment details entirely
    const employeesWithoutPayment = employeeIds.filter((id) => !paymentDetailsByEmployee.has(id));
    if (employeesWithoutPayment.length > 0) {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "PAYMENT_DETAILS_MISSING",
          message: `${employeesWithoutPayment.length} employee(s) do not have payment details on file. Add payment details before preparing payout.`
        },
        meta: buildMeta()
      });
    }

    // ── Create a single cycle containing all payroll items ───────────
    const nowIso = nowDate.toISOString();
    const payPeriodLabel = formatPayPeriodLabel(
      parsedRun.data.pay_period_start,
      parsedRun.data.pay_period_end
    );

    // Determine primary currency (most common among items)
    const currencyCounts = new Map<string, number>();
    for (const item of rawItems) {
      const cur = (item as { pay_currency: string }).pay_currency;
      currencyCounts.set(cur, (currencyCounts.get(cur) ?? 0) + 1);
    }
    let primaryCurrency = "USD";
    let maxCount = 0;
    for (const [cur, count] of currencyCounts) {
      if (count > maxCount) {
        maxCount = count;
        primaryCurrency = cur;
      }
    }

    let totalGross = 0;
    let totalNet = 0;
    let totalDeductions = 0;

    for (const item of rawItems) {
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

    // Cycles start as draft — they move to ready/processing/paid as
    // actual payout events occur. The run stays approved until a cycle
    // is explicitly moved forward.
    const { data: cycleRow, error: cycleError } = await supabase
      .from("payroll_cycles")
      .insert({
        payroll_run_id: runId,
        org_id: profile.org_id,
        label: `Payout - ${payPeriodLabel}`,
        currency: primaryCurrency,
        status: "draft",
        target_pay_date: parsedRun.data.pay_date,
        prepared_at: nowIso,
        prepared_by: profile.id,
        total_gross: totalGross,
        total_net: totalNet,
        total_deductions: totalDeductions,
        employee_count: rawItems.length
      })
      .select(PAYROLL_CYCLE_SELECT_COLUMNS)
      .single();

    if (cycleError || !cycleRow) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "PAYROLL_CYCLE_CREATE_FAILED", message: "Unable to create payout cycle." },
        meta: buildMeta()
      });
    }

    // Insert cycle items with validated payment snapshots
    const cycleItemInserts = rawItems.map((item) => {
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

    const createdCycles: PayrollCycle[] = [];
    const parsedCycle = payrollCycleRowSchema.safeParse(cycleRow);
    if (parsedCycle.success) {
      createdCycles.push(toPayrollCycleSummary(parsedCycle.data));
    }

    // Run stays approved — no automatic transition to processing.
    // The run moves to processing only when a cycle action drives it.

    await logAudit({
      action: "updated",
      tableName: "payroll_runs",
      recordId: runId,
      oldValue: { status: parsedRun.data.status },
      newValue: {
        action: "prepare_payout",
        cycleCount: createdCycles.length
      }
    });

    return jsonResponse<PreparePayoutResponseData>(200, {
      data: {
        cycles: createdCycles,
        runStatus: parsedRun.data.status
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
