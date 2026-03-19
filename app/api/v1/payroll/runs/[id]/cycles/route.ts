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

const disbursementEntrySchema = z.object({
  employeeId: z.string().uuid(),
  amount: z.number().int().positive()
});

const preparePayoutBodySchema = z.object({
  /** Custom cycle label. Auto-generated as "Cycle {N} - {period}" if omitted. */
  label: z.string().trim().min(1).max(200).optional(),
  /**
   * Per-employee disbursement amounts for this cycle.
   * Omit to include every employee whose payroll item has remaining
   * undisbursed net, each at their full remaining amount.
   * Provide to set explicit per-employee payout amounts.
   */
  disbursements: z.array(disbursementEntrySchema).optional(),
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

function toInt(value: number | string | unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

type PayrollItem = {
  id: string;
  employee_id: string;
  pay_currency: string;
  net_amount: number | string;
  gross_amount: number | string;
  deductions: unknown;
};

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

// ── POST: create a payout-event cycle for a run ──────────────────────
//
// Multi-cycle model: each POST creates one disbursement-event cycle.
// The same employee can appear in multiple cycles with different
// disbursement amounts. Each cycle item carries a per-cycle payout
// amount; the sum across all paid cycles for a payroll item should
// converge to that item's net_amount.
//
// Cycle 1 might disburse 60 % of net to every employee. Cycle 2
// disburses the remaining 40 %. Corrections to an earlier cycle
// flow through a later unpaid cycle by adjusting its amounts.

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

    const items = rawItems as PayrollItem[];

    // ── Compute already-disbursed amounts per payroll item ───────────
    // Count amounts from ALL active (non-cancelled) cycle items,
    // regardless of cycle status (draft/ready/processing/paid).
    // This prevents double-booking the same portion of net.
    const { data: activeCycleRows } = await supabase
      .from("payroll_cycles")
      .select("id")
      .eq("org_id", profile.org_id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null)
      .neq("status", "cancelled");

    const activeCycleIds = (activeCycleRows ?? []).map((c: { id: string }) => c.id);

    const disbursedByItem = new Map<string, number>();
    if (activeCycleIds.length > 0) {
      const { data: existingCycleItems } = await supabase
        .from("payroll_cycle_items")
        .select("payroll_item_id, disbursement_amount")
        .in("payroll_cycle_id", activeCycleIds)
        .is("deleted_at", null);

      for (const ci of existingCycleItems ?? []) {
        const prev = disbursedByItem.get(ci.payroll_item_id) ?? 0;
        disbursedByItem.set(ci.payroll_item_id, prev + toInt(ci.disbursement_amount));
      }
    }

    // Build a map: employeeId → payroll item + remaining amount
    const itemByEmployee = new Map<string, PayrollItem>();
    const remainingByItem = new Map<string, number>();

    for (const item of items) {
      itemByEmployee.set(item.employee_id, item);
      const net = toInt(item.net_amount);
      const disbursed = disbursedByItem.get(item.id) ?? 0;
      remainingByItem.set(item.id, Math.max(0, net - disbursed));
    }

    // Items with remaining undisbursed net > 0
    const itemsWithRemaining = items.filter((i) => (remainingByItem.get(i.id) ?? 0) > 0);
    const hasEligibleEmployees = itemsWithRemaining.length > 0;

    // Policy check
    const decision = evaluatePreparePayoutAction({
      runStatus: parsedRun.data.status,
      actorRoles: profile.roles,
      hasEligibleEmployees
    });

    if (!decision.allowed) {
      const httpStatus = decision.code === "FORBIDDEN" ? 403 : 409;
      return jsonResponse<null>(httpStatus, {
        data: null,
        error: { code: decision.code, message: decision.message },
        meta: buildMeta()
      });
    }

    // ── Determine per-employee disbursements for this cycle ──────────
    type CycleDisbursement = {
      payrollItemId: string;
      employeeId: string;
      amount: number;
    };

    let cycleDisbursements: CycleDisbursement[];

    if (parsedBody.data.disbursements && parsedBody.data.disbursements.length > 0) {
      // Explicit per-employee amounts
      cycleDisbursements = [];

      for (const d of parsedBody.data.disbursements) {
        const payrollItem = itemByEmployee.get(d.employeeId);
        if (!payrollItem) {
          return jsonResponse<null>(422, {
            data: null,
            error: {
              code: "VALIDATION_ERROR",
              message: `Employee ${d.employeeId} is not in this payroll run.`
            },
            meta: buildMeta()
          });
        }

        const remaining = remainingByItem.get(payrollItem.id) ?? 0;
        if (d.amount > remaining) {
          return jsonResponse<null>(422, {
            data: null,
            error: {
              code: "AMOUNT_EXCEEDS_REMAINING",
              message: `Disbursement amount (${d.amount}) exceeds remaining undisbursed (${remaining}) for employee ${d.employeeId}.`,
              details: { employeeId: d.employeeId, requested: d.amount, remaining }
            },
            meta: buildMeta()
          });
        }

        cycleDisbursements.push({
          payrollItemId: payrollItem.id,
          employeeId: d.employeeId,
          amount: d.amount
        });
      }
    } else {
      // Default: every employee at their full remaining amount
      cycleDisbursements = itemsWithRemaining.map((item) => ({
        payrollItemId: item.id,
        employeeId: item.employee_id,
        amount: remainingByItem.get(item.id) ?? 0
      }));
    }

    if (cycleDisbursements.length === 0) {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "INVALID_STATE",
          message: "No disbursements to include. All employees are fully disbursed."
        },
        meta: buildMeta()
      });
    }

    // Flagged items hard-block — only check items included in this cycle
    const cyclePayrollItemIds = cycleDisbursements.map((d) => d.payrollItemId);
    const { count: flaggedCount } = await supabase
      .from("payroll_items")
      .select("id", { count: "exact", head: true })
      .eq("org_id", profile.org_id)
      .in("id", cyclePayrollItemIds)
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

    // ── Payment detail validation (scoped to this cycle's employees) ─
    const cycleEmployeeIds = [...new Set(cycleDisbursements.map((d) => d.employeeId))];
    const nowDate = new Date();
    const { data: paymentDetails } = await supabase
      .from("employee_payment_details")
      .select(
        "employee_id, payment_method, currency, bank_account_last4, mobile_money_last4, crew_tag, is_primary, is_verified, change_effective_at"
      )
      .eq("org_id", profile.org_id)
      .in("employee_id", cycleEmployeeIds)
      .eq("is_primary", true)
      .is("deleted_at", null);

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

      paymentDetailsByEmployee.set(detail.employee_id, {
        paymentMethod: detail.payment_method,
        currency: detail.currency,
        bankAccountLast4: detail.bank_account_last4,
        mobileMoneyLast4: detail.mobile_money_last4,
        crewTag: detail.crew_tag,
        snapshotAt: nowDate.toISOString()
      });
    }

    // Hard-block: unverified
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

    // Held: overridable per-employee
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

      const overrideEmployeeIds = new Set(holdOverrides.map((o) => o.employeeId));
      const uncoveredHeld = employeesWithHeldPayment.filter((id) => !overrideEmployeeIds.has(id));
      if (uncoveredHeld.length > 0) {
        return jsonResponse<null>(422, {
          data: null,
          error: { code: "VALIDATION_ERROR", message: `Hold overrides missing for ${uncoveredHeld.length} employee(s).` },
          meta: buildMeta()
        });
      }

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

    // Hard-block: missing
    const employeesWithoutPayment = cycleEmployeeIds.filter((id) => !paymentDetailsByEmployee.has(id));
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

    // ── Create the cycle ─────────────────────────────────────────────
    const nowIso = nowDate.toISOString();
    const payPeriodLabel = formatPayPeriodLabel(
      parsedRun.data.pay_period_start,
      parsedRun.data.pay_period_end
    );

    const cycleSequence = activeCycleIds.length + 1;
    const cycleLabel = parsedBody.data.label ?? `Cycle ${cycleSequence} - ${payPeriodLabel}`;

    // Currency: most common among this cycle's employees
    const currencyCounts = new Map<string, number>();
    for (const d of cycleDisbursements) {
      const item = itemByEmployee.get(d.employeeId);
      if (item) {
        const cur = item.pay_currency;
        currencyCounts.set(cur, (currencyCounts.get(cur) ?? 0) + 1);
      }
    }
    let primaryCurrency = "USD";
    let maxCurrencyCount = 0;
    for (const [cur, count] of currencyCounts) {
      if (count > maxCurrencyCount) {
        maxCurrencyCount = count;
        primaryCurrency = cur;
      }
    }

    // Cycle totals: total_net is the actual disbursement total for this
    // cycle. total_gross and total_deductions are reference totals from
    // the underlying payroll items (full item values, not prorated).
    let totalGross = 0;
    let totalDeductions = 0;
    const totalNet = cycleDisbursements.reduce((sum, d) => sum + d.amount, 0);

    const seenItemIds = new Set<string>();
    for (const d of cycleDisbursements) {
      if (seenItemIds.has(d.payrollItemId)) continue;
      seenItemIds.add(d.payrollItemId);
      const item = itemByEmployee.get(d.employeeId);
      if (item) {
        const gross = toInt(item.gross_amount);
        const net = toInt(item.net_amount);
        totalGross += gross;
        totalDeductions += gross - net;
      }
    }

    const { data: cycleRow, error: cycleError } = await supabase
      .from("payroll_cycles")
      .insert({
        payroll_run_id: runId,
        org_id: profile.org_id,
        label: cycleLabel,
        currency: primaryCurrency,
        status: "draft",
        target_pay_date: parsedRun.data.pay_date,
        prepared_at: nowIso,
        prepared_by: profile.id,
        total_gross: totalGross,
        total_net: totalNet,
        total_deductions: totalDeductions,
        employee_count: cycleDisbursements.length
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

    // Insert cycle items with per-cycle disbursement amounts
    const cycleItemInserts = cycleDisbursements.map((d) => ({
      payroll_cycle_id: cycleRow.id,
      payroll_item_id: d.payrollItemId,
      employee_id: d.employeeId,
      org_id: profile.org_id,
      payment_destination_snapshot: paymentDetailsByEmployee.get(d.employeeId) ?? {},
      disbursement_status: "pending",
      disbursement_amount: d.amount
    }));

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

    await logAudit({
      action: "updated",
      tableName: "payroll_runs",
      recordId: runId,
      oldValue: { status: parsedRun.data.status },
      newValue: {
        action: "prepare_payout",
        cycleSequence,
        cycleId: cycleRow.id,
        employeeCount: cycleDisbursements.length,
        disbursementTotal: totalNet
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
