import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import { buildMeta, jsonResponse } from "../../expenses/_helpers";

/**
 * GET /api/v1/approvals/queues — per-approver pending workload, for the
 * HR_ADMIN / SUPER_ADMIN reassignment surface. Shows, for every person who
 * currently gates something:
 *   - pending expenses at manager stage (derived from the submitter's manager)
 *   - pending expenses at additional-approval stage (additional_approver_id)
 *   - pending leave requests (derived from the requester's manager)
 * Approvers who are no longer active (offboarding/inactive/deleted) are
 * flagged so orphaned queues are visible instead of silently stuck.
 */

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  status: z.string().nullable(),
  deleted_at: z.string().nullable().optional().default(null)
});

type QueueEntry = {
  approverId: string;
  approverName: string;
  approverStatus: string | null;
  isOrphaned: boolean;
  pendingExpensesManagerStage: number;
  pendingExpensesAdditionalStage: number;
  pendingExpenseIdsAdditionalStage: string[];
  pendingLeaveRequests: number;
};

export async function GET() {
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
      error: { code: "FORBIDDEN", message: "Only HR Admin or Super Admin can view approval queues." },
      meta: buildMeta()
    });
  }

  const orgId = session.profile.org_id;
  const supabase = createSupabaseServiceRoleClient();

  const [pendingExpensesResult, additionalExpensesResult, pendingLeaveResult] = await Promise.all([
    supabase
      .from("expenses")
      .select("id, employee_id")
      .eq("org_id", orgId)
      .eq("status", "pending")
      .is("deleted_at", null),
    supabase
      .from("expenses")
      .select("id, additional_approver_id")
      .eq("org_id", orgId)
      .eq("status", "manager_approved")
      .eq("requires_additional_approval", true)
      .not("additional_approver_id", "is", null)
      .is("deleted_at", null),
    supabase
      .from("leave_requests")
      .select("id, employee_id")
      .eq("org_id", orgId)
      .eq("status", "pending")
      .is("deleted_at", null)
  ]);

  if (pendingExpensesResult.error || additionalExpensesResult.error || pendingLeaveResult.error) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "QUEUE_FETCH_FAILED", message: "Unable to load approval queues." },
      meta: buildMeta()
    });
  }

  const pendingExpenses = pendingExpensesResult.data ?? [];
  const additionalExpenses = additionalExpensesResult.data ?? [];
  const pendingLeave = pendingLeaveResult.data ?? [];

  /* Manager-stage items route to the submitter's manager — resolve those. */
  const employeeIds = [
    ...new Set(
      [...pendingExpenses, ...pendingLeave]
        .map((row) => row.employee_id as string | null)
        .filter((id): id is string => Boolean(id))
    )
  ];

  const managerByEmployeeId = new Map<string, string>();

  if (employeeIds.length > 0) {
    const { data: employeeRows } = await supabase
      .from("profiles")
      .select("id, manager_id")
      .eq("org_id", orgId)
      .in("id", employeeIds);

    for (const row of employeeRows ?? []) {
      if (typeof row?.id === "string" && typeof row?.manager_id === "string") {
        managerByEmployeeId.set(row.id, row.manager_id);
      }
    }
  }

  const entries = new Map<string, QueueEntry>();

  function entryFor(approverId: string): QueueEntry {
    let entry = entries.get(approverId);
    if (!entry) {
      entry = {
        approverId,
        approverName: "",
        approverStatus: null,
        isOrphaned: false,
        pendingExpensesManagerStage: 0,
        pendingExpensesAdditionalStage: 0,
        pendingExpenseIdsAdditionalStage: [],
        pendingLeaveRequests: 0
      };
      entries.set(approverId, entry);
    }
    return entry;
  }

  for (const row of pendingExpenses) {
    const managerId = row.employee_id ? managerByEmployeeId.get(row.employee_id as string) : undefined;
    if (managerId) {
      entryFor(managerId).pendingExpensesManagerStage += 1;
    }
  }

  for (const row of additionalExpenses) {
    const approverId = row.additional_approver_id as string;
    const entry = entryFor(approverId);
    entry.pendingExpensesAdditionalStage += 1;
    entry.pendingExpenseIdsAdditionalStage.push(row.id as string);
  }

  for (const row of pendingLeave) {
    const managerId = row.employee_id ? managerByEmployeeId.get(row.employee_id as string) : undefined;
    if (managerId) {
      entryFor(managerId).pendingLeaveRequests += 1;
    }
  }

  /* Resolve approver names and statuses; flag orphans. */
  const approverIds = [...entries.keys()];

  if (approverIds.length > 0) {
    const { data: approverRows } = await supabase
      .from("profiles")
      .select("id, full_name, status, deleted_at")
      .eq("org_id", orgId)
      .in("id", approverIds);

    const parsed = z.array(profileRowSchema).safeParse(approverRows ?? []);
    const profileById = new Map(
      (parsed.success ? parsed.data : []).map((row) => [row.id, row] as const)
    );

    for (const entry of entries.values()) {
      const profile = profileById.get(entry.approverId);
      entry.approverName = profile?.full_name ?? "Unknown";
      entry.approverStatus = profile?.status ?? null;
      entry.isOrphaned =
        !profile ||
        Boolean(profile.deleted_at) ||
        profile.status === "inactive" ||
        profile.status === "offboarding";
    }
  }

  const queues = [...entries.values()].sort((a, b) => {
    if (a.isOrphaned !== b.isOrphaned) return a.isOrphaned ? -1 : 1;
    const totalA = a.pendingExpensesManagerStage + a.pendingExpensesAdditionalStage + a.pendingLeaveRequests;
    const totalB = b.pendingExpensesManagerStage + b.pendingExpensesAdditionalStage + b.pendingLeaveRequests;
    return totalB - totalA;
  });

  return jsonResponse<{ queues: QueueEntry[] }>(200, {
    data: { queues },
    error: null,
    meta: buildMeta()
  });
}
