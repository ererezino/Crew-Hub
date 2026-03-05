import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { getDashboardPersona, type DashboardPersona } from "../../../../lib/dashboard-persona";
import { normalizeUserRoles, type UserRole } from "../../../../lib/navigation";
import { hasRole } from "../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../types/auth";
import type {
  DashboardAnnouncement,
  DashboardAuditLogEntry,
  DashboardExpenseItem,
  DashboardGreeting,
  DashboardHolidayItem,
  DashboardLeaveBalanceItem,
  DashboardPendingApprovals,
  DashboardResponseData,
  DashboardShiftItem,
  DashboardTeamOnLeaveItem
} from "../../../../types/dashboard";

/* ── Helpers ── */

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function toDateString(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getFirstName(fullName: string): string {
  const [firstName] = fullName.trim().split(/\s+/);
  return firstName || "there";
}

function getRoleBadge(roles: readonly UserRole[]): string {
  if (hasRole(roles, "SUPER_ADMIN")) return "Super Admin";
  if (hasRole(roles, "HR_ADMIN") && hasRole(roles, "FINANCE_ADMIN")) return "HR Admin + Finance Admin";
  if (hasRole(roles, "HR_ADMIN")) return "HR Admin";
  if (hasRole(roles, "FINANCE_ADMIN")) return "Finance Admin";
  if (hasRole(roles, "MANAGER")) return "Manager";
  if (hasRole(roles, "TEAM_LEAD")) return "Team Lead";
  return "Employee";
}

function getTimeOfDay(): "morning" | "afternoon" | "evening" {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function buildGreeting(fullName: string, roles: readonly UserRole[]): DashboardGreeting {
  return {
    firstName: getFirstName(fullName),
    fullName,
    roleBadge: getRoleBadge(roles),
    timeOfDay: getTimeOfDay()
  };
}

function buildEmptyResponse(persona: DashboardPersona, greeting: DashboardGreeting): DashboardResponseData {
  return {
    persona,
    greeting,
    announcements: [],
    teamOnLeaveToday: [],
    upcomingHolidays: [],
    org: null,
    managerInfo: null,
    onboardingProgress: null,
    leaveBalance: null,
    hasTimePolicy: false,
    recentExpenses: [],
    upcomingShifts: [],
    pendingApprovals: null,
    headcount: null,
    onboardingStatus: null,
    complianceDeadlines: null,
    activeReviewCycles: null,
    headcountTrend: null,
    expiringDocuments: null,
    payroll: null,
    pendingExpenseApprovals: null,
    expensePipeline: null,
    headcountByCountry: null,
    headcountByDept: null,
    recentAuditLog: null,
    complianceHealth: null
  };
}

type SupabaseClient = ReturnType<typeof createSupabaseServiceRoleClient>;

/* ── Data fetching functions ── */

async function fetchAnnouncements(
  supabase: SupabaseClient,
  orgId: string
): Promise<DashboardAnnouncement[]> {
  try {
    const { data, error } = await supabase
      .from("announcements")
      .select("id, title, body, is_pinned, created_at")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(3);

    if (error || !data) return [];

    return data.map((row) => ({
      id: row.id,
      title: row.title ?? "",
      body: row.body ?? "",
      createdAt: row.created_at,
      isPinned: row.is_pinned ?? false
    }));
  } catch {
    return [];
  }
}

async function fetchTeamOnLeaveToday(
  supabase: SupabaseClient,
  orgId: string
): Promise<DashboardTeamOnLeaveItem[]> {
  try {
    const today = toDateString(new Date());

    const { data, error } = await supabase
      .from("leave_requests")
      .select("employee_id, leave_type")
      .eq("org_id", orgId)
      .eq("status", "approved")
      .lte("start_date", today)
      .gte("end_date", today)
      .is("deleted_at", null)
      .limit(20);

    if (error || !data || data.length === 0) return [];

    const employeeIds = [...new Set(data.map((row) => row.employee_id))];

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", employeeIds);

    const nameMap = new Map(
      (profiles ?? []).map((p) => [p.id, p.full_name])
    );

    return data.map((row) => ({
      id: row.employee_id,
      name: nameMap.get(row.employee_id) ?? "Team Member",
      leaveType: row.leave_type ?? "Leave"
    }));
  } catch {
    return [];
  }
}

async function fetchUpcomingHolidays(
  supabase: SupabaseClient,
  orgId: string,
  countryCode: string | null
): Promise<DashboardHolidayItem[]> {
  try {
    const today = toDateString(new Date());

    let query = supabase
      .from("holiday_calendars")
      .select("name, date, country_code")
      .eq("org_id", orgId)
      .gte("date", today)
      .is("deleted_at", null)
      .order("date", { ascending: true })
      .limit(3);

    if (countryCode) {
      query = query.eq("country_code", countryCode);
    }

    const { data, error } = await query;
    if (error || !data) return [];

    return data.map((row) => ({
      name: row.name ?? "Holiday",
      date: row.date,
      countryCode: row.country_code ?? ""
    }));
  } catch {
    return [];
  }
}

async function fetchLeaveBalance(
  supabase: SupabaseClient,
  orgId: string,
  employeeId: string
): Promise<{ byType: DashboardLeaveBalanceItem[]; totalAvailable: number } | null> {
  try {
    const currentYear = new Date().getFullYear();

    const { data, error } = await supabase
      .from("leave_balances")
      .select("leave_type, total_days, used_days, pending_days, carried_days")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .eq("year", currentYear)
      .is("deleted_at", null);

    if (error || !data) return null;

    const byType: DashboardLeaveBalanceItem[] = data
      .filter((row) => (row.total_days ?? 0) + (row.carried_days ?? 0) > 0)
      .map((row) => {
        const allocated = (row.total_days ?? 0) + (row.carried_days ?? 0);
        const used = (row.used_days ?? 0) + (row.pending_days ?? 0);
        return {
          leaveType: row.leave_type ?? "Leave",
          available: Math.max(0, allocated - used),
          allocated
        };
      });

    const totalAvailable = byType.reduce((sum, item) => sum + item.available, 0);

    return { byType, totalAvailable };
  } catch {
    return null;
  }
}

async function fetchUpcomingShifts(
  supabase: SupabaseClient,
  orgId: string,
  employeeId: string
): Promise<DashboardShiftItem[]> {
  try {
    const today = toDateString(new Date());

    const { data, error } = await supabase
      .from("shifts")
      .select("id, shift_date, start_time, end_time")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .gte("shift_date", today)
      .neq("status", "cancelled")
      .is("deleted_at", null)
      .order("shift_date", { ascending: true })
      .order("start_time", { ascending: true })
      .limit(3);

    if (error || !data) return [];

    return data.map((row) => ({
      id: row.id,
      date: row.shift_date,
      startTime: row.start_time ?? "",
      endTime: row.end_time ?? ""
    }));
  } catch {
    return [];
  }
}

async function fetchRecentExpenses(
  supabase: SupabaseClient,
  orgId: string,
  employeeId: string
): Promise<DashboardExpenseItem[]> {
  try {
    const { data, error } = await supabase
      .from("expenses")
      .select("id, description, amount, currency, status, created_at")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(3);

    if (error || !data) return [];

    return data.map((row) => ({
      id: row.id,
      description: row.description ?? "Expense",
      amount: typeof row.amount === "number" ? row.amount : 0,
      currency: row.currency ?? "USD",
      status: row.status ?? "pending",
      createdAt: row.created_at
    }));
  } catch {
    return [];
  }
}

async function fetchPendingApprovals(
  supabase: SupabaseClient,
  orgId: string,
  _userId: string
): Promise<DashboardPendingApprovals> {
  try {
    const [leaveResult, expenseResult, timesheetResult] = await Promise.all([
      supabase
        .from("leave_requests")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "pending")
        .is("deleted_at", null),
      supabase
        .from("expenses")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "pending")
        .is("deleted_at", null),
      supabase
        .from("timesheets")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "submitted")
        .is("deleted_at", null)
    ]);

    const leave = leaveResult.count ?? 0;
    const expenses = expenseResult.count ?? 0;
    const timesheets = timesheetResult.count ?? 0;

    return {
      leave,
      expenses,
      timesheets,
      total: leave + expenses + timesheets
    };
  } catch {
    return { leave: 0, expenses: 0, timesheets: 0, total: 0 };
  }
}

