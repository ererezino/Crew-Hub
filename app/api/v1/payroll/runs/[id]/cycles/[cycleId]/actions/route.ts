import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../../../lib/audit";
import { evaluateCycleAction } from "../../../../../../../../../lib/payroll/cycle-policy";
import { derivePayrollRunStatusFromCycles } from "../../../../../../../../../lib/payroll/runs";
import { createSupabaseServerClient } from "../../../../../../../../../lib/supabase/server";
import type {
  MarkCyclePaidResponseData,
  PayrollCycle,
  PayrollCycleActionResponseData,
  PayrollCycleApprovalSnapshot,
  PayrollCycleSnapshotRow,
  PayrollRunStatus
} from "../../../../../../../../../types/payroll-runs";
import {
  buildMeta,
  jsonResponse,
  PAYROLL_CYCLE_SELECT_COLUMNS,
  payrollCycleRowSchema,
  toPayrollCycleSummary
} from "../../../../../_helpers";

/** Cycle lifecycle (semimonthly approval model):
 *  draft → submitted (finance preparer freezes snapshot for review)
 *  submitted → approved  (FINANCE_APPROVER / SUPER_ADMIN; separation of duties)
 *  submitted → rejected  (FINANCE_APPROVER / SUPER_ADMIN; back to re-edit)
 *  rejected → submitted  (re-submit after corrections)
 *
 *  approved → ready      (finance confirms disbursement is queued)
 *  ready → processing    (payout initiated — money is being sent)
 *  approved|ready|processing → paid (disbursement confirmed — money arrived)
 *
 *  The run transitions to `processing` on the first cycle moving to `processing`.
 *  The run transitions to `completed` when ALL non-cancelled cycles are `paid`.
 */

const cycleActionBodySchema = z.object({
  action: z.enum(["submit", "approve", "reject", "mark_ready", "mark_processing", "mark_paid"]),
  reason: z.string().trim().max(500).optional().nullable(),
  paymentReference: z.string().trim().max(200).optional().nullable(),
  paymentNote: z.string().trim().max(500).optional().nullable()
});

