import { z } from "zod";

import { diffAuditValues, logAuditBatch } from "../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createBulkNotifications } from "../../../../../lib/notifications/service";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import { buildMeta, jsonResponse } from "../../expenses/_helpers";

/**
 * POST /api/v1/approvals/reassign — HR_ADMIN / SUPER_ADMIN move pending
 * additional-approval expenses from one approver to another (the directly
 * assignable gate; manager-stage queues are handled via delegations or a
 * manager change). Used when an approver leaves, is offboarded, or is
 * unreachable. Every reassignment is field-diff audited per expense.
 */

const reassignPayloadSchema = z.object({
  fromApproverId: z.string().uuid(),
  toApproverId: z.string().uuid(),
  /** Optional subset; defaults to every pending additional-stage expense
   * currently assigned to fromApproverId. */
  expenseIds: z.array(z.string().uuid()).max(200).optional()
});

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  if (!hasRole(session.profile.roles, "HR_ADMIN") && !hasRole(session.profile.roles, "SUPER_ADMIN")) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only HR Admin or Super Admin can reassign approvals." },
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

  const parsed = reassignPayloadSchema.safeParse(body);

  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid reassignment payload."
      },
      meta: buildMeta()
    });
  }

  const { fromApproverId, toApproverId, expenseIds } = parsed.data;

  if (fromApproverId === toApproverId) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: "Choose a different approver to reassign to." },
      meta: buildMeta()
    });
  }

  const orgId = session.profile.org_id;
  const supabase = createSupabaseServiceRoleClient();

  /* The new approver must be an active member of the org. */
  const { data: approverRows } = await supabase
    .from("profiles")
    .select("id, full_name, status")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .in("id", [fromApproverId, toApproverId]);

  const profileById = new Map(
    (approverRows ?? [])
      .filter((row): row is { id: string; full_name: string; status: string | null } => typeof row?.id === "string")
      .map((row) => [row.id, row] as const)
  );
  const toApprover = profileById.get(toApproverId);

  if (!toApprover || toApprover.status !== "active") {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: "The new approver must be an active member of this organization." },
      meta: buildMeta()
    });
  }

  /* Load the reassignable items: pending additional-stage expenses gated by
   * the departing approver. */
  let targetQuery = supabase
    .from("expenses")
    .select("id, employee_id")
    .eq("org_id", orgId)
    .eq("status", "manager_approved")
    .eq("requires_additional_approval", true)
    .eq("additional_approver_id", fromApproverId)
    .is("deleted_at", null);

  if (expenseIds && expenseIds.length > 0) {
    targetQuery = targetQuery.in("id", expenseIds);
  }

  const { data: targetRows, error: targetError } = await targetQuery;

  if (targetError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "REASSIGN_FETCH_FAILED", message: "Unable to load pending approvals for reassignment." },
      meta: buildMeta()
    });
  }

  /* Self-approval prevention carries over: the new approver cannot gate
   * their own expenses — those stay behind for a different approver. */
  const eligible = (targetRows ?? []).filter((row) => row.employee_id !== toApproverId);
  const skippedSelfApproval = (targetRows ?? []).length - eligible.length;
  const eligibleIds = eligible.map((row) => row.id as string);

  if (eligibleIds.length === 0) {
    return jsonResponse<{ reassignedCount: number; skippedSelfApproval: number }>(200, {
      data: { reassignedCount: 0, skippedSelfApproval },
      error: null,
      meta: buildMeta()
    });
  }

  const { data: updatedRows, error: updateError } = await supabase
    .from("expenses")
    .update({ additional_approver_id: toApproverId })
    .eq("org_id", orgId)
    .in("id", eligibleIds)
    /* Status guard: a concurrent approval must not be overwritten. */
    .eq("status", "manager_approved")
    .eq("additional_approver_id", fromApproverId)
    .select("id");

  if (updateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "REASSIGN_FAILED", message: "Unable to reassign pending approvals." },
      meta: buildMeta()
    });
  }

  const reassignedIds = (updatedRows ?? []).map((row) => row.id as string);
  const fromApproverName = profileById.get(fromApproverId)?.full_name ?? null;

  const auditDiff = diffAuditValues(
    { additionalApproverId: fromApproverId, additionalApproverName: fromApproverName },
    { additionalApproverId: toApproverId, additionalApproverName: toApprover.full_name }
  );

  await logAuditBatch(
    reassignedIds.map((expenseId) => ({
      action: "updated" as const,
      tableName: "expenses",
      recordId: expenseId,
      oldValue: auditDiff.oldValue,
      newValue: { ...auditDiff.newValue, reassignment: true }
    }))
  );

  await createBulkNotifications({
    orgId,
    userIds: [toApproverId],
    type: "expense_status",
    title: "Approvals reassigned to you",
    body: `${reassignedIds.length} pending expense approval${reassignedIds.length === 1 ? "" : "s"} ${reassignedIds.length === 1 ? "was" : "were"} reassigned to you.`,
    link: "/expenses/approvals"
  }).catch(() => undefined);

  return jsonResponse<{ reassignedCount: number; skippedSelfApproval: number }>(200, {
    data: { reassignedCount: reassignedIds.length, skippedSelfApproval },
    error: null,
    meta: buildMeta()
  });
}
