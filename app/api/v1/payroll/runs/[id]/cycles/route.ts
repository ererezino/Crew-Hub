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
  /** Explicit list of employees for this cycle. Omit to include all remaining. */
  employeeIds: z.array(z.string().uuid()).optional(),
  /** Custom cycle label. Auto-generated if omitted. */
  label: z.string().trim().min(1).max(200).optional(),
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

// ── POST: create a payout cycle for a run ────────────────────────────
//
// Multi-cycle model: each POST creates one payout-event cycle containing
// the specified employees (or all remaining employees if none specified).
// Multiple cycles can coexist for the same run. An employee can only
// appear in one active (non-cancelled) cycle.

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

    // ── Determine which employees are already in active cycles ───────
    const { data: activeCycleRows } = await supabase
      .from("payroll_cycles")
      .select("id")
      .eq("org_id", profile.org_id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null)
      .neq("status", "cancelled");

    const activeCycleIds = (activeCycleRows ?? []).map((c: { id: string }) => c.id);

    let assignedEmployeeIds = new Set<string>();
    if (activeCycleIds.length > 0) {
      const { data: existingCycleItems } = await supabase
        .from("payroll_cycle_items")
        .select("employee_id")
        .in("payroll_cycle_id", activeCycleIds)
        .is("deleted_at", null);

      assignedEmployeeIds = new Set(
        (existingCycleItems ?? []).map((e: { employee_id: string }) => e.employee_id)
      );
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

    // All employee IDs in this run
    const allRunEmployeeIds = [...new Set(rawItems.map((item: { employee_id: string }) => item.employee_id))];

    // Eligible = not yet assigned to an active cycle
    const eligibleEmployeeIds = allRunEmployeeIds.filter((id) => !assignedEmployeeIds.has(id));

    // ── Determine selected employees for this cycle ──────────────────
    let selectedEmployeeIds: string[];

    if (parsedBody.data.employeeIds && parsedBody.data.employeeIds.length > 0) {
      // Caller specified explicit employees — validate each is eligible
      const eligibleSet = new Set(eligibleEmployeeIds);
      const invalidIds = parsedBody.data.employeeIds.filter((id) => !eligibleSet.has(id));

      if (invalidIds.length > 0) {
        // Distinguish between "not in this run" and "already assigned"
        const notInRun = invalidIds.filter((id) => !allRunEmployeeIds.includes(id));
        const alreadyAssigned = invalidIds.filter((id) => assignedEmployeeIds.has(id));

        const parts: string[] = [];
        if (notInRun.length > 0) parts.push(`${notInRun.length} not in this run`);
        if (alreadyAssigned.length > 0) parts.push(`${alreadyAssigned.length} already in an active cycle`);

        return jsonResponse<null>(422, {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: `Invalid employee selection: ${parts.join(", ")}.`,
            details: { notInRun, alreadyAssigned }
          },
          meta: buildMeta()
        });
      }

      selectedEmployeeIds = parsedBody.data.employeeIds;
    } else {
      // Default: all remaining eligible employees
      selectedEmployeeIds = eligibleEmployeeIds;
    }

    // Policy check (uses hasEligibleEmployees instead of existingCycleCount)
    const decision = evaluatePreparePayoutAction({
      runStatus: parsedRun.data.status,
      actorRoles: profile.roles,
      hasEligibleEmployees: selectedEmployeeIds.length > 0
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
    // Only check items for the selected employees (not the entire run)
    const selectedEmployeeSet = new Set(selectedEmployeeIds);
    const selectedItems = rawItems.filter(
      (item: { employee_id: string }) => selectedEmployeeSet.has(item.employee_id)
    );

    const selectedItemIds = selectedItems.map((item: { id: string }) => item.id);
    const { count: flaggedCount } = await supabase
      .from("payroll_items")
      .select("id", { count: "exact", head: true })
      .eq("org_id", profile.org_id)
      .in("id", selectedItemIds)
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

    // ── Payment detail validation (scoped to selected employees) ─────
    const nowDate = new Date();
    const { data: paymentDetails } = await supabase
      .from("employee_payment_details")
      .select(
        "employee_id, payment_method, currency, bank_account_last4, mobile_money_last4, crew_tag, is_primary, is_verified, change_effective_at"
      )
      .eq("org_id", profile.org_id)
      .in("employee_id", selectedEmployeeIds)
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
    const employeesWithoutPayment = selectedEmployeeIds.filter((id) => !paymentDetailsByEmployee.has(id));
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

    // Sequence number: count of existing active cycles + 1
    const cycleSequence = activeCycleIds.length + 1;

    // Auto-label or caller-provided label
    const cycleLabel = parsedBody.data.label ?? `Cycle ${cycleSequence} - ${payPeriodLabel}`;

    // Determine primary currency among selected items
    const currencyCounts = new Map<string, number>();
    for (const item of selectedItems) {
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

    for (const item of selectedItems) {
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
        employee_count: selectedItems.length
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
    const cycleItemInserts = selectedItems.map((item) => {
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

    // Run stays in its current state (approved or processing).
    // Run → processing when a cycle action moves a cycle to processing.
    // Run → completed when all employees are covered and all cycles paid.

    await logAudit({
      action: "updated",
      tableName: "payroll_runs",
      recordId: runId,
      oldValue: { status: parsedRun.data.status },
      newValue: {
        action: "prepare_payout",
        cycleSequence,
        cycleId: cycleRow.id,
        employeeCount: selectedItems.length,
        totalEmployeesInRun: allRunEmployeeIds.length,
        remainingAfter: eligibleEmployeeIds.length - selectedEmployeeIds.length
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
