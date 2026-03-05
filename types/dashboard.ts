import type { ApiResponse } from "./auth";
import type { DashboardPersona } from "../lib/dashboard-persona";
import type { HealthAlert } from "../lib/dashboard/health-alerts";

/* ── Shared sub-types (used by dashboard components) ── */

export type DashboardSparklinePoint = {
  month: string;
  value: number;
};

export type DashboardHeroMetric = {
  key: string;
  label: string;
  value: number;
  previousValue: number;
  format: "number" | "currency" | "percentage";
  currency?: string;
  sparkline: DashboardSparklinePoint[];
};

export type DashboardChartPoint = {
  label: string;
  value: number;
  secondaryValue?: number;
};

export type DashboardPrimaryChart = {
  title: string;
  type: "area" | "bar";
  dataKey: string;
  secondaryDataKey?: string;
  valueFormat?: "number" | "currency";
  currency?: string;
  data: DashboardChartPoint[];
};

export type DashboardBreakdownRow = {
  label: string;
  value: number;
  percentage: number;
};

export type DashboardSecondaryPanel = {
  title: string;
  type: "breakdown" | "list";
  rows: DashboardBreakdownRow[];
};

export type TeamMemberSpotlight = {
  id: string;
  fullName: string;
  title: string | null;
  department: string | null;
  avatarUrl: string | null;
  initials: string;
};

/* ── Persona-aware dashboard types ── */

export type DashboardGreeting = {
  firstName: string;
  fullName: string;
  roleBadge: string;
  timeOfDay: "morning" | "afternoon" | "evening";
};

export type DashboardAnnouncement = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  isPinned: boolean;
};

export type DashboardLeaveBalanceItem = {
  leaveType: string;
  available: number;
  allocated: number;
};

export type DashboardShiftItem = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
};

export type DashboardExpenseItem = {
  id: string;
  description: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
};

export type DashboardHolidayItem = {
  name: string;
  date: string;
  countryCode: string;
};

export type DashboardPendingApprovals = {
  leave: number;
  expenses: number;
  timesheets: number;
  total: number;
};

export type DashboardApprovalItem = {
  id: string;
  type: "leave" | "expense" | "signature";
  title: string;
  subtitle: string;
  detail: string;
  date: string;
};

export type DashboardTeamOnLeaveItem = {
  id: string;
  name: string;
  leaveType: string;
};

export type DashboardAuditLogEntry = {
  id: string;
  actorName: string;
  action: string;
  tableName: string;
  timestamp: string;
};

/**
 * Persona-aware dashboard response.
 *
 * Fields are populated based on the persona. Persona-specific fields
 * are null when not relevant to the current user's persona.
 */
export type DashboardResponseData = {
  persona: DashboardPersona;
  greeting: DashboardGreeting;

  /* ── Universal widgets (all roles) ── */
  announcements: DashboardAnnouncement[];
  teamOnLeaveToday: DashboardTeamOnLeaveItem[];
  upcomingHolidays: DashboardHolidayItem[];

  /* ── new_hire greeting card ── */
  org: { name: string; description: string } | null;
  managerInfo: {
    name: string;
    title: string | null;
    avatarUrl: string | null;
  } | null;
  onboardingProgress: {
    tasksTotal: number;
    tasksCompleted: number;
    instanceId: string;
  } | null;

  /* ── employee+ greeting card & widgets ── */
  leaveBalance: {
    byType: DashboardLeaveBalanceItem[];
    totalAvailable: number;
  } | null;
  hasTimePolicy: boolean;
  recentExpenses: DashboardExpenseItem[];
  upcomingShifts: DashboardShiftItem[];

  /* ── manager greeting card & decision cards ── */
  pendingApprovals: DashboardPendingApprovals | null;
  pendingApprovalItems: DashboardApprovalItem[] | null;

  /* ── hr_admin greeting card & widgets ── */
  headcount: { total: number; delta30d: number } | null;
  onboardingStatus: { active: number; overdue: number } | null;
  complianceDeadlines: {
    thisMonth: number;
    overdue: number;
    nextDeadline: { name: string; date: string } | null;
  } | null;
  activeReviewCycles: number | null;
  headcountTrend: DashboardChartPoint[] | null;
  expiringDocuments: {
    count: number;
    items: { id: string; title: string; expiryDate: string }[];
  } | null;

  /* ── finance_admin greeting card & widgets ── */
  payroll: {
    lastRunStatus: string | null;
    lastRunDate: string | null;
    nextPayDate: string | null;
  } | null;
  pendingExpenseApprovals: {
    financeStage: number;
    totalAmount: number;
  } | null;
  expensePipeline: {
    submitted: number;
    pendingManager: number;
    pendingFinance: number;
    reimbursed: number;
  } | null;

  /* ── super_admin specific ── */
  headcountByCountry: { countryCode: string; count: number }[] | null;
  headcountByDept: { department: string; count: number }[] | null;
  recentAuditLog: DashboardAuditLogEntry[] | null;
  complianceHealth: {
    completed: number;
    inProgress: number;
    overdue: number;
  } | null;

  /* ── admin health alerts (super_admin + hr_admin) ── */
  healthAlerts: HealthAlert[] | null;
};

export type DashboardResponse = ApiResponse<DashboardResponseData>;