async function fetchHeadcount(
  supabase: SupabaseClient,
  orgId: string
): Promise<{ total: number; delta30d: number }> {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = toDateString(thirtyDaysAgo);

    const [totalResult, newHiresResult] = await Promise.all([
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "active")
        .is("deleted_at", null),
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "active")
        .gte("start_date", thirtyDaysAgoStr)
        .is("deleted_at", null)
    ]);

    return {
      total: totalResult.count ?? 0,
      delta30d: newHiresResult.count ?? 0
    };
  } catch {
    return { total: 0, delta30d: 0 };
  }
}

async function fetchOnboardingStatus(
  supabase: SupabaseClient,
  orgId: string
): Promise<{ active: number; overdue: number }> {
  try {
    const { data, error } = await supabase
      .from("onboarding_instances")
      .select("id, status, started_at")
      .eq("org_id", orgId)
      .eq("status", "active")
      .eq("type", "onboarding")
      .is("deleted_at", null);

    if (error || !data) return { active: 0, overdue: 0 };

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const active = data.length;
    const overdue = data.filter((row) => {
      const started = new Date(row.started_at);
      return started < thirtyDaysAgo;
    }).length;

    return { active, overdue };
  } catch {
    return { active: 0, overdue: 0 };
  }
}

async function fetchComplianceDeadlines(
  supabase: SupabaseClient,
  orgId: string
): Promise<{
  thisMonth: number;
  overdue: number;
  nextDeadline: { name: string; date: string } | null;
}> {
  try {
    const now = new Date();
    const today = toDateString(now);
    const monthEnd = toDateString(
      new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)
    );

    const [overdueResult, thisMonthResult, nextResult] = await Promise.all([
      supabase
        .from("compliance_deadlines")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .neq("status", "completed")
        .lt("due_date", today)
        .is("deleted_at", null),
      supabase
        .from("compliance_deadlines")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .neq("status", "completed")
        .gte("due_date", today)
        .lte("due_date", monthEnd)
        .is("deleted_at", null),
      supabase
        .from("compliance_deadlines")
        .select("id, due_date")
        .eq("org_id", orgId)
        .neq("status", "completed")
        .gte("due_date", today)
        .is("deleted_at", null)
        .order("due_date", { ascending: true })
        .limit(1)
        .maybeSingle()
    ]);

    const nextDeadline = nextResult.data
      ? { name: "Upcoming deadline", date: nextResult.data.due_date }
      : null;

    return {
      thisMonth: thisMonthResult.count ?? 0,
      overdue: overdueResult.count ?? 0,
      nextDeadline
    };
  } catch {
    return { thisMonth: 0, overdue: 0, nextDeadline: null };
  }
}

