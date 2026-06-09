import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../../../lib/audit";
import { calculateOvertimeCompensation } from "../../../../../../../../../lib/payroll/overtime";
import { createSupabaseServerClient } from "../../../../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../../../../lib/supabase/service-role";
import {
  buildMeta,
  canManagePayroll,
  jsonResponse,
  PAYROLL_RUN_SELECT_COLUMNS,
  payrollRunRowSchema
} from "../../../../../_helpers";
import type { WorksheetRowEditResponseData, PayrollRunItem } from "../../../../../../../../../types/payroll-runs";

/* ── Request body schema ─────────────── */

const worksheetEditSchema = z.object({
  cycle1BaseAmount: z.number().int().nonnegative().optional(),
  cycle2BaseAmount: z.number().int().nonnegative().optional(),
  cycle1OvertimeHours: z.number().nonnegative().optional(),
  cycle2OvertimeHours: z.number().nonnegative().optional(),
  cycle1Included: z.boolean().optional(),
  cycle2Included: z.boolean().optional(),
  fees: z.number().int().nonnegative().optional(),
  bonus: z.number().int().nonnegative().optional(),
  comment: z.string().max(500).nullable().optional(),
  exceptionReason: z.string().max(500).nullable().optional()
});

/* ── Minimal item row schema for reading current values ── */

const itemRowSchema = z.object({
  id: z.string().uuid(),
  payroll_run_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  org_id: z.string().uuid(),
  base_salary_amount: z.union([z.number(), z.string()]),
  overtime_amount: z.union([z.number(), z.string()]).optional().default(0),
  overtime_hours: z.union([z.number(), z.string()]).optional().default(0),
  cycle_1_base_amount: z.union([z.number(), z.string()]).optional().default(0),
  cycle_2_base_amount: z.union([z.number(), z.string()]).optional().default(0),
  cycle_1_overtime_hours: z.union([z.number(), z.string()]).optional().default(0),
  cycle_2_overtime_hours: z.union([z.number(), z.string()]).optional().default(0),
  cycle_1_overtime_amount: z.union([z.number(), z.string()]).optional().default(0),
  cycle_2_overtime_amount: z.union([z.number(), z.string()]).optional().default(0),
  cycle_1_included: z.boolean().optional().default(true),
  cycle_2_included: z.boolean().optional().default(true),
  fees: z.union([z.number(), z.string()]).optional().default(0),
  bonus: z.union([z.number(), z.string()]).optional().default(0),
  comment: z.string().nullable().optional().default(null),
  exception_reason: z.string().nullable().optional().default(null)
});

