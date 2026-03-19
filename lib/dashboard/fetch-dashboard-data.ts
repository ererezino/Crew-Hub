import "server-only";

import { z } from "zod";

import {
  DASHBOARD_WIDGET_KEYS,
  defaultWidgetVisibilityForRoles,
  getDefaultVisibleRolesForWidget,
  isSuperAdmin,
  isWidgetVisibleForUser,
  sanitizeRoles,
  type DashboardWidgetKey
} from "../access-control";
import type { SessionOrg, SessionProfile } from "../auth/session";
import { getDashboardPersona, type DashboardPersona } from "../dashboard-persona";
import { normalizeUserRoles, type UserRole } from "../navigation";
import { formatCurrency } from "../format-currency";
import { hasRole } from "../roles";
import { getOrgHealthAlerts } from "./health-alerts";
import { createSupabaseServiceRoleClient } from "../supabase/service-role";
import type {
  DashboardAnnouncement,
  DashboardApprovalItem,
  DashboardAuditLogEntry,
  DashboardExpenseItem,
  DashboardGreeting,
  DashboardHolidayItem,
  DashboardLeaveBalanceItem,
  DashboardManagerOnboardingItem,
  DashboardPendingApprovals,
  DashboardResponseData,
  DashboardShiftItem,
  DashboardTeamOnLeaveItem,
  FinanceOversightData
} from "../../types/dashboard";

/* ── Helpers ── */

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
  if (hasRole(roles, "FINANCE_APPROVER")) return "Finance Approver";
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
    recentExpenses: [],
    upcomingShifts: [],
    pendingApprovals: null,
    pendingApprovalItems: null,
    managerOnboarding: null,
    headcount: null,
    onboardingStatus: null,
    complianceDeadlines: null,
    activeReviewCycles: null,
    headcountTrend: null,
    expiringDocuments: null,
    payroll: null,
    pendingExpenseApprovals: null,
    expenseSpendSummary: null,
    expensePipeline: null,
    headcountByCountry: null,
    headcountByDept: null,
    recentAuditLog: null,
    complianceHealth: null,
    financeOversight: null,
    healthAlerts: null
  };
}

type SupabaseClient = ReturnType<typeof createSupabaseServiceRoleClient>;

const widgetConfigRowSchema = z.object({
  widget_key: z.enum(DASHBOARD_WIDGET_KEYS),
  visible_to_roles: z.array(z.string())
});

async function resolveAllowedWidgetKeys(
  supabase: SupabaseClient,
  orgId: string,
  userRoles: readonly UserRole[]
): Promise<Set<DashboardWidgetKey>> {
  if (isSuperAdmin(userRoles)) {
    return new Set(DASHBOARD_WIDGET_KEYS);
  }

  try {
    const { data, error } = await supabase
      .from("dashboard_widget_config")
      .select("widget_key, visible_to_roles")
      .eq("org_id", orgId);

    if (error) {
      return new Set(defaultWidgetVisibilityForRoles(userRoles));
    }

    const parsed = z.array(widgetConfigRowSchema).safeParse(data ?? []);

    if (!parsed.success || parsed.data.length === 0) {
      return new Set(defaultWidgetVisibilityForRoles(userRoles));
    }

    const byKey = new Map(parsed.data.map((row) => [row.widget_key, row] as const));
    const allowedKeys = DASHBOARD_WIDGET_KEYS.filter((widgetKey) => {
      const row = byKey.get(widgetKey);
      const visibleToRoles = row
        ? sanitizeRoles(row.visible_to_roles)
        : getDefaultVisibleRolesForWidget(widgetKey);

      return isWidgetVisibleForUser({
        userRoles,
        visibleToRoles
      });
    });

    return new Set(allowedKeys);
  } catch {
    return new Set(defaultWidgetVisibilityForRoles(userRoles));
  }
}

