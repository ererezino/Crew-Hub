import "server-only";

import type { SessionProfile } from "../auth/session";
import { getEffectiveApproverScope } from "../delegation";
import { hasRole } from "../roles";
import { createSupabaseServerClient } from "../supabase/server";
import { createSupabaseServiceRoleClient } from "../supabase/service-role";

/* ── Types ── */

export type ApprovalsCountsData = {
  timeOff: number;
  expenses: number;
  /** Expenses awaiting manager approval (status = "pending") */
  managerExpenses: number;
  /** Expenses awaiting additional approval (status = "manager_approved" with requires_additional_approval) */
  additionalExpenses: number;
  /** Expenses awaiting finance payment confirmation (status = "manager_approved") */
  financeExpenses: number;
  total: number;
};

/* ── Role helpers ── */

function canReviewTimeOff(profile: SessionProfile): boolean {
  return (
    hasRole(profile.roles, "MANAGER") ||
    hasRole(profile.roles, "TEAM_LEAD") ||
    hasRole(profile.roles, "HR_ADMIN") ||
    hasRole(profile.roles, "SUPER_ADMIN")
  );
}

function canViewAllTimeOff(profile: SessionProfile): boolean {
  return hasRole(profile.roles, "HR_ADMIN") || hasRole(profile.roles, "SUPER_ADMIN");
}

function canManagerApproveExpenses(profile: SessionProfile): boolean {
  return (
    hasRole(profile.roles, "MANAGER") ||
    hasRole(profile.roles, "TEAM_LEAD") ||
    hasRole(profile.roles, "SUPER_ADMIN")
  );
}

function canFinanceApproveExpenses(profile: SessionProfile): boolean {
  return hasRole(profile.roles, "FINANCE_ADMIN") || hasRole(profile.roles, "SUPER_ADMIN");
}

/* ── Count helpers ── */

type SupabaseClientLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function countPendingLeaveRequests({
  supabase,
  orgId,
  employeeIds
}: {
  supabase: SupabaseClientLike;
  orgId: string;
  employeeIds?: string[] | null;
}) {
  if (Array.isArray(employeeIds) && employeeIds.length === 0) {
    return 0;
  }

  let query = supabase
    .from("leave_requests")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "pending")
    .is("deleted_at", null);

  if (Array.isArray(employeeIds) && employeeIds.length > 0) {
    query = query.in("employee_id", employeeIds);
  }

  const { count, error } = await query;
  if (error) return 0;
  return typeof count === "number" ? count : 0;
}

async function countExpensesByStatus({
  supabase,
  orgId,
  status,
  employeeIds
}: {
  supabase: SupabaseClientLike;
  orgId: string;
  status: "pending" | "manager_approved";
  employeeIds?: string[] | null;
}) {
  if (Array.isArray(employeeIds) && employeeIds.length === 0) {
    return 0;
  }

  let query = supabase
    .from("expenses")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", status)
    .is("deleted_at", null);

  if (Array.isArray(employeeIds) && employeeIds.length > 0) {
    query = query.in("employee_id", employeeIds);
  }

  const { count, error } = await query;
  if (error) return 0;
  return typeof count === "number" ? count : 0;
}

async function countAdditionalExpenses({
  supabase,
  orgId,
  userId
}: {
  supabase: SupabaseClientLike;
  orgId: string;
  userId: string;
}) {
  const { count, error } = await supabase
    .from("expenses")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "manager_approved")
    .eq("requires_additional_approval", true)
    .eq("additional_approver_id", userId)
    .is("deleted_at", null);

  if (error) return 0;
  return typeof count === "number" ? count : 0;
}

/* ── Main data-fetching function ── */

/**
 * Fetch approval badge counts for the given session profile.
 * Returns the same shape the client expects from the API.
 * Throws on unrecoverable errors so the caller can handle them.
 */
export async function fetchApprovalsCountsData(
  profile: SessionProfile
): Promise<ApprovalsCountsData> {
  const superAdmin = hasRole(profile.roles, "SUPER_ADMIN");

  const includeTimeOff = canReviewTimeOff(profile);
  const includeManagerExpenses = canManagerApproveExpenses(profile);
  const includeFinanceExpenses = canFinanceApproveExpenses(profile);

  if (!includeTimeOff && !includeManagerExpenses && !includeFinanceExpenses) {
    return {
      timeOff: 0,
      expenses: 0,
      managerExpenses: 0,
      additionalExpenses: 0,
      financeExpenses: 0,
      total: 0
    };
  }

  const supabase = await createSupabaseServerClient();
  const svcClient = createSupabaseServiceRoleClient();

  // Resolve operational scope (direct + delegated reports) for non-admin users.
  const needsLeaveScope = includeTimeOff && !canViewAllTimeOff(profile);
  const needsExpenseScope = includeManagerExpenses && !superAdmin;

  let leaveReportIds: string[] | null = null;
  let expenseReportIds: string[] | null = null;

  if (needsLeaveScope && needsExpenseScope) {
    const [leaveScope, expenseScope] = await Promise.all([
      getEffectiveApproverScope({ supabase, orgId: profile.org_id, userId: profile.id, scope: "leave" }),
      getEffectiveApproverScope({ supabase, orgId: profile.org_id, userId: profile.id, scope: "expense" })
    ]);
    leaveReportIds = [...leaveScope.directReportIds, ...leaveScope.delegatedReportIds];
    expenseReportIds = [...expenseScope.directReportIds, ...expenseScope.delegatedReportIds];
  } else if (needsLeaveScope) {
    const leaveScope = await getEffectiveApproverScope({ supabase, orgId: profile.org_id, userId: profile.id, scope: "leave" });
    leaveReportIds = [...leaveScope.directReportIds, ...leaveScope.delegatedReportIds];
  } else if (needsExpenseScope) {
    const expenseScope = await getEffectiveApproverScope({ supabase, orgId: profile.org_id, userId: profile.id, scope: "expense" });
    expenseReportIds = [...expenseScope.directReportIds, ...expenseScope.delegatedReportIds];
  }

  const [timeOffCount, managerExpenseCount, additionalExpenseCount, financeExpenseCount] = await Promise.all([
    includeTimeOff
      ? countPendingLeaveRequests({
          supabase: svcClient,
          orgId: profile.org_id,
          employeeIds: canViewAllTimeOff(profile) ? null : leaveReportIds
        })
      : Promise.resolve(0),
    includeManagerExpenses
      ? countExpensesByStatus({
          supabase: svcClient,
          orgId: profile.org_id,
          status: "pending",
          employeeIds: superAdmin ? null : expenseReportIds
        })
      : Promise.resolve(0),
    (includeManagerExpenses || includeFinanceExpenses)
      ? countAdditionalExpenses({
          supabase: svcClient,
          orgId: profile.org_id,
          userId: profile.id
        })
      : Promise.resolve(0),
    includeFinanceExpenses
      ? countExpensesByStatus({
          supabase: svcClient,
          orgId: profile.org_id,
          status: "manager_approved",
          employeeIds: null
        })
      : Promise.resolve(0)
  ]);

  const expensesCount = managerExpenseCount + additionalExpenseCount + financeExpenseCount;
  const total = timeOffCount + expensesCount;

  return {
    timeOff: timeOffCount,
    expenses: expensesCount,
    managerExpenses: managerExpenseCount,
    additionalExpenses: additionalExpenseCount,
    financeExpenses: financeExpenseCount,
    total
  };
}