async function fetchActiveReviewCycles(
  supabase: SupabaseClient,
  orgId: string
): Promise<number> {
  try {
    const { count, error } = await supabase
      .from("review_cycles")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .in("status", ["active", "in_review"])
      .is("deleted_at", null);

    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
}

async function fetchPayrollStatus(
  supabase: SupabaseClient,
  orgId: string
): Promise<{
  lastRunStatus: string | null;
  lastRunDate: string | null;
  nextPayDate: string | null;
}> {
  try {
    const { data, error } = await supabase
      .from("payroll_runs")
      .select("id, status, pay_period_end, created_at")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(2);

    if (error || !data || data.length === 0) {
      return { lastRunStatus: null, lastRunDate: null, nextPayDate: null };
    }

    const lastRun = data[0];

    return {
      lastRunStatus: lastRun.status ?? null,
      lastRunDate: lastRun.pay_period_end ?? lastRun.created_at ?? null,
      nextPayDate: null
    };
  } catch {
    return { lastRunStatus: null, lastRunDate: null, nextPayDate: null };
  }
}

async function fetchPendingExpenseApprovals(
  supabase: SupabaseClient,
  orgId: string
): Promise<{ financeStage: number; totalAmount: number }> {
  try {
    const { data, error } = await supabase
      .from("expenses")
      .select("amount")
      .eq("org_id", orgId)
      .eq("status", "manager_approved")
      .is("deleted_at", null);

    if (error || !data) return { financeStage: 0, totalAmount: 0 };

    const totalAmount = data.reduce((sum, row) => {
      return sum + (typeof row.amount === "number" ? row.amount : 0);
    }, 0);

    return { financeStage: data.length, totalAmount: Math.trunc(totalAmount) };
  } catch {
    return { financeStage: 0, totalAmount: 0 };
  }
}

async function fetchExpensePipeline(
  supabase: SupabaseClient,
  orgId: string
): Promise<{
  submitted: number;
  pendingManager: number;
  pendingFinance: number;
  reimbursed: number;
}> {
  try {
    const [pendingResult, financeResult, reimbursedResult] =
      await Promise.all([
        supabase
          .from("expenses")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("status", "pending")
          .is("deleted_at", null),
        supabase
          .from("expenses")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("status", "manager_approved")
          .is("deleted_at", null),
        supabase
          .from("expenses")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("status", "reimbursed")
          .is("deleted_at", null)
      ]);

    const pendingManager = pendingResult.count ?? 0;
    const pendingFinance = financeResult.count ?? 0;
    const reimbursed = reimbursedResult.count ?? 0;

    return {
      submitted: pendingManager + pendingFinance,
      pendingManager,
      pendingFinance,
      reimbursed
    };
  } catch {
    return { submitted: 0, pendingManager: 0, pendingFinance: 0, reimbursed: 0 };
  }
}

async function fetchRecentAuditLog(
  supabase: SupabaseClient,
  orgId: string
): Promise<DashboardAuditLogEntry[]> {
  try {
    const { data: entries, error } = await supabase
      .from("audit_log")
      .select("id, actor_user_id, action, table_name, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(5);

    if (error || !entries || entries.length === 0) return [];

    const actorIds = [
      ...new Set(
        entries
          .map((e) => e.actor_user_id)
          .filter((id): id is string => typeof id === "string")
      )
    ];

    const { data: actors } = actorIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", actorIds)
      : { data: [] };

    const actorMap = new Map(
      (actors ?? []).map((a) => [a.id, a.full_name])
    );

    return entries.map((entry) => ({
      id: entry.id,
      actorName: actorMap.get(entry.actor_user_id) ?? "System",
      action: entry.action ?? "",
      tableName: entry.table_name ?? "",
      timestamp: entry.created_at
    }));
  } catch {
    return [];
  }
}

async function checkTimePolicy(
  supabase: SupabaseClient,
  orgId: string,
  employmentType: string | null,
  department: string | null
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("time_policies")
      .select("id, applies_to_departments, applies_to_types, is_active")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .is("deleted_at", null);

    if (error || !data || data.length === 0) return false;

    return data.some((policy) => {
      const depts = Array.isArray(policy.applies_to_departments)
        ? policy.applies_to_departments
        : null;
      const types = Array.isArray(policy.applies_to_types)
        ? policy.applies_to_types
        : null;

      const deptMatch = !depts || depts.length === 0 || (department && depts.includes(department));
      const typeMatch = !types || types.length === 0 || (employmentType && types.includes(employmentType));

      return deptMatch && typeMatch;
    });
  } catch {
    return false;
  }
}

async function fetchHeadcountByCountry(
  supabase: SupabaseClient,
  orgId: string
): Promise<{ countryCode: string; count: number }[]> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("country_code")
      .eq("org_id", orgId)
      .eq("status", "active")
      .is("deleted_at", null);

    if (error || !data) return [];

    const counts = new Map<string, number>();
    for (const row of data) {
      const cc = row.country_code ?? "Unknown";
      counts.set(cc, (counts.get(cc) ?? 0) + 1);
    }

    return [...counts.entries()]
      .map(([countryCode, count]) => ({ countryCode, count }))
      .sort((a, b) => b.count - a.count);
  } catch {
    return [];
  }
}

