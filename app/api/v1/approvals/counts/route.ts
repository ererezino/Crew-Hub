import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import type { UserRole } from "../../../../../lib/navigation";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";

type ApprovalsCountsResponseData = {
  timeOff: number;
  expenses: number;
  /** Expenses awaiting manager approval (status = "pending") */
  managerExpenses: number;
  /** Expenses awaiting finance payment confirmation (status = "manager_approved") */
  financeExpenses: number;
  total: number;
};

const querySchema = z.object({});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function canReviewTimeOff(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "MANAGER") || hasRole(roles, "HR_ADMIN") || hasRole(roles, "SUPER_ADMIN");
}

function canViewAllTimeOff(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "HR_ADMIN") || hasRole(roles, "SUPER_ADMIN");
}

function canManagerApproveExpenses(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "MANAGER") || hasRole(roles, "SUPER_ADMIN");
}

function canFinanceApproveExpenses(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "SUPER_ADMIN");
}

async function listManagerReportIds({
  supabase,
  orgId,
  managerId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
  managerId: string;
}) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("org_id", orgId)
    .eq("manager_id", managerId)
    .is("deleted_at", null);

  if (error || !data) {
    return [];
  }

  return data
    .map((row) => row.id)
    .filter((value): value is string => typeof value === "string");
}

async function countPendingLeaveRequests({
  supabase,
  orgId,
  employeeIds
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
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
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
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

export async function GET(request: Request) {
  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid approvals counts query."
      },
      meta: buildMeta()
    });
  }

  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view approvals counts."
      },
      meta: buildMeta()
    });
  }

  const { profile } = session;
  const roles = profile.roles;
  const superAdmin = hasRole(roles, "SUPER_ADMIN");

  const includeTimeOff = canReviewTimeOff(roles);
  const includeManagerExpenses = canManagerApproveExpenses(roles);
  const includeFinanceExpenses = canFinanceApproveExpenses(roles);

  if (!includeTimeOff && !includeManagerExpenses && !includeFinanceExpenses) {
    return jsonResponse<ApprovalsCountsResponseData>(200, {
      data: {
        timeOff: 0,
        expenses: 0,
        managerExpenses: 0,
        financeExpenses: 0,
        total: 0
      },
      error: null,
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const needsManagerScopedIds =
    (includeTimeOff && !canViewAllTimeOff(roles)) ||
    (includeManagerExpenses && !superAdmin);

  let managerReportIds: string[] | null = null;
  if (needsManagerScopedIds) {
    managerReportIds = await listManagerReportIds({
      supabase,
      orgId: profile.org_id,
      managerId: profile.id
    });
  }

  const [timeOffCount, managerExpenseCount, financeExpenseCount] = await Promise.all([
    includeTimeOff
      ? countPendingLeaveRequests({
          supabase,
          orgId: profile.org_id,
          employeeIds: canViewAllTimeOff(roles) ? null : managerReportIds
        })
      : Promise.resolve(0),
    includeManagerExpenses
      ? countExpensesByStatus({
          supabase,
          orgId: profile.org_id,
          status: "pending",
          employeeIds: superAdmin ? null : managerReportIds
        })
      : Promise.resolve(0),
    includeFinanceExpenses
      ? countExpensesByStatus({
          supabase,
          orgId: profile.org_id,
          status: "manager_approved",
          employeeIds: null
        })
      : Promise.resolve(0)
  ]);

  const expensesCount = managerExpenseCount + financeExpenseCount;
  const total = timeOffCount + expensesCount;

  return jsonResponse<ApprovalsCountsResponseData>(200, {
    data: {
      timeOff: timeOffCount,
      expenses: expensesCount,
      managerExpenses: managerExpenseCount,
      financeExpenses: financeExpenseCount,
      total
    },
    error: null,
    meta: buildMeta()
  });
}
