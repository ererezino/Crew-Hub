import type { ApiResponse } from "./auth";

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

/* ── Home page types ── */

export type TeamMemberSpotlight = {
  id: string;
  fullName: string;
  title: string | null;
  department: string | null;
  avatarUrl: string | null;
  initials: string;
};

export type DashboardResponseData = {
  greeting: {
    firstName: string;
    fullName: string;
    roleBadge: string;
    timeOfDay: "morning" | "afternoon" | "evening";
  };
  heroMetrics: DashboardHeroMetric[];
  primaryChart: DashboardPrimaryChart;
  secondaryPanels: DashboardSecondaryPanel[];
  expenseWidget: {
    pendingCount: number;
    pendingAmount: number;
    managerPendingCount: number;
  };
  complianceWidget: {
    overdueCount: number;
    nextDeadline: {
      dueDate: string;
      requirement: string;
      countryCode: string;
    } | null;
  } | null;
  /* Home page data */
  teamSpotlight: TeamMemberSpotlight[];
  newHires: TeamMemberSpotlight[];
  totalTeamCount: number;
  companyDescription: string;
  isAdmin: boolean;
};

export type DashboardResponse = ApiResponse<DashboardResponseData>;