async function fetchHeadcountByDept(
  supabase: SupabaseClient,
  orgId: string
): Promise<{ department: string; count: number }[]> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("department")
      .eq("org_id", orgId)
      .eq("status", "active")
      .is("deleted_at", null);

    if (error || !data) return [];

    const counts = new Map<string, number>();
    for (const row of data) {
      const dept = row.department ?? "Unassigned";
      counts.set(dept, (counts.get(dept) ?? 0) + 1);
    }

    return [...counts.entries()]
      .map(([department, count]) => ({ department, count }))
      .sort((a, b) => b.count - a.count);
  } catch {
    return [];
  }
}

async function fetchExpiringDocuments(
  supabase: SupabaseClient,
  orgId: string
): Promise<{ count: number; items: { id: string; title: string; expiryDate: string }[] }> {
  try {
    const now = new Date();
    const today = toDateString(now);
    const thirtyDaysLater = new Date(now);
    thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
    const thirtyDaysLaterStr = toDateString(thirtyDaysLater);

    const { data, error, count } = await supabase
      .from("documents")
      .select("id, title, expiry_date", { count: "exact" })
      .eq("org_id", orgId)
      .gte("expiry_date", today)
      .lte("expiry_date", thirtyDaysLaterStr)
      .is("deleted_at", null)
      .order("expiry_date", { ascending: true })
      .limit(5);

    if (error) return { count: 0, items: [] };

    return {
      count: count ?? (data?.length ?? 0),
      items: (data ?? []).map((doc) => ({
        id: doc.id,
        title: doc.title ?? "Document",
        expiryDate: doc.expiry_date ?? ""
      }))
    };
  } catch {
    return { count: 0, items: [] };
  }
}

