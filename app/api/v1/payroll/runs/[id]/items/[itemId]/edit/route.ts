import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../../../lib/audit";
import { createSupabaseServerClient } from "../../../../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../../../../lib/supabase/service-role";
import {
  buildMeta,
  canManagePayroll,
  jsonResponse,
  parseIntegerAmount,
  payrollAllowanceSchema,
  payrollRunRowSchema
} from "../../../../../_helpers";
import type { EditPayrollItemResponseData } from "../../../../../../../../../types/payroll-runs";

/* ── Request body schema ─────────────── */

const editPayloadSchema = z.object({
  baseSalaryAmount: z.number().int().positive().optional(),
  allowances: z
    .array(
      z.object({
        label: z.string().min(1).max(120),
        amount: z.number().int().nonnegative(),
        currency: z.string().length(3),
        isTaxable: z.boolean()
      })
    )
    .optional(),
  currency: z.string().length(3).optional(),
  reason: z.string().trim().min(1).max(500)
});

/* ── Route handler ────────────────────── */

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in to edit payroll items." },
      meta: buildMeta()
    });
  }

  if (!canManagePayroll(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only Finance Admin and Super Admin can edit payroll items." },
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

  const parsed = editPayloadSchema.safeParse(body);

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

  const { baseSalaryAmount, allowances, currency, reason } = parsed.data;

  /* At least one editable field must be provided alongside the reason */
  if (baseSalaryAmount === undefined && allowances === undefined && currency === undefined) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "At least one field (baseSalaryAmount, allowances, or currency) must be provided."
      },
      meta: buildMeta()
    });
  }

  /* Verify the payroll run exists and is editable */
  const supabase = await createSupabaseServerClient();

  const { data: rawRun, error: runError } = await supabase
    .from("payroll_runs")
    .select(
      "id, org_id, pay_period_start, pay_period_end, pay_date, status, initiated_by, first_approved_by, first_approved_at, final_approved_by, final_approved_at, total_gross, total_net, total_deductions, total_employer_contributions, employee_count, snapshot, notes, created_at, updated_at"
    )
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

  if (parsedRun.data.status !== "draft" && parsedRun.data.status !== "calculated") {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "INVALID_STATE",
        message: "Edits are only allowed when the payroll run is in draft or calculated status."
      },
      meta: buildMeta()
    });
  }

  /* Fetch the specific payroll item */
  const { data: rawItem, error: itemError } = await supabase
    .from("payroll_items")
    .select(
      "id, payroll_run_id, employee_id, org_id, gross_amount, currency, pay_currency, base_salary_amount, allowances, adjustments, deductions, employer_contributions, net_amount, withholding_applied, payment_status, payment_reference, payment_id, notes, flagged, flag_reason, created_at, updated_at"
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

  /* Capture old values for audit */
  const oldBaseSalary = typeof rawItem.base_salary_amount === "string"
    ? Number.parseInt(rawItem.base_salary_amount, 10)
    : rawItem.base_salary_amount;
  const oldAllowances = rawItem.allowances;
  const oldCurrency = rawItem.currency;

  /* Build the update payload */
  const updatedFields: string[] = [];
  const updatePayload: Record<string, unknown> = {};
  const auditOldValue: Record<string, unknown> = {};
  const auditNewValue: Record<string, unknown> = {};

  if (baseSalaryAmount !== undefined) {
    updatePayload.base_salary_amount = baseSalaryAmount;
    updatedFields.push("baseSalaryAmount");
    auditOldValue.baseSalaryAmount = oldBaseSalary;
    auditNewValue.baseSalaryAmount = baseSalaryAmount;
  }

  if (allowances !== undefined) {
    updatePayload.allowances = allowances;
    updatedFields.push("allowances");
    auditOldValue.allowances = oldAllowances;
    auditNewValue.allowances = allowances;
  }

  if (currency !== undefined) {
    updatePayload.currency = currency;
    updatePayload.pay_currency = currency;
    updatedFields.push("currency");
    auditOldValue.currency = oldCurrency;
    auditNewValue.currency = currency;
  }

  /* Recalculate gross and net based on updated values */
  const finalBaseSalary = baseSalaryAmount ?? oldBaseSalary;
  const finalAllowances = allowances ?? [];
  const parsedOldAllowances = z.array(payrollAllowanceSchema).safeParse(oldAllowances);
  const effectiveAllowances = allowances !== undefined
    ? finalAllowances
    : (parsedOldAllowances.success ? parsedOldAllowances.data : []);
  const allowanceTotal = effectiveAllowances.reduce(
    (sum: number, a: { amount: number }) => sum + a.amount,
    0
  );

  /* Parse existing adjustments total */
  const rawAdjustments = Array.isArray(rawItem.adjustments) ? rawItem.adjustments : [];
  const adjustmentsTotal = rawAdjustments.reduce(
    (sum: number, adj: Record<string, unknown>) => {
      const amount = typeof adj.amount === "number" ? adj.amount : 0;
      return sum + amount;
    },
    0
  );

  const grossAmount = finalBaseSalary + allowanceTotal + Math.max(0, adjustmentsTotal);
  const negativeAdjustments = Math.min(0, adjustmentsTotal);
  const netAmount = grossAmount + negativeAdjustments;

  updatePayload.gross_amount = grossAmount;
  updatePayload.net_amount = netAmount;

  /* Flag the item and reset withholding */
  updatePayload.withholding_applied = false;
  updatePayload.flagged = true;
  updatePayload.flag_reason = "Manually edited \u2014 run Calculate to apply withholding rules.";
  updatePayload.deductions = [];
  updatePayload.employer_contributions = [];

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
      error: { code: "UPDATE_FAILED", message: "Unable to update payroll item." },
      meta: buildMeta()
    });
  }

  /* Reset run status to draft if it was calculated */
  let runStatusReset = false;

  if (parsedRun.data.status === "calculated") {
    const { error: runUpdateError } = await serviceClient
      .from("payroll_runs")
      .update({ status: "draft" })
      .eq("id", runId)
      .eq("org_id", profile.org_id);

    if (!runUpdateError) {
      runStatusReset = true;
    }
  }

  /* Audit log */
  await logAudit({
    action: "updated",
    tableName: "payroll_items",
    recordId: itemId,
    oldValue: {
      ...auditOldValue,
      withholdingApplied: rawItem.withholding_applied,
      runStatus: parsedRun.data.status
    },
    newValue: {
      ...auditNewValue,
      reason,
      editedBy: profile.id,
      withholdingApplied: false,
      flagged: true,
      runStatusReset,
      manualEdit: true
    }
  });

  return jsonResponse<EditPayrollItemResponseData>(200, {
    data: {
      itemId,
      updatedFields,
      runStatusReset
    },
    error: null,
    meta: buildMeta()
  });
}