function applyWidgetVisibility(
  response: DashboardResponseData,
  allowedWidgetKeys: Set<DashboardWidgetKey>
): DashboardResponseData {
  if (!allowedWidgetKeys.has("hero_metrics")) {
    response.onboardingProgress = null;
    response.leaveBalance = null;
    response.upcomingShifts = [];
    response.pendingApprovals = null;
    response.pendingExpenseApprovals = null;
    response.headcount = null;
    response.onboardingStatus = null;
    response.activeReviewCycles = null;
  }

  if (!allowedWidgetKeys.has("primary_chart")) {
    response.headcountTrend = null;
  }

  if (!allowedWidgetKeys.has("expense_widget")) {
    response.recentExpenses = [];
    response.pendingExpenseApprovals = null;
    response.expenseSpendSummary = null;
    response.expensePipeline = null;
  }

  if (!allowedWidgetKeys.has("compliance_widget")) {
    response.complianceDeadlines = null;
    response.complianceHealth = null;
    response.expiringDocuments = null;
  }

  if (!allowedWidgetKeys.has("secondary_panels")) {
    response.teamOnLeaveToday = [];
    response.upcomingHolidays = [];
    response.pendingApprovalItems = null;
    response.managerOnboarding = null;
    response.headcountByCountry = null;
    response.headcountByDept = null;
    response.recentAuditLog = null;
    response.healthAlerts = null;
  }

  return response;
}

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

type ManagerReportProfile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

async function fetchManagerReports(
  supabase: SupabaseClient,
  orgId: string,
  managerUserId: string
): Promise<ManagerReportProfile[]> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .eq("org_id", orgId)
      .eq("manager_id", managerUserId)
      .is("deleted_at", null);

    if (error || !data || data.length === 0) {
      return [];
    }

    return data as ManagerReportProfile[];
  } catch {
    return [];
  }
}

async function fetchPendingApprovals(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  managerReports?: ManagerReportProfile[]
): Promise<DashboardPendingApprovals> {
  try {
    const reports =
      managerReports ??
      (await fetchManagerReports(supabase, orgId, userId));
    const reportIds = reports.map((report) => report.id);

    if (reportIds.length === 0) {
      return { leave: 0, expenses: 0, total: 0 };
    }

    const [leaveResult, expenseResult] = await Promise.all([
      supabase
        .from("leave_requests")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "pending")
        .in("employee_id", reportIds)
        .is("deleted_at", null),
      supabase
        .from("expenses")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "pending")
        .in("employee_id", reportIds)
        .is("deleted_at", null)
    ]);

    const leave = leaveResult.count ?? 0;
    const expenses = expenseResult.count ?? 0;

    return {
      leave,
      expenses,
      total: leave + expenses
    };
  } catch {
    return { leave: 0, expenses: 0, total: 0 };
  }
}