async function fetchComplianceHealth(
  supabase: SupabaseClient,
  orgId: string
): Promise<{ completed: number; inProgress: number; overdue: number }> {
  try {
    const now = new Date();
    const today = toDateString(now);
    const monthStart = toDateString(
      new Date(now.getUTCFullYear(), now.getUTCMonth(), 1)
    );
    const monthEnd = toDateString(
      new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)
    );

    const { data, error } = await supabase
      .from("compliance_deadlines")
      .select("id, status, due_date")
      .eq("org_id", orgId)
      .gte("due_date", monthStart)
      .lte("due_date", monthEnd)
      .is("deleted_at", null);

    if (error || !data) return { completed: 0, inProgress: 0, overdue: 0 };

    let completed = 0;
    let inProgress = 0;
    let overdue = 0;

    for (const row of data) {
      if (row.status === "completed") {
        completed++;
      } else if (row.due_date < today) {
        overdue++;
      } else {
        inProgress++;
      }
    }

    return { completed, inProgress, overdue };
  } catch {
    return { completed: 0, inProgress: 0, overdue: 0 };
  }
}

/* ── Main handler ── */

export async function GET() {
  try {
    const session = await getAuthenticatedSession();

    if (!session?.profile) {
      return jsonResponse<null>(401, {
        data: null,
        error: { code: "UNAUTHORIZED", message: "Authentication required." },
        meta: buildMeta()
      });
    }

    const profile = session.profile;
    const roles = normalizeUserRoles(profile.roles);
    const supabase = createSupabaseServiceRoleClient();

    /* ── Step 1: Determine persona ── */

    const [profileExtrasResult, onboardingResult] = await Promise.all([
      supabase
        .from("profiles")
        .select("start_date, employment_type")
        .eq("id", profile.id)
        .single(),
      supabase
        .from("onboarding_instances")
        .select("id, status, started_at")
        .eq("employee_id", profile.id)
        .eq("type", "onboarding")
        .eq("status", "active")
        .is("deleted_at", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    ]);

    const startDate = profileExtrasResult.data?.start_date ?? null;
    const employmentType = profileExtrasResult.data?.employment_type ?? null;
    const activeOnboarding = onboardingResult.data;

    const persona = getDashboardPersona(
      { roles, startDate },
      activeOnboarding ? { status: activeOnboarding.status } : null
    );

    const greeting = buildGreeting(profile.full_name, roles);
    const response = buildEmptyResponse(persona, greeting);

    /* ── Step 2: Fetch universal data (all personas) ── */

    const [announcements, teamOnLeaveToday, upcomingHolidays] =
      await Promise.all([
        fetchAnnouncements(supabase, profile.org_id),
        fetchTeamOnLeaveToday(supabase, profile.org_id),
        fetchUpcomingHolidays(supabase, profile.org_id, profile.country_code)
      ]);

    response.announcements = announcements;
    response.teamOnLeaveToday = teamOnLeaveToday;
    response.upcomingHolidays = upcomingHolidays;

    /* ── Step 3: Fetch persona-specific data ── */

    switch (persona) {
      case "new_hire": {
        const orgName = session.org?.name ?? "your company";

        response.org = {
          name: orgName,
          description: `Welcome to ${orgName}! Check your onboarding checklist to get started.`
        };

        if (profile.manager_id) {
          const { data: manager } = await supabase
            .from("profiles")
            .select("full_name, title, avatar_url")
            .eq("id", profile.manager_id)
            .single();

          if (manager) {
            response.managerInfo = {
              name: manager.full_name ?? "Your Manager",
              title: manager.title ?? null,
              avatarUrl: manager.avatar_url ?? null
            };
          }
        }

        if (activeOnboarding) {
          const { data: tasks } = await supabase
            .from("onboarding_tasks")
            .select("id, status")
            .eq("instance_id", activeOnboarding.id)
            .is("deleted_at", null);

          const taskList = tasks ?? [];
          response.onboardingProgress = {
            tasksTotal: taskList.length,
            tasksCompleted: taskList.filter((t) => t.status === "completed").length,
            instanceId: activeOnboarding.id
          };
        }

        break;
      }

      case "employee": {
        const [leaveBalance, upcomingShifts, recentExpenses, hasPolicy] =
          await Promise.all([
            fetchLeaveBalance(supabase, profile.org_id, profile.id),
            fetchUpcomingShifts(supabase, profile.org_id, profile.id),
            fetchRecentExpenses(supabase, profile.org_id, profile.id),
            checkTimePolicy(supabase, profile.org_id, employmentType, profile.department)
          ]);

        response.leaveBalance = leaveBalance;
        response.upcomingShifts = upcomingShifts;
        response.recentExpenses = recentExpenses;
        response.hasTimePolicy = hasPolicy;
        break;
      }

      case "manager": {
        const [
          pendingApprovals,
          leaveBalance,
          upcomingShifts,
          recentExpenses,
          hasPolicy
        ] = await Promise.all([
          fetchPendingApprovals(supabase, profile.org_id, profile.id),
          fetchLeaveBalance(supabase, profile.org_id, profile.id),
          fetchUpcomingShifts(supabase, profile.org_id, profile.id),
          fetchRecentExpenses(supabase, profile.org_id, profile.id),
          checkTimePolicy(supabase, profile.org_id, employmentType, profile.department)
        ]);

        response.pendingApprovals = pendingApprovals;
        response.leaveBalance = leaveBalance;
        response.upcomingShifts = upcomingShifts;
        response.recentExpenses = recentExpenses;
        response.hasTimePolicy = hasPolicy;
        break;
      }

      case "hr_admin": {
        const [
          headcount,
          onboardingStatus,
          complianceDeadlines,
          activeReviewCycles,
          expiringDocuments,
          leaveBalance,
          hasPolicy
        ] = await Promise.all([
          fetchHeadcount(supabase, profile.org_id),
          fetchOnboardingStatus(supabase, profile.org_id),
          fetchComplianceDeadlines(supabase, profile.org_id),
          fetchActiveReviewCycles(supabase, profile.org_id),
          fetchExpiringDocuments(supabase, profile.org_id),
          fetchLeaveBalance(supabase, profile.org_id, profile.id),
          checkTimePolicy(supabase, profile.org_id, employmentType, profile.department)
        ]);

        response.headcount = headcount;
        response.onboardingStatus = onboardingStatus;
        response.complianceDeadlines = complianceDeadlines;
        response.activeReviewCycles = activeReviewCycles;
        response.expiringDocuments = expiringDocuments;
        response.leaveBalance = leaveBalance;
        response.hasTimePolicy = hasPolicy;
        break;
      }

      case "finance_admin": {
        const [
          payroll,
          pendingExpenseApprovals,
          expensePipeline,
          leaveBalance,
          hasPolicy
        ] = await Promise.all([
          fetchPayrollStatus(supabase, profile.org_id),
          fetchPendingExpenseApprovals(supabase, profile.org_id),
          fetchExpensePipeline(supabase, profile.org_id),
          fetchLeaveBalance(supabase, profile.org_id, profile.id),
          checkTimePolicy(supabase, profile.org_id, employmentType, profile.department)
        ]);

        response.payroll = payroll;
        response.pendingExpenseApprovals = pendingExpenseApprovals;
        response.expensePipeline = expensePipeline;
        response.leaveBalance = leaveBalance;
        response.hasTimePolicy = hasPolicy;
        break;
      }

      case "super_admin": {
        const [
          headcount,
          headcountByCountry,
          headcountByDept,
          pendingApprovals,
          payroll,
          complianceDeadlines,
          complianceHealth,
          recentAuditLog,
          expiringDocuments,
          leaveBalance,
          hasPolicy
        ] = await Promise.all([
          fetchHeadcount(supabase, profile.org_id),
          fetchHeadcountByCountry(supabase, profile.org_id),
          fetchHeadcountByDept(supabase, profile.org_id),
          fetchPendingApprovals(supabase, profile.org_id, profile.id),
          fetchPayrollStatus(supabase, profile.org_id),
          fetchComplianceDeadlines(supabase, profile.org_id),
          fetchComplianceHealth(supabase, profile.org_id),
          fetchRecentAuditLog(supabase, profile.org_id),
          fetchExpiringDocuments(supabase, profile.org_id),
          fetchLeaveBalance(supabase, profile.org_id, profile.id),
          checkTimePolicy(supabase, profile.org_id, employmentType, profile.department)
        ]);

        response.headcount = headcount;
        response.headcountByCountry = headcountByCountry;
        response.headcountByDept = headcountByDept;
        response.pendingApprovals = pendingApprovals;
        response.payroll = payroll;
        response.complianceDeadlines = complianceDeadlines;
        response.complianceHealth = complianceHealth;
        response.recentAuditLog = recentAuditLog;
        response.expiringDocuments = expiringDocuments;
        response.leaveBalance = leaveBalance;
        response.hasTimePolicy = hasPolicy;
        break;
      }
    }

    return jsonResponse<DashboardResponseData>(200, {
      data: response,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "INTERNAL_ERROR",
        message:
          error instanceof Error ? error.message : "Unexpected dashboard error."
      },
      meta: buildMeta()
    });
  }
}