function parseAmount(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/* ── Route handler ────────────────────── */

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in to edit worksheet rows." },
      meta: buildMeta()
    });
  }

  if (!canManagePayroll(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only finance roles can edit worksheet rows." },
      meta: buildMeta()
    });
  }

  const { id: runId, itemId } = await params;
  const profile = session.profile;

  /* Parse request body */
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

  const parsed = worksheetEditSchema.safeParse(body);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: firstError?.message ?? "Invalid request payload."
      },
      meta: buildMeta()
    });
  }

  const edits = parsed.data;

  /* At least one field must be provided */
  const hasEdits = Object.values(edits).some((v) => v !== undefined);
  if (!hasEdits) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "At least one worksheet field must be provided."
      },
      meta: buildMeta()
    });
  }

  if (edits.cycle2OvertimeHours !== undefined) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message:
          "Cycle 2 overtime is disabled. Previous-month overtime must be paid in payroll cycle 1."
      },
      meta: buildMeta()
    });
  }

  /* Verify the payroll run exists and is editable */
  const supabase = await createSupabaseServerClient();

  const { data: rawRun, error: runError } = await supabase
    .from("payroll_runs")
    .select(PAYROLL_RUN_SELECT_COLUMNS)
    .eq("org_id", profile.org_id)
    .eq("id", runId)
    .is("deleted_at", null)
    .maybeSingle();

  if (runError || !rawRun) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Payroll run not found." },
      meta: buildMeta()
    });
  }

  const parsedRun = payrollRunRowSchema.safeParse(rawRun);

  if (!parsedRun.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "PAYROLL_RUN_PARSE_FAILED", message: "Payroll run data is not in the expected format." },
      meta: buildMeta()
    });
  }

  /* Worksheet edits stay available for unfrozen cycle fields until the month is
   * fully completed or cancelled. Cycle-level freeze rules below remain the
   * authoritative control over which columns are still editable. */
  const blockedStatuses = ["completed", "cancelled"];
  if (blockedStatuses.includes(parsedRun.data.status)) {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "INVALID_STATE",
        message: "Worksheet edits are not allowed once the payroll month is completed or cancelled."
      },
      meta: buildMeta()
    });
  }

  /* ── Cycle-specific + shared-field immutability ─────────────────────
   * Once either cycle leaves draft/rejected, the frozen approval snapshot
   * becomes the authoritative record for payout-affecting worksheet values.
   * Shared payout fields therefore lock as soon as any cycle is submitted.
   */
  const touchesCycle1 =
    edits.cycle1BaseAmount !== undefined ||
    edits.cycle1OvertimeHours !== undefined ||
    edits.cycle1Included !== undefined;
  const touchesCycle2 =
    edits.cycle2BaseAmount !== undefined ||
    edits.cycle2OvertimeHours !== undefined ||
    edits.cycle2Included !== undefined;
  const touchesSharedPayoutFields =
    edits.fees !== undefined ||
    edits.bonus !== undefined ||
    edits.comment !== undefined ||
    edits.exceptionReason !== undefined;

  if (touchesCycle1 || touchesCycle2 || touchesSharedPayoutFields) {
    const frozenStatuses = ["submitted", "approved", "ready", "processing", "paid"];
    const cyclesToCheck: number[] = [];
    if (touchesSharedPayoutFields) {
      cyclesToCheck.push(1, 2);
    } else {
      if (touchesCycle1) cyclesToCheck.push(1);
      if (touchesCycle2) cyclesToCheck.push(2);
    }

    const { data: frozenCycles } = await supabase
      .from("payroll_cycles")
      .select("cycle_number, status")
      .eq("payroll_run_id", runId)
      .eq("org_id", profile.org_id)
      .in("cycle_number", cyclesToCheck)
      .in("status", frozenStatuses)
      .is("deleted_at", null);

    if (frozenCycles && frozenCycles.length > 0) {
      const frozenLabels = frozenCycles
        .map((c: { cycle_number: number; status: string }) => `Cycle ${c.cycle_number} (${c.status})`)
        .join(", ");
      const scopeLabel = touchesSharedPayoutFields
        ? "shared payout fields"
        : "fields";
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "CYCLE_FROZEN",
          message: `Cannot edit ${scopeLabel} while ${frozenLabels} is frozen. Cycle must be in draft or rejected status.`
        },
        meta: buildMeta()
      });
    }
  }

  /* Fetch the specific payroll item */
  const { data: rawItem, error: itemError } = await supabase
    .from("payroll_items")
    .select(
      "id, payroll_run_id, employee_id, org_id, base_salary_amount, overtime_amount, overtime_hours, cycle_1_base_amount, cycle_2_base_amount, cycle_1_overtime_hours, cycle_2_overtime_hours, cycle_1_overtime_amount, cycle_2_overtime_amount, cycle_1_included, cycle_2_included, fees, bonus, comment, exception_reason"
    )
    .eq("id", itemId)
    .eq("payroll_run_id", runId)
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (itemError || !rawItem) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Payroll item not found in this run." },
      meta: buildMeta()
    });
  }

  const parsedItem = itemRowSchema.safeParse(rawItem);
  if (!parsedItem.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "PARSE_FAILED", message: "Payroll item data is not in the expected format." },
      meta: buildMeta()
    });
  }

  const old = parsedItem.data;

  /* ── Enforce exception reason for non-50/50 splits (Amendment 5) ── */
  const effectiveC1Base = edits.cycle1BaseAmount ?? parseAmount(old.cycle_1_base_amount);
  const effectiveC2Base = edits.cycle2BaseAmount ?? parseAmount(old.cycle_2_base_amount);
  const effectiveBaseSalary = parseAmount(old.base_salary_amount);
  const defaultHalf = Math.round(effectiveBaseSalary / 2);

  const isNonDefaultSplit =
    effectiveBaseSalary > 0 &&
    (effectiveC1Base !== defaultHalf || effectiveC2Base !== (effectiveBaseSalary - defaultHalf));

  if (isNonDefaultSplit) {
    const effectiveExceptionReason = edits.exceptionReason ?? old.exception_reason;
    if (!effectiveExceptionReason || !String(effectiveExceptionReason).trim()) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "EXCEPTION_REASON_REQUIRED",
          message: "An exception reason is required when the cycle split deviates from the default 50/50."
        },
        meta: buildMeta()
      });
    }
  }

  /* Build the DB update payload */
  const updatePayload: Record<string, unknown> = {};
  const auditOldValue: Record<string, unknown> = {};
  const auditNewValue: Record<string, unknown> = {};

  if (edits.cycle1BaseAmount !== undefined) {
    updatePayload.cycle_1_base_amount = edits.cycle1BaseAmount;
    auditOldValue.cycle1BaseAmount = parseAmount(old.cycle_1_base_amount);
    auditNewValue.cycle1BaseAmount = edits.cycle1BaseAmount;
  }

  if (edits.cycle2BaseAmount !== undefined) {
    updatePayload.cycle_2_base_amount = edits.cycle2BaseAmount;
    auditOldValue.cycle2BaseAmount = parseAmount(old.cycle_2_base_amount);
    auditNewValue.cycle2BaseAmount = edits.cycle2BaseAmount;
  }

  if (edits.cycle1OvertimeHours !== undefined) {
    updatePayload.cycle_1_overtime_hours = edits.cycle1OvertimeHours;
    auditOldValue.cycle1OvertimeHours = Number(old.cycle_1_overtime_hours);
    auditNewValue.cycle1OvertimeHours = edits.cycle1OvertimeHours;
  }

  if (edits.cycle2OvertimeHours !== undefined) {
    updatePayload.cycle_2_overtime_hours = edits.cycle2OvertimeHours;
    auditOldValue.cycle2OvertimeHours = Number(old.cycle_2_overtime_hours);
    auditNewValue.cycle2OvertimeHours = edits.cycle2OvertimeHours;
  }

  if (edits.cycle1Included !== undefined) {
    updatePayload.cycle_1_included = edits.cycle1Included;
    auditOldValue.cycle1Included = old.cycle_1_included;
    auditNewValue.cycle1Included = edits.cycle1Included;
  }

  if (edits.cycle2Included !== undefined) {
    updatePayload.cycle_2_included = edits.cycle2Included;
    auditOldValue.cycle2Included = old.cycle_2_included;
    auditNewValue.cycle2Included = edits.cycle2Included;
  }

  if (edits.fees !== undefined) {
    updatePayload.fees = edits.fees;
    auditOldValue.fees = parseAmount(old.fees);
    auditNewValue.fees = edits.fees;
  }

  if (edits.bonus !== undefined) {
    updatePayload.bonus = edits.bonus;
    auditOldValue.bonus = parseAmount(old.bonus);
    auditNewValue.bonus = edits.bonus;
  }

  if (edits.comment !== undefined) {
    updatePayload.comment = edits.comment;
    auditOldValue.comment = old.comment;
    auditNewValue.comment = edits.comment;
  }

  if (edits.exceptionReason !== undefined) {
    updatePayload.exception_reason = edits.exceptionReason;
    auditOldValue.exceptionReason = old.exception_reason;
    auditNewValue.exceptionReason = edits.exceptionReason;
  }

  /* ── Auto-recalculate derived amounts (Amendment 3) ─────── */

  const c1Base = edits.cycle1BaseAmount ?? parseAmount(old.cycle_1_base_amount);
  const c2Base = edits.cycle2BaseAmount ?? parseAmount(old.cycle_2_base_amount);
  const c1OtHours = edits.cycle1OvertimeHours ?? Number(old.cycle_1_overtime_hours);
  const c2OtHours = 0;
  const baseSalary = parseAmount(old.base_salary_amount);

  const c1OtAmount = calculateOvertimeCompensation({
    monthlyCompensationAmount: baseSalary,
    overtimeHours: c1OtHours
  });
  const c2OtAmount = calculateOvertimeCompensation({
    monthlyCompensationAmount: baseSalary,
    overtimeHours: c2OtHours
  });
  const totalOtHours = c1OtHours + c2OtHours;
  const totalOtAmount = c1OtAmount + c2OtAmount;

  updatePayload.cycle_2_overtime_hours = 0;
  updatePayload.cycle_1_overtime_amount = c1OtAmount;
  updatePayload.cycle_2_overtime_amount = c2OtAmount;
  updatePayload.overtime_hours = totalOtHours;
  updatePayload.overtime_amount = totalOtAmount;

  const bonusAmount = edits.bonus ?? parseAmount(old.bonus);
  const feesAmount = edits.fees ?? parseAmount(old.fees);

  /* Monthly total = C1 base + C2 base + overtime + bonus + fees. Fees are a
   * payable earning (like bonus), so they roll into the worksheet total. */
  const monthlyTotal = c1Base + c2Base + totalOtAmount + bonusAmount + feesAmount;

  /* Update gross and net to reflect worksheet totals */
  updatePayload.gross_amount = monthlyTotal;
  updatePayload.net_amount = monthlyTotal;

  /* Apply update using service role client to bypass RLS */
  const serviceClient = createSupabaseServiceRoleClient();

  const { error: updateError } = await serviceClient
    .from("payroll_items")
    .update(updatePayload)
    .eq("id", itemId)
    .eq("payroll_run_id", runId)
    .eq("org_id", profile.org_id);

  if (updateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "UPDATE_FAILED", message: "Unable to update worksheet row." },
      meta: buildMeta()
    });
  }

  /* Audit log */
  await logAudit({
    action: "updated",
    tableName: "payroll_items",
    recordId: itemId,
    oldValue: auditOldValue,
    newValue: {
      ...auditNewValue,
      editedBy: profile.id,
      worksheetEdit: true
    }
  });

  /* Return the updated item — refetch to get the full row with derived values */
  const { data: updatedRaw } = await supabase
    .from("payroll_items")
    .select(
      "id, payroll_run_id, employee_id, org_id, gross_amount, currency, pay_currency, base_salary_amount, allowances, adjustments, deductions, employer_contributions, overtime_amount, overtime_hours, net_amount, withholding_applied, payment_status, payment_reference, payment_id, notes, finance_notes, correction_of, correction_reason, flagged, flag_reason, cycle_1_base_amount, cycle_2_base_amount, cycle_1_overtime_hours, cycle_2_overtime_hours, cycle_1_overtime_amount, cycle_2_overtime_amount, cycle_1_included, cycle_2_included, fees, bonus, comment, exception_reason, designation, accrue_username, created_at, updated_at"
    )
    .eq("id", itemId)
    .eq("payroll_run_id", runId)
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  /* Construct a minimal item response — the client will refresh to get the full row */
  const r = updatedRaw as Record<string, unknown> | null;

  /* Helper to safely extract a numeric value from the refetched row */
  function refetchNum(key: string, fallback: number): number {
    const v = r?.[key];
    if (typeof v === "number") return v;
    if (typeof v === "string") return parseAmount(v);
    return fallback;
  }

  return jsonResponse<WorksheetRowEditResponseData>(200, {
    data: {
      item: {
        id: itemId,
        cycle1BaseAmount: refetchNum("cycle_1_base_amount", c1Base),
        cycle2BaseAmount: refetchNum("cycle_2_base_amount", c2Base),
        cycle1OvertimeHours: refetchNum("cycle_1_overtime_hours", c1OtHours),
        cycle2OvertimeHours: refetchNum("cycle_2_overtime_hours", c2OtHours),
        cycle1OvertimeAmount: refetchNum("cycle_1_overtime_amount", c1OtAmount),
        cycle2OvertimeAmount: refetchNum("cycle_2_overtime_amount", c2OtAmount),
        cycle1Included: (r?.cycle_1_included as boolean | undefined) ?? true,
        cycle2Included: (r?.cycle_2_included as boolean | undefined) ?? true,
        fees: refetchNum("fees", feesAmount),
        bonus: refetchNum("bonus", bonusAmount),
        comment: (r?.comment as string | null) ?? null,
        exceptionReason: (r?.exception_reason as string | null) ?? null,
        monthlyTotal: refetchNum("net_amount", monthlyTotal),
        grossAmount: refetchNum("gross_amount", c1Base + c2Base + totalOtAmount + bonusAmount),
        netAmount: refetchNum("net_amount", monthlyTotal),
        overtimeAmount: refetchNum("overtime_amount", totalOtAmount),
        overtimeHours: refetchNum("overtime_hours", totalOtHours)
      } as unknown as PayrollRunItem
    },
    error: null,
    meta: buildMeta()
  });
}
