import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../lib/auth/session";
import {
  DASHBOARD_WIDGET_KEYS,
  defaultWidgetVisibilityForRoles,
  getDefaultVisibleRolesForWidget,
  isSuperAdmin,
  isWidgetVisibleForUser,
  sanitizeRoles
} from "../../../../lib/access-control";
import { normalizeUserRoles, type UserRole } from "../../../../lib/navigation";
import { hasRole } from "../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../types/auth";
import type {
  DashboardBreakdownRow,
  DashboardHeroMetric,
  DashboardPrimaryChart,
  DashboardResponseData,
  DashboardSecondaryPanel,
  DashboardSparklinePoint
} from "../../../../types/dashboard";

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

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function toStringValue(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  return fallback;
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

const widgetConfigRowSchema = z.object({
  widget_key: z.enum(DASHBOARD_WIDGET_KEYS),
  visible_to_roles: z.array(z.string())
});

function extractSparkline(
  trendArray: unknown[],
  monthKey: string,
  valueKey: string,
  limit = 6
): DashboardSparklinePoint[] {
  const rows = trendArray.slice(-limit).map((rowValue) => {
    const row = asRecord(rowValue);
    return {
      month: toStringValue(row[monthKey], "--"),
      value: toNumber(row[valueKey])
    };
  });

  return rows;
}

function buildHeroMetrics(
  roles: readonly UserRole[],
  people: Record<string, unknown>,
  timeOff: Record<string, unknown>,
  payroll: Record<string, unknown>,
  expenses: Record<string, unknown>,
  prevPeople: Record<string, unknown>,
  prevTimeOff: Record<string, unknown>,
  prevPayroll: Record<string, unknown>,
  prevExpenses: Record<string, unknown>
): DashboardHeroMetric[] {
  const pMetrics = asRecord(people.metrics);
  const tMetrics = asRecord(timeOff.metrics);
  const prMetrics = asRecord(payroll.metrics);
  const eMetrics = asRecord(expenses.metrics);

  const ppMetrics = asRecord(prevPeople.metrics);
  const ptMetrics = asRecord(prevTimeOff.metrics);
  const pprMetrics = asRecord(prevPayroll.metrics);
  const peMetrics = asRecord(prevExpenses.metrics);

  const peopleTrend = asArray(people.trend);
  const timeOffTrend = asArray(timeOff.trend);
  const payrollTrend = asArray(payroll.trend);
  const expensesTrend = asArray(expenses.trend);

  if (hasRole(roles, "SUPER_ADMIN") || hasRole(roles, "HR_ADMIN")) {
    return [
      {
        key: "headcount",
        label: "Active Headcount",
        value: Math.trunc(toNumber(pMetrics.activeHeadcount)),
        previousValue: Math.trunc(toNumber(ppMetrics.activeHeadcount)),
        format: "number",
        sparkline: extractSparkline(peopleTrend, "month", "headcount")
      },
      {
        key: "new-hires",
        label: "New Hires",
        value: Math.trunc(toNumber(pMetrics.newHires)),
        previousValue: Math.trunc(toNumber(ppMetrics.newHires)),
        format: "number",
        sparkline: extractSparkline(peopleTrend, "month", "hires")
      },
      {
        key: "time-off-utilization",
        label: "Time Off Utilization",
        value: toNumber(tMetrics.utilizationRate),
        previousValue: toNumber(ptMetrics.utilizationRate),
        format: "percentage",
        sparkline: extractSparkline(timeOffTrend, "month", "approvedDays")
      },
      {
        key: "currently-out",
        label: "Currently Out",
        value: Math.trunc(toNumber(tMetrics.currentlyOutCount)),
        previousValue: Math.trunc(toNumber(ptMetrics.currentlyOutCount)),
        format: "number",
        sparkline: extractSparkline(timeOffTrend, "month", "requestedDays")
      }
    ];
  }

  if (hasRole(roles, "FINANCE_ADMIN")) {
    return [
      {
        key: "payroll-net",
        label: "Total Payroll Net",
        value: Math.trunc(toNumber(prMetrics.totalNet)),
        previousValue: Math.trunc(toNumber(pprMetrics.totalNet)),
        format: "currency",
        currency: "USD",
        sparkline: extractSparkline(payrollTrend, "month", "totalNet")
      },
      {
        key: "pending-expenses",
        label: "Pending Expenses",
        value: Math.trunc(toNumber(eMetrics.pendingAmount)),
        previousValue: Math.trunc(toNumber(peMetrics.pendingAmount)),
        format: "currency",
        currency: "USD",
        sparkline: extractSparkline(expensesTrend, "month", "totalAmount")
      },
      {
        key: "expense-count",
        label: "Expense Count",
        value: Math.trunc(toNumber(eMetrics.expenseCount)),
        previousValue: Math.trunc(toNumber(peMetrics.expenseCount)),
        format: "number",
        sparkline: extractSparkline(expensesTrend, "month", "expenseCount")
      },
      {
        key: "payroll-runs",
        label: "Payroll Runs",
        value: Math.trunc(toNumber(prMetrics.runCount)),
        previousValue: Math.trunc(toNumber(pprMetrics.runCount)),
        format: "number",
        sparkline: extractSparkline(payrollTrend, "month", "totalGross")
      }
    ];
  }

  if (hasRole(roles, "MANAGER")) {
    return [
      {
        key: "headcount",
        label: "Headcount",
        value: Math.trunc(toNumber(pMetrics.activeHeadcount)),
        previousValue: Math.trunc(toNumber(ppMetrics.activeHeadcount)),
        format: "number",
        sparkline: extractSparkline(peopleTrend, "month", "headcount")
      },
      {
        key: "new-hires",
        label: "New Hires",
        value: Math.trunc(toNumber(pMetrics.newHires)),
        previousValue: Math.trunc(toNumber(ppMetrics.newHires)),
        format: "number",
        sparkline: extractSparkline(peopleTrend, "month", "hires")
      },
      {
        key: "currently-out",
        label: "Currently Out",
        value: Math.trunc(toNumber(tMetrics.currentlyOutCount)),
        previousValue: Math.trunc(toNumber(ptMetrics.currentlyOutCount)),
        format: "number",
        sparkline: extractSparkline(timeOffTrend, "month", "requestedDays")
      },
      {
        key: "pending-expenses",
        label: "Pending Expenses",
        value: Math.trunc(toNumber(eMetrics.pendingAmount)),
        previousValue: Math.trunc(toNumber(peMetrics.pendingAmount)),
        format: "currency",
        currency: "USD",
        sparkline: extractSparkline(expensesTrend, "month", "totalAmount")
      }
    ];
  }

  // Employee fallback
  return [
    {
      key: "headcount",
      label: "Company Headcount",
      value: Math.trunc(toNumber(pMetrics.activeHeadcount)),
      previousValue: Math.trunc(toNumber(ppMetrics.activeHeadcount)),
      format: "number",
      sparkline: extractSparkline(peopleTrend, "month", "headcount")
    },
    {
      key: "currently-out",
      label: "Currently Out",
      value: Math.trunc(toNumber(tMetrics.currentlyOutCount)),
      previousValue: Math.trunc(toNumber(ptMetrics.currentlyOutCount)),
      format: "number",
      sparkline: extractSparkline(timeOffTrend, "month", "requestedDays")
    },
    {
      key: "pending-expenses",
      label: "Pending Expenses",
      value: Math.trunc(toNumber(eMetrics.expenseCount)),
      previousValue: Math.trunc(toNumber(peMetrics.expenseCount)),
      format: "number",
      sparkline: extractSparkline(expensesTrend, "month", "expenseCount")
    },
    {
      key: "time-off-utilization",
      label: "PTO Utilization",
      value: toNumber(tMetrics.utilizationRate),
      previousValue: toNumber(ptMetrics.utilizationRate),
      format: "percentage",
      sparkline: extractSparkline(timeOffTrend, "month", "approvedDays")
    }
  ];
}

function buildPrimaryChart(
  roles: readonly UserRole[],
  people: Record<string, unknown>,
  payroll: Record<string, unknown>
): DashboardPrimaryChart {
  if (hasRole(roles, "FINANCE_ADMIN") && !hasRole(roles, "HR_ADMIN") && !hasRole(roles, "SUPER_ADMIN")) {
    const trend = asArray(payroll.trend).map((rowValue) => {
      const row = asRecord(rowValue);
      return {
        label: toStringValue(row.month, "--"),
        value: Math.trunc(toNumber(row.totalNet)),
        secondaryValue: Math.trunc(toNumber(row.totalGross))
      };
    });

    return {
      title: "Payroll Trend",
      type: "area",
      dataKey: "value",
      secondaryDataKey: "secondaryValue",
      valueFormat: "currency",
      currency: "USD",
      data: trend
    };
  }

  // Default: headcount trend
  const trend = asArray(people.trend).map((rowValue) => {
    const row = asRecord(rowValue);
    return {
      label: toStringValue(row.month, "--"),
      value: Math.trunc(toNumber(row.headcount)),
      secondaryValue: Math.trunc(toNumber(row.hires))
    };
  });

  return {
    title: "Headcount Trend",
    type: "area",
    dataKey: "value",
    secondaryDataKey: "secondaryValue",
    valueFormat: "number",
    data: trend
  };
}

function buildSecondaryPanels(
  people: Record<string, unknown>,
  expenses: Record<string, unknown>
): DashboardSecondaryPanel[] {
  const deptRows = asArray(people.byDepartment);
  const totalDeptCount = deptRows.reduce((sum: number, rowValue) => {
    return sum + Math.trunc(toNumber(asRecord(rowValue).count));
  }, 0);

  const departmentBreakdown: DashboardBreakdownRow[] = deptRows.slice(0, 6).map((rowValue) => {
    const row = asRecord(rowValue);
    const count = Math.trunc(toNumber(row.count));
    return {
      label: toStringValue(row.label, "Unknown"),
      value: count,
      percentage: totalDeptCount > 0 ? Math.round((count / totalDeptCount) * 100) : 0
    };
  });

  const catRows = asArray(expenses.byCategory);
  const totalExpAmount = catRows.reduce((sum: number, rowValue) => {
    return sum + Math.trunc(toNumber(asRecord(rowValue).totalAmount));
  }, 0);

  const expenseBreakdown: DashboardBreakdownRow[] = catRows.slice(0, 6).map((rowValue) => {
    const row = asRecord(rowValue);
    const amount = Math.trunc(toNumber(row.totalAmount));
    return {
      label: toStringValue(row.key, "Other"),
      value: amount,
      percentage: totalExpAmount > 0 ? Math.round((amount / totalExpAmount) * 100) : 0
    };
  });

  return [
    {
      title: "Headcount by Department",
      type: "breakdown",
      rows: departmentBreakdown
    },
    {
      title: "Expenses by Category",
      type: "breakdown",
      rows: expenseBreakdown
    }
  ];
}

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

    // Build date ranges
    const today = new Date();
    const endDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - 179); // 6 months for sparklines

    const prevEndDate = new Date(startDate);
    prevEndDate.setUTCDate(prevEndDate.getUTCDate() - 1);
    const prevStartDate = new Date(prevEndDate);
    prevStartDate.setUTCDate(prevStartDate.getUTCDate() - 29); // previous 30 days

    const supabase = createSupabaseServiceRoleClient();

    const currentPayload = {
      p_org_id: profile.org_id,
      p_start_date: toDateString(startDate),
      p_end_date: toDateString(endDate)
    };

    const prevPayload = {
      p_org_id: profile.org_id,
      p_start_date: toDateString(prevStartDate),
      p_end_date: toDateString(prevEndDate)
    };

    // Fetch current + previous period data in parallel
    const [
      peopleResult,
      timeOffResult,
      payrollResult,
      expensesResult,
      prevPeopleResult,
      prevTimeOffResult,
      prevPayrollResult,
      prevExpensesResult,
      expenseWidgetResult,
      complianceResult,
      widgetConfigResult
    ] = await Promise.all([
      supabase.rpc("analytics_people", currentPayload),
      supabase.rpc("analytics_time_off", currentPayload),
      supabase.rpc("analytics_payroll", currentPayload),
      supabase.rpc("analytics_expenses", currentPayload),
      supabase.rpc("analytics_people", prevPayload),
      supabase.rpc("analytics_time_off", prevPayload),
      supabase.rpc("analytics_payroll", prevPayload),
      supabase.rpc("analytics_expenses", prevPayload),
      // Employee expense widget
      supabase
        .from("expenses")
        .select("amount")
        .eq("org_id", profile.org_id)
        .eq("employee_id", profile.id)
        .eq("status", "pending")
        .is("deleted_at", null),
      // Compliance widget
      supabase
        .from("compliance_deadlines")
        .select("id")
        .eq("org_id", profile.org_id)
        .is("deleted_at", null)
        .neq("status", "completed")
        .lt("due_date", toDateString(endDate)),
      supabase
        .from("dashboard_widget_config")
        .select("widget_key, visible_to_roles")
        .eq("org_id", profile.org_id)
    ]);

    const rpcError =
      peopleResult.error ??
      timeOffResult.error ??
      payrollResult.error ??
      expensesResult.error ??
      prevPeopleResult.error ??
      prevTimeOffResult.error ??
      prevPayrollResult.error ??
      prevExpensesResult.error ??
      expenseWidgetResult.error ??
      complianceResult.error ??
      widgetConfigResult.error;

    if (rpcError) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "DASHBOARD_FETCH_FAILED", message: rpcError.message },
        meta: buildMeta()
      });
    }

    const people = asRecord(peopleResult.data);
    const timeOff = asRecord(timeOffResult.data);
    const payroll = asRecord(payrollResult.data);
    const expenses = asRecord(expensesResult.data);
    const prevPeople = asRecord(prevPeopleResult.data);
    const prevTimeOff = asRecord(prevTimeOffResult.data);
    const prevPayroll = asRecord(prevPayrollResult.data);
    const prevExpenses = asRecord(prevExpensesResult.data);

    // Expense widget
    const expenseRows = expenseWidgetResult.data ?? [];
    const employeePendingCount = expenseRows.length;
    const employeePendingAmount = expenseRows.reduce((sum: number, row) => {
      const amount = typeof row.amount === "number" ? row.amount : 0;
      return sum + Math.trunc(amount);
    }, 0);

    // Compliance widget
    const overdueCount = (complianceResult.data ?? []).length;
    const showCompliance =
      hasRole(roles, "HR_ADMIN") ||
      hasRole(roles, "FINANCE_ADMIN") ||
      hasRole(roles, "SUPER_ADMIN");

    const parsedWidgetRows = z.array(widgetConfigRowSchema).safeParse(widgetConfigResult.data ?? []);

    if (!parsedWidgetRows.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "DASHBOARD_WIDGET_CONFIG_PARSE_FAILED",
          message: "Dashboard widget configuration is not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    const visibleWidgetKeySet = (() => {
      if (isSuperAdmin(roles)) {
        return new Set(DASHBOARD_WIDGET_KEYS);
      }

      if (parsedWidgetRows.data.length === 0) {
        return new Set(defaultWidgetVisibilityForRoles(roles));
      }

      const rowByKey = new Map(
        parsedWidgetRows.data.map((row) => [row.widget_key, row] as const)
      );
      const visibleKeys = DASHBOARD_WIDGET_KEYS.filter((widgetKey) => {
        const row = rowByKey.get(widgetKey);
        const visibleToRoles = row
          ? sanitizeRoles(row.visible_to_roles)
          : getDefaultVisibleRolesForWidget(widgetKey);

        return isWidgetVisibleForUser({
          userRoles: roles,
          visibleToRoles
        });
      });

      return new Set(visibleKeys);
    })();

    const responseData: DashboardResponseData = {
      greeting: {
        firstName: getFirstName(profile.full_name),
        roleBadge: getRoleBadge(roles)
      },
      heroMetrics: visibleWidgetKeySet.has("hero_metrics")
        ? buildHeroMetrics(
            roles,
            people,
            timeOff,
            payroll,
            expenses,
            prevPeople,
            prevTimeOff,
            prevPayroll,
            prevExpenses
          )
        : [],
      primaryChart: visibleWidgetKeySet.has("primary_chart")
        ? buildPrimaryChart(roles, people, payroll)
        : {
            title: "",
            type: "area",
            dataKey: "value",
            data: []
          },
      secondaryPanels: visibleWidgetKeySet.has("secondary_panels")
        ? buildSecondaryPanels(people, expenses)
        : [],
      expenseWidget: visibleWidgetKeySet.has("expense_widget")
        ? {
            pendingCount: employeePendingCount,
            pendingAmount: employeePendingAmount,
            managerPendingCount: 0
          }
        : {
            pendingCount: 0,
            pendingAmount: 0,
            managerPendingCount: 0
          },
      complianceWidget: visibleWidgetKeySet.has("compliance_widget") && showCompliance
        ? { overdueCount, nextDeadline: null }
        : null
    };

    return jsonResponse<DashboardResponseData>(200, {
      data: responseData,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Unexpected dashboard error."
      },
      meta: buildMeta()
    });
  }
}