async function fetchPendingApprovalItems(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  managerReports?: ManagerReportProfile[]
): Promise<DashboardApprovalItem[]> {
  try {
    const reports =
      managerReports ??
      (await fetchManagerReports(supabase, orgId, userId));
    const reportIds = reports.map((report) => report.id);

    if (reportIds.length === 0) return [];

    const nameMap = new Map<string, string>();
    for (const r of reports) {
      nameMap.set(r.id, r.full_name ?? "Team member");
    }

    const [leaveResult, expenseResult] = await Promise.all([
      supabase
        .from("leave_requests")
        .select("id, employee_id, leave_type, start_date, end_date, total_days, created_at")
        .eq("org_id", orgId)
        .eq("status", "pending")
        .in("employee_id", reportIds)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("expenses")
        .select("id, employee_id, description, amount, currency, created_at")
        .eq("org_id", orgId)
        .eq("status", "pending")
        .in("employee_id", reportIds)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(5)
    ]);

    const items: DashboardApprovalItem[] = [];

    if (leaveResult.data) {
      for (const lr of leaveResult.data) {
        const empName = nameMap.get(lr.employee_id) ?? "Team member";
        const days = lr.total_days ?? 1;
        items.push({
          id: lr.id,
          type: "leave",
          title: `${empName}`,
          subtitle: `${lr.leave_type ?? "Leave"} - ${days} day${days !== 1 ? "s" : ""}`,
          detail: `${lr.start_date ?? ""} to ${lr.end_date ?? ""}`,
          date: lr.created_at ? toDateString(new Date(lr.created_at)) : ""
        });
      }
    }

    if (expenseResult.data) {
      for (const ex of expenseResult.data) {
        const empName = nameMap.get(ex.employee_id) ?? "Team member";
        const amount = typeof ex.amount === "number" ? ex.amount : 0;
        const currency = ex.currency ?? "USD";
        items.push({
          id: ex.id,
          type: "expense",
          title: `${empName}`,
          subtitle: ex.description ?? "Expense",
          detail: formatCurrency(amount / 100, currency),
          date: ex.created_at ? toDateString(new Date(ex.created_at)) : ""
        });
      }
    }

    // Sort by date descending (most recent first), limit to 6 items max
    items.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
    return items.slice(0, 6);
  } catch {
    return [];
  }
}

type ManagerOnboardingInstanceRow = {
  id: string;
  employee_id: string;
  started_at: string;
};

type ManagerOnboardingTaskRow = {
  instance_id: string;
  status: string;
  assigned_to: string | null;
  due_date: string | null;
};

