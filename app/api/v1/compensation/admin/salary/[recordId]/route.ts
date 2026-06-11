import { z } from "zod";

import { diffAuditValues, logAudit } from "../../../../../../../lib/audit";
import { fetchCompensationSnapshot } from "../../../../../../../lib/compensation-store";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import type { CompensationMutationResponseData } from "../../../../../../../types/compensation";
import {
  buildMeta,
  canApproveSalary,
  jsonResponse
} from "../../_helpers";

type RouteContext = {
  params: Promise<{
    recordId: string;
  }>;
};

const paramsSchema = z.object({
  recordId: z.string().uuid()
});

const actionSchema = z.object({
  action: z.enum(["approve", "revoke"])
});

const salaryRecordRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  salary_status: z.enum(["pending", "approved"]),
  approved_by: z.string().uuid().nullable(),
  approved_at: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
  base_salary_amount: z.union([z.string(), z.number()]),
  currency: z.string(),
  pay_frequency: z.string(),
  employment_type: z.string(),
  effective_from: z.string(),
  effective_to: z.string().nullable()
});

export async function PATCH(request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to approve salary records."
      },
      meta: buildMeta()
    });
  }

  if (!canApproveSalary(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Finance Approver or Super Admin can approve salary records."
      },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Salary record id must be a valid UUID."
      },
      meta: buildMeta()
    });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Request body must be valid JSON."
      },
      meta: buildMeta()
    });
  }

  const parsedBody = actionSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid salary approval payload."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: existingRow, error: fetchError } = await supabase
    .from("compensation_records")
    .select(
      "id, employee_id, salary_status, approved_by, approved_at, created_by, base_salary_amount, currency, pay_frequency, employment_type, effective_from, effective_to"
    )
    .eq("id", parsedParams.data.recordId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SALARY_FETCH_FAILED",
        message: "Unable to load salary record for approval."
      },
      meta: buildMeta()
    });
  }

  const parsedExisting = salaryRecordRowSchema.safeParse(existingRow);

  if (!parsedExisting.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Salary record was not found."
      },
      meta: buildMeta()
    });
  }

  const isApproveAction = parsedBody.data.action === "approve";

  // ── Separation of duties: creator cannot approve their own record ──
  if (isApproveAction && parsedExisting.data.created_by === session.profile.id) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message:
          "You cannot approve a salary record you created. A different Finance Approver or Super Admin must approve it."
      },
      meta: buildMeta()
    });
  }

  // ── Guard: don't re-approve an already-approved record ──
  if (isApproveAction && parsedExisting.data.salary_status === "approved") {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "CONFLICT",
        message: "This salary record is already approved."
      },
      meta: buildMeta()
    });
  }

  // ── Guard: don't revoke a pending record ──
  if (!isApproveAction && parsedExisting.data.salary_status === "pending") {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "CONFLICT",
        message: "This salary record is not approved yet."
      },
      meta: buildMeta()
    });
  }

  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("compensation_records")
    .update({
      salary_status: isApproveAction ? "approved" : "pending",
      approved_by: isApproveAction ? session.profile.id : null,
      approved_at: isApproveAction ? now : null
    })
    .eq("id", parsedExisting.data.id)
    .eq("org_id", session.profile.org_id);

  if (updateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SALARY_APPROVAL_FAILED",
        message: "Unable to update salary approval status."
      },
      meta: buildMeta()
    });
  }

  const snapshot = await fetchCompensationSnapshot({
    supabase,
    orgId: session.profile.org_id,
    employeeId: parsedExisting.data.employee_id
  });

  const salaryRecord = snapshot?.salaryRecords.find((record) => record.id === parsedExisting.data.id);

  if (!salaryRecord) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SALARY_FETCH_FAILED",
        message: "Salary approval was updated but could not be reloaded."
      },
      meta: buildMeta()
    });
  }

  const oldAuditRecord = {
    baseSalaryAmount: Number.parseInt(String(parsedExisting.data.base_salary_amount), 10),
    currency: parsedExisting.data.currency,
    payFrequency: parsedExisting.data.pay_frequency,
    employmentType: parsedExisting.data.employment_type,
    effectiveFrom: parsedExisting.data.effective_from,
    effectiveTo: parsedExisting.data.effective_to,
    salaryStatus: parsedExisting.data.salary_status,
    approvedBy: parsedExisting.data.approved_by,
    approvedAt: parsedExisting.data.approved_at
  };

  const newAuditRecord = {
    baseSalaryAmount: salaryRecord.baseSalaryAmount,
    currency: salaryRecord.currency,
    payFrequency: salaryRecord.payFrequency,
    employmentType: salaryRecord.employmentType,
    effectiveFrom: salaryRecord.effectiveFrom,
    effectiveTo: salaryRecord.effectiveTo,
    salaryStatus: salaryRecord.salaryStatus,
    approvedBy: salaryRecord.approvedBy,
    approvedAt: salaryRecord.approvedAt
  };

  const { oldValue, newValue, changedFields } = diffAuditValues(oldAuditRecord, newAuditRecord);

  await logAudit({
    action: isApproveAction ? "approved" : "updated",
    tableName: "compensation_records",
    recordId: salaryRecord.id,
    oldValue: changedFields.length > 0 ? oldValue : oldAuditRecord,
    newValue: changedFields.length > 0 ? newValue : newAuditRecord
  });

  const response: CompensationMutationResponseData = {
    employeeId: salaryRecord.employeeId,
    salaryRecord
  };

  return jsonResponse<CompensationMutationResponseData>(200, {
    data: response,
    error: null,
    meta: buildMeta()
  });
}
