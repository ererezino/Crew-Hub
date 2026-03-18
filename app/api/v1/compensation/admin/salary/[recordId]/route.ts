import { z } from "zod";

import { logAudit } from "../../../../../../../lib/audit";
import { fetchCompensationSnapshot } from "../../../../../../../lib/compensation-store";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../../lib/supabase/service-role";
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

  // Use service-role client for the fetch to bypass RLS and get created_by
  // (created_by is tracked via Supabase's auth.uid() at insert time, stored in audit)
  const { data: existingRow, error: fetchError } = await supabase
    .from("compensation_records")
    .select(
      "id, employee_id, salary_status, approved_by, base_salary_amount, currency, pay_frequency, employment_type, effective_from, effective_to"
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

  // We need the created_by from the audit log to enforce separation of duties.
  // The compensation_records table doesn't have a created_by column, so we look
  // it up from the audit trail (the user who inserted the record).
  const svcClient = createSupabaseServiceRoleClient();
  const { data: auditRow } = await svcClient
    .from("audit_log")
    .select("actor_id")
    .eq("table_name", "compensation_records")
    .eq("record_id", parsedParams.data.recordId)
    .eq("action", "created")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const createdBy = auditRow?.actor_id ?? null;

  const parsedExisting = salaryRecordRowSchema.safeParse({
    ...existingRow,
    created_by: createdBy
  });

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

  await logAudit({
    action: isApproveAction ? "approved" : "updated",
    tableName: "compensation_records",
    recordId: salaryRecord.id,
    oldValue: {
      salaryStatus: parsedExisting.data.salary_status,
      approvedBy: parsedExisting.data.approved_by
    },
    newValue: {
      salaryStatus: salaryRecord.salaryStatus,
      approvedBy: salaryRecord.approvedBy,
      approvedAt: salaryRecord.approvedAt
    }
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