async function fetchManagerOnboarding(
  supabase: SupabaseClient,
  orgId: string,
  managerUserId: string,
  managerReports?: ManagerReportProfile[]
): Promise<DashboardManagerOnboardingItem[]> {
  try {
    const reports =
      managerReports ??
      (await fetchManagerReports(supabase, orgId, managerUserId));

    if (reports.length === 0) {
      return [];
    }

    const reportIds = reports
      .map((row) => row.id)
      .filter((value): value is string => typeof value === "string");

    if (reportIds.length === 0) {
      return [];
    }

    const { data: rawInstances, error: instancesError } = await supabase
      .from("onboarding_instances")
      .select("id, employee_id, started_at")
      .eq("org_id", orgId)
      .eq("status", "active")
      .eq("type", "onboarding")
      .is("deleted_at", null)
      .in("employee_id", reportIds);

    if (instancesError || !rawInstances || rawInstances.length === 0) {
      return [];
    }

    const instances = rawInstances as ManagerOnboardingInstanceRow[];
    const instanceIds = instances
      .map((row) => row.id)
      .filter((value): value is string => typeof value === "string");

    const { data: rawTasks, error: tasksError } = await supabase
      .from("onboarding_tasks")
      .select("instance_id, status, assigned_to, due_date")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .in("instance_id", instanceIds);

    if (tasksError) {
      return [];
    }

    const tasks = (rawTasks ?? []) as ManagerOnboardingTaskRow[];
    const tasksByInstanceId = new Map<string, ManagerOnboardingTaskRow[]>();

    for (const task of tasks) {
      const instanceTasks = tasksByInstanceId.get(task.instance_id) ?? [];
      instanceTasks.push(task);
      tasksByInstanceId.set(task.instance_id, instanceTasks);
    }

    const reportById = new Map(reports.map((row) => [row.id, row]));
    const today = toDateString(new Date());

    const items: DashboardManagerOnboardingItem[] = instances
      .map((instance) => {
        const employee = reportById.get(instance.employee_id);

        if (!employee) {
          return null;
        }

        const instanceTasks = tasksByInstanceId.get(instance.id) ?? [];
        const tasksTotal = instanceTasks.length;
        const tasksCompleted = instanceTasks.filter((task) => task.status === "completed").length;
        const overdueManagerTaskCount = instanceTasks.filter(
          (task) =>
            task.assigned_to === managerUserId &&
            task.status !== "completed" &&
            typeof task.due_date === "string" &&
            task.due_date < today
        ).length;

        const startedAtTimestamp = Date.parse(instance.started_at);
        const daysSinceStart = Number.isNaN(startedAtTimestamp)
          ? 0
          : Math.max(0, Math.floor((Date.now() - startedAtTimestamp) / (24 * 60 * 60 * 1000)));

        return {
          employeeId: instance.employee_id,
          employeeName: employee.full_name ?? "Team member",
          employeeAvatarUrl: employee.avatar_url ?? null,
          instanceId: instance.id,
          tasksTotal,
          tasksCompleted,
          daysSinceStart,
          overdueManagerTaskCount
        };
      })
      .filter((value): value is DashboardManagerOnboardingItem => value !== null)
      .sort((left, right) => {
        if (left.overdueManagerTaskCount !== right.overdueManagerTaskCount) {
          return right.overdueManagerTaskCount - left.overdueManagerTaskCount;
        }

        return right.daysSinceStart - left.daysSinceStart;
      });

    return items;
  } catch {
    return [];
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

async function fetchExpenseSpendSummary(
  supabase: SupabaseClient,
  orgId: string
): Promise<{
  monthToDate: number;
  yearToDate: number;
  currency: string;
  mixedCurrency: boolean;
}> {
  try {
    const now = new Date();
    const today = toDateString(now);
    const yearStart = `${now.getUTCFullYear()}-01-01`;
    const monthStart = `${today.slice(0, 7)}-01`;

    const { data, error } = await supabase
      .from("expenses")
      .select("amount, currency, expense_date")
      .eq("org_id", orgId)
      .eq("status", "reimbursed")
      .gte("expense_date", yearStart)
      .lte("expense_date", today)
      .is("deleted_at", null);

    if (error || !data || data.length === 0) {
      return {
        monthToDate: 0,
        yearToDate: 0,
        currency: "USD",
        mixedCurrency: false
      };
    }

    const currencyCounts = new Map<string, number>();
    for (const row of data) {
      const currency = typeof row.currency === "string" && row.currency.trim()
        ? row.currency.trim().toUpperCase()
        : "USD";
      currencyCounts.set(currency, (currencyCounts.get(currency) ?? 0) + 1);
    }

    const primaryCurrency = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";
    const mixedCurrency = currencyCounts.size > 1;

    let yearToDate = 0;
    let monthToDate = 0;

    for (const row of data) {
      const currency = typeof row.currency === "string" && row.currency.trim()
        ? row.currency.trim().toUpperCase()
        : "USD";

      if (currency !== primaryCurrency) {
        continue;
      }

      const amount = typeof row.amount === "number" ? row.amount : 0;
      yearToDate += amount;

      if (typeof row.expense_date === "string" && row.expense_date >= monthStart) {
        monthToDate += amount;
      }
    }

    return {
      monthToDate,
      yearToDate,
      currency: primaryCurrency,
      mixedCurrency
    };
  } catch {
    return {
      monthToDate: 0,
      yearToDate: 0,
      currency: "USD",
      mixedCurrency: false
    };
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
    const { data, error } = await supabase
      .from("expenses")
      .select("status")
      .eq("org_id", orgId)
      .in("status", ["pending", "manager_approved", "additional_approved", "reimbursed"])
      .is("deleted_at", null);

    if (error || !data) {
      return { submitted: 0, pendingManager: 0, pendingFinance: 0, reimbursed: 0 };
    }

    let pendingManager = 0;
    let managerApproved = 0;
    let additionalApproved = 0;
    let reimbursed = 0;

    for (const row of data) {
      switch (row.status) {
        case "pending": pendingManager++; break;
        case "manager_approved": managerApproved++; break;
        case "additional_approved": additionalApproved++; break;
        case "reimbursed": reimbursed++; break;
      }
    }

    return {
      submitted: pendingManager + managerApproved + additionalApproved,
      pendingManager,
      pendingFinance: managerApproved + additionalApproved,
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

async function fetchHeadcountBreakdowns(
  supabase: SupabaseClient,
  orgId: string
): Promise<{
  byCountry: { countryCode: string; count: number }[];
  byDept: { department: string; count: number }[];
}> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("country_code, department")
      .eq("org_id", orgId)
      .eq("status", "active")
      .is("deleted_at", null);

    if (error || !data) return { byCountry: [], byDept: [] };

    const countryCounts = new Map<string, number>();
    const deptCounts = new Map<string, number>();

    for (const row of data) {
      const cc = row.country_code ?? "Unknown";
      countryCounts.set(cc, (countryCounts.get(cc) ?? 0) + 1);

      const dept = row.department ?? "Unassigned";
      deptCounts.set(dept, (deptCounts.get(dept) ?? 0) + 1);
    }

    return {
      byCountry: [...countryCounts.entries()]
        .map(([countryCode, count]) => ({ countryCode, count }))
        .sort((a, b) => b.count - a.count),
      byDept: [...deptCounts.entries()]
        .map(([department, count]) => ({ department, count }))
        .sort((a, b) => b.count - a.count)
    };
  } catch {
    return { byCountry: [], byDept: [] };
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

/* ── Finance oversight aggregator ── */

async function fetchFinanceOversight(
  supabase: SupabaseClient,
  orgId: string
): Promise<FinanceOversightData> {
  const empty: FinanceOversightData = {
    pendingPayrollApprovals: [],
    pendingSalaryApprovals: { count: 0 },
    historicalAwaitingAction: [],
    completionGaps: [],
    payoutBlockers: [],
    activeCycles: []
  };

  try {
    const [
      submittedRunsResult,
      pendingSalaryResult,
      historicalRunsResult,
      stuckRunsResult,
      flaggedRunsResult,
      activeCyclesResult
    ] = await Promise.all([
      /* 1. Payroll runs awaiting approval (status = submitted) */
      supabase
        .from("payroll_runs")
        .select("id, pay_period_start, pay_period_end, status, employee_count, submitted_at")
        .eq("org_id", orgId)
        .eq("status", "submitted")
        .is("deleted_at", null)
        .order("submitted_at", { ascending: false })
        .limit(10),

      /* 2. Pending salary approvals */
      supabase
        .from("compensation_records")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("salary_status", "pending")
        .is("deleted_at", null),

      /* 3. Historical runs needing review/authorize/publish */
      supabase
        .from("payroll_runs")
        .select("id, pay_period_start, pay_period_end, reviewed_at, authorized_at, published_at")
        .eq("org_id", orgId)
        .eq("is_historical", true)
        .is("deleted_at", null)
        .or("reviewed_at.is.null,authorized_at.is.null,published_at.is.null")
        .order("created_at", { ascending: false })
        .limit(10),

      /* 4. Completion gaps — runs stuck mid-flow (calculated/approved/processing but not progressing) */
      supabase
        .from("payroll_runs")
        .select("id, pay_period_start, pay_period_end, status, created_at")
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .in("status", ["calculated", "approved", "processing"])
        .eq("is_historical", false)
        .order("created_at", { ascending: true })
        .limit(10),

      /* 5. Runs with flagged items — payout blockers */
      supabase
        .from("payroll_items")
        .select("payroll_run_id")
        .eq("org_id", orgId)
        .eq("flagged", true)
        .is("deleted_at", null),

      /* 6. Active (non-paid) cycles */
      supabase
        .from("payroll_cycles")
        .select("id, payroll_run_id, label, status, total_net, currency, created_at, payroll_runs!inner(pay_period_start, pay_period_end)")
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .in("status", ["draft", "ready", "processing"])
        .order("created_at", { ascending: false })
        .limit(10)
    ]);

    /* 1. Pending payroll approvals */
    if (submittedRunsResult.data) {
      for (const row of submittedRunsResult.data) {
        const period = (row.pay_period_end ?? row.pay_period_start ?? "") as string;
        empty.pendingPayrollApprovals.push({
          id: row.id as string,
          payPeriod: period,
          status: row.status as string,
          employeeCount: (row.employee_count as number) ?? 0,
          submittedAt: (row.submitted_at as string) ?? null
        });
      }
    }

    /* 2. Pending salary approvals */
    empty.pendingSalaryApprovals = {
      count: pendingSalaryResult.count ?? 0
    };

    /* 3. Historical runs */
    if (historicalRunsResult.data) {
      for (const row of historicalRunsResult.data) {
        const period = ((row.pay_period_end ?? row.pay_period_start ?? "") as string);
        let nextStep: "review" | "authorize" | "publish" = "review";
        if (row.reviewed_at && !row.authorized_at) nextStep = "authorize";
        else if (row.reviewed_at && row.authorized_at && !row.published_at) nextStep = "publish";
        else if (row.reviewed_at && row.authorized_at && row.published_at) continue;

        empty.historicalAwaitingAction.push({
          id: row.id as string,
          payPeriod: period,
          nextStep
        });
      }
    }

    /* 4. Completion gaps */
    if (stuckRunsResult.data) {
      for (const row of stuckRunsResult.data) {
        const period = ((row.pay_period_end ?? row.pay_period_start ?? "") as string);
        empty.completionGaps.push({
          id: row.id as string,
          payPeriod: period,
          status: row.status as string,
          createdAt: (row.created_at as string) ?? ""
        });
      }
    }

    /* 5. Payout blockers — aggregate flagged items by run */
    if (flaggedRunsResult.data) {
      const flagsByRun = new Map<string, number>();
      for (const row of flaggedRunsResult.data) {
        const runId = row.payroll_run_id as string;
        flagsByRun.set(runId, (flagsByRun.get(runId) ?? 0) + 1);
      }

      /* Only include runs that are in active statuses */
      const activeRunIds = new Set<string>();
      if (stuckRunsResult.data) {
        for (const row of stuckRunsResult.data) {
          activeRunIds.add(row.id as string);
        }
      }
      if (submittedRunsResult.data) {
        for (const row of submittedRunsResult.data) {
          activeRunIds.add(row.id as string);
        }
      }

      for (const [runId, count] of flagsByRun) {
        if (activeRunIds.has(runId)) {
          empty.payoutBlockers.push({
            runId,
            payPeriod: "",
            flaggedCount: count
          });
        }
      }
    }

    /* 6. Active cycles */
    if (activeCyclesResult.data) {
      for (const row of activeCyclesResult.data) {
        const runData = row.payroll_runs as unknown as { pay_period_start?: string; pay_period_end?: string } | null;
        const period = (runData?.pay_period_end ?? runData?.pay_period_start ?? "") as string;
        empty.activeCycles.push({
          runId: row.payroll_run_id as string,
          cycleId: row.id as string,
          label: (row.label as string) ?? null,
          status: row.status as string,
          totalNet: (row.total_net as number) ?? 0,
          currency: (row.currency as string) ?? "NGN",
          payPeriod: period
        });
      }
    }

    return empty;
  } catch {
    return empty;
  }
}

/* ── Main orchestrator ── */

export async function fetchDashboardData(
  profile: SessionProfile,
  org: SessionOrg | null
): Promise<DashboardResponseData> {
  const roles = normalizeUserRoles(profile.roles);
  const supabase = createSupabaseServiceRoleClient();

  /* Step 1: Determine persona */

  const roleBasedPersona: DashboardPersona | null = hasRole(roles, "SUPER_ADMIN")
    ? "super_admin"
    : hasRole(roles, "FINANCE_APPROVER")
    ? "finance_approver"
    : hasRole(roles, "FINANCE_ADMIN")
    ? "finance_admin"
    : hasRole(roles, "HR_ADMIN")
    ? "hr_admin"
    : hasRole(roles, "MANAGER") || hasRole(roles, "TEAM_LEAD")
    ? "manager"
    : null;

  const activeOnboarding = roleBasedPersona
    ? null
    : (
        await supabase
          .from("onboarding_instances")
          .select("id, status, started_at")
          .eq("employee_id", profile.id)
          .eq("type", "onboarding")
          .eq("status", "active")
          .is("deleted_at", null)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data;

  const persona =
    roleBasedPersona ??
    getDashboardPersona(
      { roles, startDate: profile.start_date },
      activeOnboarding ? { status: activeOnboarding.status } : null
    );
  const allowedWidgetKeys = await resolveAllowedWidgetKeys(
    supabase,
    profile.org_id,
    roles
  );

  const greeting = buildGreeting(profile.full_name, roles);
  const response = buildEmptyResponse(persona, greeting);

  /* Step 2: Fetch universal data (all personas) */

  const [announcements, teamOnLeaveToday, upcomingHolidays] =
    await Promise.all([
      fetchAnnouncements(supabase, profile.org_id),
      fetchTeamOnLeaveToday(supabase, profile.org_id),
      fetchUpcomingHolidays(supabase, profile.org_id, profile.country_code)
    ]);

  response.announcements = announcements;
  response.teamOnLeaveToday = teamOnLeaveToday;
  response.upcomingHolidays = upcomingHolidays;

  /* Step 3: Fetch persona-specific data */

  switch (persona) {
    case "new_hire": {
      const orgName = org?.name ?? "your company";

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
      const [leaveBalance, upcomingShifts, recentExpenses] =
        await Promise.all([
          fetchLeaveBalance(supabase, profile.org_id, profile.id),
          fetchUpcomingShifts(supabase, profile.org_id, profile.id),
          fetchRecentExpenses(supabase, profile.org_id, profile.id)
        ]);

      response.leaveBalance = leaveBalance;
      response.upcomingShifts = upcomingShifts;
      response.recentExpenses = recentExpenses;
      break;
    }

    case "manager": {
      const managerReports = await fetchManagerReports(
        supabase,
        profile.org_id,
        profile.id
      );

      const [
        pendingApprovals,
        pendingApprovalItems,
        managerOnboarding,
        leaveBalance,
        upcomingShifts,
        recentExpenses
      ] = await Promise.all([
        fetchPendingApprovals(supabase, profile.org_id, profile.id, managerReports),
        fetchPendingApprovalItems(supabase, profile.org_id, profile.id, managerReports),
        fetchManagerOnboarding(supabase, profile.org_id, profile.id, managerReports),
        fetchLeaveBalance(supabase, profile.org_id, profile.id),
        fetchUpcomingShifts(supabase, profile.org_id, profile.id),
        fetchRecentExpenses(supabase, profile.org_id, profile.id)
      ]);

      response.pendingApprovals = pendingApprovals;
      response.pendingApprovalItems = pendingApprovalItems;
      response.managerOnboarding = managerOnboarding;
      response.leaveBalance = leaveBalance;
      response.upcomingShifts = upcomingShifts;
      response.recentExpenses = recentExpenses;
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
        healthAlerts
      ] = await Promise.all([
        fetchHeadcount(supabase, profile.org_id),
        fetchOnboardingStatus(supabase, profile.org_id),
        fetchComplianceDeadlines(supabase, profile.org_id),
        fetchActiveReviewCycles(supabase, profile.org_id),
        fetchExpiringDocuments(supabase, profile.org_id),
        fetchLeaveBalance(supabase, profile.org_id, profile.id),
        getOrgHealthAlerts(supabase, profile.org_id)
      ]);

      response.headcount = headcount;
      response.onboardingStatus = onboardingStatus;
      response.complianceDeadlines = complianceDeadlines;
      response.activeReviewCycles = activeReviewCycles;
      response.expiringDocuments = expiringDocuments;
      response.leaveBalance = leaveBalance;
      response.healthAlerts = healthAlerts;
      break;
    }

    case "finance_approver": {
      const [
        payroll,
        pendingExpenseApprovals,
        expensePipeline,
        financeOversight,
        leaveBalance
      ] = await Promise.all([
        fetchPayrollStatus(supabase, profile.org_id),
        fetchPendingExpenseApprovals(supabase, profile.org_id),
        fetchExpensePipeline(supabase, profile.org_id),
        fetchFinanceOversight(supabase, profile.org_id),
        fetchLeaveBalance(supabase, profile.org_id, profile.id)
      ]);

      response.payroll = payroll;
      response.pendingExpenseApprovals = pendingExpenseApprovals;
      response.expensePipeline = expensePipeline;
      response.financeOversight = financeOversight;
      response.leaveBalance = leaveBalance;
      break;
    }

    case "finance_admin": {
      const [
        payroll,
        pendingExpenseApprovals,
        expensePipeline,
        leaveBalance
      ] = await Promise.all([
        fetchPayrollStatus(supabase, profile.org_id),
        fetchPendingExpenseApprovals(supabase, profile.org_id),
        fetchExpensePipeline(supabase, profile.org_id),
        fetchLeaveBalance(supabase, profile.org_id, profile.id)
      ]);

      response.payroll = payroll;
      response.pendingExpenseApprovals = pendingExpenseApprovals;
      response.expensePipeline = expensePipeline;
      response.leaveBalance = leaveBalance;
      break;
    }

    case "super_admin": {
      const managerReports = await fetchManagerReports(
        supabase,
        profile.org_id,
        profile.id
      );

      const [
        headcount,
        headcountBreakdowns,
        pendingApprovals,
        pendingApprovalItems,
        payroll,
        expenseSpendSummary,
        complianceDeadlines,
        complianceHealth,
        recentAuditLog,
        expiringDocuments,
        leaveBalance,
        healthAlerts,
        financeOversight
      ] = await Promise.all([
        fetchHeadcount(supabase, profile.org_id),
        fetchHeadcountBreakdowns(supabase, profile.org_id),
        fetchPendingApprovals(supabase, profile.org_id, profile.id, managerReports),
        fetchPendingApprovalItems(supabase, profile.org_id, profile.id, managerReports),
        fetchPayrollStatus(supabase, profile.org_id),
        fetchExpenseSpendSummary(supabase, profile.org_id),
        fetchComplianceDeadlines(supabase, profile.org_id),
        fetchComplianceHealth(supabase, profile.org_id),
        fetchRecentAuditLog(supabase, profile.org_id),
        fetchExpiringDocuments(supabase, profile.org_id),
        fetchLeaveBalance(supabase, profile.org_id, profile.id),
        getOrgHealthAlerts(supabase, profile.org_id),
        fetchFinanceOversight(supabase, profile.org_id)
      ]);

      response.headcount = headcount;
      response.headcountByCountry = headcountBreakdowns.byCountry;
      response.headcountByDept = headcountBreakdowns.byDept;
      response.pendingApprovals = pendingApprovals;
      response.pendingApprovalItems = pendingApprovalItems;
      response.payroll = payroll;
      response.expenseSpendSummary = expenseSpendSummary;
      response.complianceDeadlines = complianceDeadlines;
      response.complianceHealth = complianceHealth;
      response.recentAuditLog = recentAuditLog;
      response.expiringDocuments = expiringDocuments;
      response.leaveBalance = leaveBalance;
      response.healthAlerts = healthAlerts;
      response.financeOversight = financeOversight;
      break;
    }
  }

  return applyWidgetVisibility(response, allowedWidgetKeys);
}