function parseAmount(value: string | number | unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function syncRunAggregateStatus({
  supabase,
  runId,
  orgId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  runId: string;
  orgId: string;
}) {
  const [{ data: cycleRows, error: cycleError }, { data: runRow, error: runError }] = await Promise.all([
    supabase
      .from("payroll_cycles")
      .select("status")
      .eq("payroll_run_id", runId)
      .eq("org_id", orgId)
      .is("deleted_at", null),
    supabase
      .from("payroll_runs")
      .select("status, completed_at, completed_by, locked_at")
      .eq("id", runId)
      .eq("org_id", orgId)
      .maybeSingle()
  ]);

  if (cycleError) {
    throw new Error("Unable to derive month status from payroll cycles.");
  }

  if (runError || !runRow) {
    throw new Error("Unable to load payroll run while syncing month status.");
  }

  const nextStatus = derivePayrollRunStatusFromCycles(
    (cycleRows ?? [])
      .map((row: { status?: unknown }) => (typeof row.status === "string" ? row.status : null))
      .filter((value): value is z.infer<typeof payrollCycleRowSchema>["status"] => value !== null),
    (typeof runRow.status === "string" ? runRow.status : "calculated") as PayrollRunStatus
  );

  const updatePayload: Record<string, unknown> = { status: nextStatus };

  if (nextStatus !== "completed") {
    updatePayload.completed_at = null;
    updatePayload.completed_by = null;
    updatePayload.locked_at = null;
  }

  const { error: updateRunError } = await supabase
    .from("payroll_runs")
    .update(updatePayload)
    .eq("id", runId)
    .eq("org_id", orgId);

  if (updateRunError) {
    throw new Error("Unable to sync month status from payroll cycles.");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; cycleId: string }> }
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
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Request body must be valid JSON." },
      meta: buildMeta()
    });
  }

  const parsedBody = cycleActionBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: "Invalid cycle action." },
      meta: buildMeta()
    });
  }

  const { action, reason, paymentReference, paymentNote } = parsedBody.data;
  const { id: runId, cycleId } = await params;
  const profile = session.profile;

  if (action === "mark_paid" && !paymentReference?.trim()) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Payment reference is required before marking a cycle as paid."
      },
      meta: buildMeta()
    });
  }

  try {
    const supabase = await createSupabaseServerClient();

    // Load the cycle
    const { data: rawCycle, error: cycleError } = await supabase
      .from("payroll_cycles")
      .select(PAYROLL_CYCLE_SELECT_COLUMNS)
      .eq("org_id", profile.org_id)
      .eq("payroll_run_id", runId)
      .eq("id", cycleId)
      .is("deleted_at", null)
      .maybeSingle();

    if (cycleError || !rawCycle) {
      return jsonResponse<null>(cycleError ? 500 : 404, {
        data: null,
        error: {
          code: cycleError ? "PAYROLL_CYCLE_FETCH_FAILED" : "NOT_FOUND",
          message: "Payout cycle not found."
        },
        meta: buildMeta()
      });
    }

    const parsedCycle = payrollCycleRowSchema.safeParse(rawCycle);
    if (!parsedCycle.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "PAYROLL_CYCLE_PARSE_FAILED", message: "Payout cycle data is invalid." },
        meta: buildMeta()
      });
    }

    // Policy check
    const decision = evaluateCycleAction({
      action,
      cycleStatus: parsedCycle.data.status,
      actorId: profile.id,
      submittedBy: parsedCycle.data.submitted_by ?? null,
      actorRoles: profile.roles
    });

    if (!decision.allowed) {
      const httpStatus = decision.code === "FORBIDDEN" ? 403 : 409;
      return jsonResponse<null>(httpStatus, {
        data: null,
        error: { code: decision.code, message: decision.message },
        meta: buildMeta()
      });
    }

    const nowIso = new Date().toISOString();
    const cycleNumber = parsedCycle.data.cycle_number ?? null;

    // ── submit: draft/rejected → submitted (freeze snapshot) ──────────
    if (action === "submit") {
      return await handleSubmit({
        supabase,
        cycleId,
        runId,
        cycleNumber,
        parsedCycle: parsedCycle.data,
        profile,
        nowIso
      });
    }

    // ── approve: submitted → approved ─────────────────────────────────
    if (action === "approve") {
      return await handleSimpleTransition({
        supabase,
        cycleId,
        runId,
        profile,
        parsedCycle: parsedCycle.data,
        newStatus: "approved",
        updateFields: { status: "approved", approved_at: nowIso, approved_by: profile.id },
        auditAction: "approve",
        nowIso
      });
    }

    // ── reject: submitted → rejected ──────────────────────────────────
    if (action === "reject") {
      return await handleSimpleTransition({
        supabase,
        cycleId,
        runId,
        profile,
        parsedCycle: parsedCycle.data,
        newStatus: "rejected",
        updateFields: {
          status: "rejected",
          rejected_at: nowIso,
          rejected_by: profile.id,
          rejection_reason: reason ?? null
        },
        auditAction: "reject",
        nowIso
      });
    }

    // ── mark_ready: approved → ready ──────────────────────────────────
    if (action === "mark_ready") {
      return await handleSimpleTransition({
        supabase,
        cycleId,
        runId,
        profile,
        parsedCycle: parsedCycle.data,
        newStatus: "ready",
        updateFields: { status: "ready" },
        auditAction: "mark_ready",
        nowIso
      });
    }

    // ── mark_processing: ready → processing ───────────────────────────
    if (action === "mark_processing") {
      const result = await handleSimpleTransition({
        supabase,
        cycleId,
        runId,
        profile,
        parsedCycle: parsedCycle.data,
        newStatus: "processing",
        updateFields: { status: "processing" },
        auditAction: "mark_processing",
        nowIso
      });

      // Transition the run to processing if it's still approved
      await supabase
        .from("payroll_runs")
        .update({ status: "processing" })
        .eq("id", runId)
        .eq("org_id", profile.org_id)
        .eq("status", "approved");

      return result;
    }

    // ── mark_paid: approved|ready|processing → paid ───────────────────
    return await handleMarkPaid({
      supabase,
      cycleId,
      runId,
      parsedCycle: parsedCycle.data,
      profile,
      paymentReference: paymentReference ?? null,
      paymentNote: paymentNote ?? null,
      nowIso
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYROLL_CYCLE_UPDATE_FAILED",
        message: error instanceof Error ? error.message : "Unable to update cycle."
      },
      meta: buildMeta()
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  submit — freeze the approval snapshot from live worksheet data
// ═══════════════════════════════════════════════════════════════════════

async function handleSubmit({
  supabase,
  cycleId,
  runId,
  cycleNumber,
  parsedCycle,
  profile,
  nowIso
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  cycleId: string;
  runId: string;
  cycleNumber: number | null;
  parsedCycle: z.infer<typeof payrollCycleRowSchema>;
  profile: { id: string; org_id: string; full_name: string; roles: readonly string[] };
  nowIso: string;
}) {
  // Determine which cycle column to check for inclusion
  const includedColumn = cycleNumber === 2 ? "cycle_2_included" : "cycle_1_included";
  const baseAmountColumn = cycleNumber === 2 ? "cycle_2_base_amount" : "cycle_1_base_amount";
  const overtimeHoursColumn = cycleNumber === 2 ? "cycle_2_overtime_hours" : "cycle_1_overtime_hours";
  const overtimeAmountColumn = cycleNumber === 2 ? "cycle_2_overtime_amount" : "cycle_1_overtime_amount";

  // Load payroll items included in this cycle
  const { data: rawItems, error: itemsError } = await supabase
    .from("payroll_items")
    .select(
      `id, employee_id, base_salary_amount, ${baseAmountColumn}, ${overtimeHoursColumn}, ${overtimeAmountColumn}, ${includedColumn}, fees, bonus, comment, exception_reason, designation, accrue_username, overtime_hours, net_amount`
    )
    .eq("payroll_run_id", runId)
    .eq("org_id", profile.org_id)
    .eq(includedColumn, true)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (itemsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "PAYROLL_CYCLE_SUBMIT_FAILED", message: "Unable to load worksheet items for snapshot." },
      meta: buildMeta()
    });
  }

  const items = rawItems ?? [];

  // Load employee profiles for names and departments
  const employeeIds = [...new Set(items.map((item: { employee_id: string }) => item.employee_id))];
  const profileById = new Map<string, { full_name: string; department: string | null }>();

  if (employeeIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, department")
      .eq("org_id", profile.org_id)
      .in("id", employeeIds);

    for (const p of profiles ?? []) {
      profileById.set(p.id, { full_name: p.full_name, department: p.department });
    }
  }

  // Compute the overtime rate from item data (rate = amount / hours if hours > 0)
  function deriveOvertimeRate(overtimeAmount: number, overtimeHours: number): number {
    if (overtimeHours <= 0) return 0;
    return Math.round(overtimeAmount / overtimeHours);
  }

  // Build snapshot rows
  const snapshotRows: PayrollCycleSnapshotRow[] = [];
  let totalGross = 0;
  let totalNet = 0;
  let totalDeductions = 0;
  let totalOvertime = 0;
  let totalBonus = 0;
  let totalFees = 0;

  for (const item of items) {
    const cycleBaseAmount = parseAmount((item as Record<string, unknown>)[baseAmountColumn]);
    const cycleOvertimeHours = Number((item as Record<string, unknown>)[overtimeHoursColumn] ?? 0);
    const cycleOvertimeAmount = parseAmount((item as Record<string, unknown>)[overtimeAmountColumn]);
    const itemBonus = parseAmount(item.bonus);
    const itemFees = parseAmount(item.fees);
    const monthlySalary = parseAmount(item.base_salary_amount);

    const finalPayable = cycleBaseAmount + cycleOvertimeAmount + itemBonus - itemFees;

    const emp = profileById.get(item.employee_id);

    snapshotRows.push({
      employeeId: item.employee_id,
      employeeName: emp?.full_name ?? "Unknown employee",
      designation: item.designation ?? null,
      department: emp?.department ?? null,
      accrueUsername: item.accrue_username ?? null,
      monthlySalary,
      cycleBaseAmount,
      overtimeHours: cycleOvertimeHours,
      overtimeRate: deriveOvertimeRate(cycleOvertimeAmount, cycleOvertimeHours),
      overtimeAmount: cycleOvertimeAmount,
      bonus: itemBonus,
      fees: itemFees,
      finalPayable,
      comment: item.comment ?? null,
      exceptionReason: item.exception_reason ?? null
    });

    totalGross += cycleBaseAmount + cycleOvertimeAmount + itemBonus;
    totalNet += finalPayable;
    totalOvertime += cycleOvertimeAmount;
    totalBonus += itemBonus;
    totalFees += itemFees;
  }

  totalDeductions = totalGross - totalNet;

  const approvalSnapshot: PayrollCycleApprovalSnapshot = {
    cycleNumber: cycleNumber ?? 1,
    cycleLabel: parsedCycle.label,
    targetPayDate: parsedCycle.target_pay_date ?? "",
    submittedAt: nowIso,
    submittedBy: profile.id,
    submittedByName: profile.full_name,
    currency: parsedCycle.currency,
    employeeCount: snapshotRows.length,
    totalGross,
    totalNet,
    totalDeductions,
    totalOvertime,
    totalBonus,
    totalFees,
    rows: snapshotRows
  };

  // ── Create payroll_cycle_items (disbursement records) ───────────────
  // These are the rows that mark_paid, My Pay, and completion logic depend on.
  // On re-submit after rejection, clear stale items first.

  await supabase
    .from("payroll_cycle_items")
    .delete()
    .eq("payroll_cycle_id", cycleId)
    .eq("org_id", profile.org_id);

  // Load payment destination snapshots for included employees
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

  const paymentDetailsByEmployee = new Map<string, Record<string, unknown>>();
  for (const detail of paymentDetails ?? []) {
    const effectiveAt = new Date(detail.change_effective_at);
    const isEffective = effectiveAt <= nowDate;
    if (detail.is_verified && isEffective) {
      paymentDetailsByEmployee.set(detail.employee_id, {
        paymentMethod: detail.payment_method,
        currency: detail.currency,
        bankAccountLast4: detail.bank_account_last4,
        mobileMoneyLast4: detail.mobile_money_last4,
        crewTag: detail.crew_tag,
        snapshotAt: nowDate.toISOString()
      });
    }
  }

  // Build cycle item inserts — one per included employee
  const cycleItemInserts = items
    .filter((item: Record<string, unknown>) => {
      const row = snapshotRows.find((r) => r.employeeId === item.employee_id);
      return row && row.finalPayable > 0;
    })
    .map((item: { id: string; employee_id: string }) => {
      const row = snapshotRows.find((r) => r.employeeId === item.employee_id)!;
      return {
        payroll_cycle_id: cycleId,
        payroll_item_id: item.id,
        employee_id: item.employee_id,
        org_id: profile.org_id,
        payment_destination_snapshot: paymentDetailsByEmployee.get(item.employee_id) ?? {},
        disbursement_status: "pending" as const,
        disbursement_amount: row.finalPayable
      };
    });

  if (cycleItemInserts.length > 0) {
    const { error: cycleItemsError } = await supabase
      .from("payroll_cycle_items")
      .insert(cycleItemInserts);

    if (cycleItemsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "PAYROLL_CYCLE_SUBMIT_FAILED", message: "Unable to create cycle disbursement records." },
        meta: buildMeta()
      });
    }
  }

  // Update cycle with snapshot + submitted status + totals
  const { data: updatedRow, error: updateError } = await supabase
    .from("payroll_cycles")
    .update({
      status: "submitted",
      submitted_at: nowIso,
      submitted_by: profile.id,
      approval_snapshot: approvalSnapshot,
      total_gross: totalGross,
      total_net: totalNet,
      total_deductions: totalDeductions,
      total_overtime: totalOvertime,
      total_bonus: totalBonus,
      total_fees: totalFees,
      employee_count: snapshotRows.length
    })
    .eq("id", cycleId)
    .eq("org_id", profile.org_id)
    .select(PAYROLL_CYCLE_SELECT_COLUMNS)
    .single();

  if (updateError || !updatedRow) {
    // Roll back cycle items if status update failed
    await supabase
      .from("payroll_cycle_items")
      .delete()
      .eq("payroll_cycle_id", cycleId)
      .eq("org_id", profile.org_id);

    return jsonResponse<null>(500, {
      data: null,
      error: { code: "PAYROLL_CYCLE_SUBMIT_FAILED", message: "Unable to submit cycle for approval." },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "updated",
    tableName: "payroll_cycles",
    recordId: cycleId,
    oldValue: { status: parsedCycle.status },
    newValue: {
      status: "submitted",
      action: "submit",
      submittedBy: profile.id,
      employeeCount: snapshotRows.length,
      totalNet,
      cycleItemCount: cycleItemInserts.length
    }
  });

  await syncRunAggregateStatus({
    supabase,
    runId,
    orgId: profile.org_id
  });

  const parsed = payrollCycleRowSchema.safeParse(updatedRow);
  const cycle = parsed.success ? toPayrollCycleSummary(parsed.data) : toPayrollCycleSummary(parsedCycle);

  return jsonResponse<PayrollCycleActionResponseData>(200, {
    data: { cycle },
    error: null,
    meta: buildMeta()
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  Simple status transitions (approve, reject, mark_ready)
// ═══════════════════════════════════════════════════════════════════════

async function handleSimpleTransition({
  supabase,
  cycleId,
  runId: _runId,
  profile,
  parsedCycle,
  newStatus,
  updateFields,
  auditAction,
  nowIso: _nowIso
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  cycleId: string;
  runId: string;
  profile: { id: string; org_id: string; roles: readonly string[] };
  parsedCycle: z.infer<typeof payrollCycleRowSchema>;
  newStatus: string;
  updateFields: Record<string, unknown>;
  auditAction: string;
  nowIso: string;
}) {
  const { data: updatedRow, error: updateError } = await supabase
    .from("payroll_cycles")
    .update(updateFields)
    .eq("id", cycleId)
    .eq("org_id", profile.org_id)
    .select(PAYROLL_CYCLE_SELECT_COLUMNS)
    .single();

  if (updateError || !updatedRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "PAYROLL_CYCLE_UPDATE_FAILED", message: `Unable to mark cycle as ${newStatus}.` },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "updated",
    tableName: "payroll_cycles",
    recordId: cycleId,
    oldValue: { status: parsedCycle.status },
    newValue: { status: newStatus, action: auditAction }
  });

  await syncRunAggregateStatus({
    supabase,
    runId: _runId,
    orgId: profile.org_id
  });

  const parsed = payrollCycleRowSchema.safeParse(updatedRow);
  const cycle: PayrollCycle = parsed.success ? toPayrollCycleSummary(parsed.data) : toPayrollCycleSummary(parsedCycle);

  return jsonResponse<PayrollCycleActionResponseData>(200, {
    data: { cycle },
    error: null,
    meta: buildMeta()
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  mark_paid — payment completion + run lifecycle
// ═══════════════════════════════════════════════════════════════════════

async function handleMarkPaid({
  supabase,
  cycleId,
  runId,
  parsedCycle,
  profile,
  paymentReference,
  paymentNote,
  nowIso
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  cycleId: string;
  runId: string;
  parsedCycle: z.infer<typeof payrollCycleRowSchema>;
  profile: { id: string; org_id: string; roles: readonly string[] };
  paymentReference: string | null;
  paymentNote: string | null;
  nowIso: string;
}) {
  // 1. Update the cycle → paid + locked
  const { data: updatedCycleRow, error: updateCycleError } = await supabase
    .from("payroll_cycles")
    .update({
      status: "paid",
      paid_at: nowIso,
      paid_by: profile.id,
      locked_at: nowIso,
      payment_reference: paymentReference,
      payment_note: paymentNote
    })
    .eq("id", cycleId)
    .eq("org_id", profile.org_id)
    .select(PAYROLL_CYCLE_SELECT_COLUMNS)
    .single();

  if (updateCycleError || !updatedCycleRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "PAYROLL_CYCLE_UPDATE_FAILED", message: "Unable to mark cycle as paid." },
      meta: buildMeta()
    });
  }

  // 2. Update all cycle items → paid
  await supabase
    .from("payroll_cycle_items")
    .update({ disbursement_status: "paid" })
    .eq("payroll_cycle_id", cycleId)
    .eq("org_id", profile.org_id);

  // 2b. Publish payslips for affected employees — employee visibility
  //     starts when the first cycle is actually paid, not at generation.
  const previousStatus = parsedCycle.status;

  async function rollbackMarkPaid() {
    await Promise.all([
      supabase
        .from("payroll_cycles")
        .update({ status: previousStatus, paid_at: null, paid_by: null, locked_at: null, payment_reference: null, payment_note: null })
        .eq("id", cycleId)
        .eq("org_id", profile.org_id),
      supabase
        .from("payroll_cycle_items")
        .update({ disbursement_status: "pending" })
        .eq("payroll_cycle_id", cycleId)
        .eq("org_id", profile.org_id)
    ]);
  }

  const { data: paidCycleItems, error: paidCycleItemsError } = await supabase
    .from("payroll_cycle_items")
    .select("payroll_item_id")
    .eq("payroll_cycle_id", cycleId)
    .eq("org_id", profile.org_id)
    .is("deleted_at", null);

  if (paidCycleItemsError) {
    await rollbackMarkPaid();

    return jsonResponse<null>(500, {
      data: null,
      error: { code: "PAYSLIP_PUBLICATION_FAILED", message: "Unable to publish payslips for paid cycle. Cycle and disbursements reverted." },
      meta: buildMeta()
    });
  }

  if (paidCycleItems && paidCycleItems.length > 0) {
    const paidPayrollItemIds = [
      ...new Set(paidCycleItems.map((row: { payroll_item_id: string }) => row.payroll_item_id))
    ];

    // Stamp published_at on payslips that are not yet published
    const { error: publishError } = await supabase
      .from("payslips")
      .update({ published_at: nowIso })
      .in("payroll_item_id", paidPayrollItemIds)
      .is("published_at", null)
      .is("deleted_at", null);

    if (publishError) {
      await rollbackMarkPaid();

      return jsonResponse<null>(500, {
        data: null,
        error: { code: "PAYSLIP_PUBLICATION_FAILED", message: "Unable to publish payslips for paid cycle. Cycle and disbursements reverted." },
        meta: buildMeta()
      });
    }
  }

  // 3. Derive truthful payment state per payroll item.
  const { data: cycleItemRows } = await supabase
    .from("payroll_cycle_items")
    .select("payroll_item_id")
    .eq("payroll_cycle_id", cycleId)
    .eq("org_id", profile.org_id);

  if (cycleItemRows && cycleItemRows.length > 0) {
    const payrollItemIds = [...new Set(
      cycleItemRows.map((row: { payroll_item_id: string }) => row.payroll_item_id)
    )];

    const { data: affectedItems } = await supabase
      .from("payroll_items")
      .select("id, net_amount")
      .eq("org_id", profile.org_id)
      .in("id", payrollItemIds);

    const { data: allPaidCycleRows } = await supabase
      .from("payroll_cycles")
      .select("id")
      .eq("payroll_run_id", runId)
      .eq("org_id", profile.org_id)
      .eq("status", "paid")
      .is("deleted_at", null);

    const allPaidCycleIds = [
      ...(allPaidCycleRows ?? []).map((c: { id: string }) => c.id),
      cycleId
    ];
    const uniquePaidCycleIds = [...new Set(allPaidCycleIds)];

    const { data: allPaidDisbursements } = await supabase
      .from("payroll_cycle_items")
      .select("payroll_item_id, disbursement_amount")
      .in("payroll_cycle_id", uniquePaidCycleIds)
      .in("payroll_item_id", payrollItemIds)
      .is("deleted_at", null);

    const paidByItem = new Map<string, number>();
    for (const d of allPaidDisbursements ?? []) {
      const amt = typeof d.disbursement_amount === "number"
        ? d.disbursement_amount
        : Number.parseInt(String(d.disbursement_amount), 10) || 0;
      paidByItem.set(d.payroll_item_id, (paidByItem.get(d.payroll_item_id) ?? 0) + amt);
    }

    const fullyPaidIds: string[] = [];
    const partiallyPaidIds: string[] = [];

    for (const item of affectedItems ?? []) {
      const net = typeof item.net_amount === "number"
        ? item.net_amount
        : Number.parseInt(String(item.net_amount), 10) || 0;
      const totalPaid = paidByItem.get(item.id) ?? 0;

      if (totalPaid >= net) {
        fullyPaidIds.push(item.id);
      } else {
        partiallyPaidIds.push(item.id);
      }
    }

    if (fullyPaidIds.length > 0) {
      await supabase
        .from("payroll_items")
        .update({ payment_status: "paid" })
        .eq("org_id", profile.org_id)
        .in("id", fullyPaidIds);
    }

    if (partiallyPaidIds.length > 0) {
      await supabase
        .from("payroll_items")
        .update({ payment_status: "partially_paid" })
        .eq("org_id", profile.org_id)
        .in("id", partiallyPaidIds);
    }
  }

  // 4. If the run is still approved, move it to processing
  await supabase
    .from("payroll_runs")
    .update({ status: "processing" })
    .eq("id", runId)
    .eq("org_id", profile.org_id)
    .eq("status", "approved");

  // 5. Check if ALL non-cancelled cycles are paid → complete the run
  const { count: unpaidCount } = await supabase
    .from("payroll_cycles")
    .select("id", { count: "exact", head: true })
    .eq("org_id", profile.org_id)
    .eq("payroll_run_id", runId)
    .is("deleted_at", null)
    .neq("status", "cancelled")
    .neq("status", "paid");

  if (unpaidCount === 0) {
    const { data: allRunItems } = await supabase
      .from("payroll_items")
      .select("id, net_amount")
      .eq("payroll_run_id", runId)
      .eq("org_id", profile.org_id)
      .is("deleted_at", null);

    const { data: paidCycleRows } = await supabase
      .from("payroll_cycles")
      .select("id")
      .eq("payroll_run_id", runId)
      .eq("org_id", profile.org_id)
      .eq("status", "paid")
      .is("deleted_at", null);

    const paidCycleIdList = (paidCycleRows ?? []).map((c: { id: string }) => c.id);
    const paidByItem = new Map<string, number>();

    if (paidCycleIdList.length > 0) {
      const { data: paidDisbursements } = await supabase
        .from("payroll_cycle_items")
        .select("payroll_item_id, disbursement_amount")
        .in("payroll_cycle_id", paidCycleIdList)
        .is("deleted_at", null);

      for (const d of paidDisbursements ?? []) {
        const amt = typeof d.disbursement_amount === "number"
          ? d.disbursement_amount
          : Number.parseInt(String(d.disbursement_amount), 10) || 0;
        paidByItem.set(d.payroll_item_id, (paidByItem.get(d.payroll_item_id) ?? 0) + amt);
      }
    }

    const fullyDisbursed = (allRunItems ?? []).every(
      (item: { id: string; net_amount: number | string }) => {
        const net = typeof item.net_amount === "number"
          ? item.net_amount
          : Number.parseInt(String(item.net_amount), 10) || 0;
        const paid = paidByItem.get(item.id) ?? 0;
        return paid >= net;
      }
    );

    if (fullyDisbursed) {
      await supabase
        .from("payroll_runs")
        .update({
          status: "completed",
          completed_at: nowIso,
          completed_by: profile.id,
          locked_at: nowIso
        })
        .eq("id", runId)
        .eq("org_id", profile.org_id);

      await logAudit({
        action: "updated",
        tableName: "payroll_runs",
        recordId: runId,
        oldValue: { status: "processing" },
        newValue: {
          status: "completed",
          action: "all_cycles_paid",
          completedBy: profile.id
        }
      });
    }
  }

  await logAudit({
    action: "updated",
    tableName: "payroll_cycles",
    recordId: cycleId,
    oldValue: { status: parsedCycle.status },
    newValue: { status: "paid", action: "mark_paid", paymentReference, paymentNote }
  });

  await syncRunAggregateStatus({
    supabase,
    runId,
    orgId: profile.org_id
  });

  const parsedUpdated = payrollCycleRowSchema.safeParse(updatedCycleRow);
  const cycle: PayrollCycle = parsedUpdated.success
    ? toPayrollCycleSummary(parsedUpdated.data)
    : toPayrollCycleSummary(parsedCycle);

  return jsonResponse<MarkCyclePaidResponseData>(200, {
    data: { cycle },
    error: null,
    meta: buildMeta()
  });
}
