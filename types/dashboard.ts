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

export type DashboardResponseData = {
  greeting: {
    firstName: string;
    roleBadge: string;
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
};

export type DashboardResponse = ApiResponse<DashboardResponseData>;
