import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { normalizeUserRoles, type UserRole } from "../../../../lib/navigation";
import { hasRole } from "../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../types/auth";
import type {
  AnalyticsCsvSection,
  AnalyticsExpensesSection,
  AnalyticsFilterOptions,
  AnalyticsPeopleSection,
  AnalyticsPipelineSection,
  AnalyticsPayrollSection,
  AnalyticsResponseData,
  AnalyticsTimeOffSection
} from "../../../../types/analytics";

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
const querySchema = z.object({
  startDate: z.string().regex(isoDateRegex).optional(),
  endDate: z.string().regex(isoDateRegex).optional(),
  country: z.string().min(2).max(2).optional(),
  department: z.string().min(1).max(200).optional(),
  format: z.enum(["json", "csv"]).optional(),
  section: z.enum(["people", "time_off", "payroll", "expenses", "pipeline"]).optional()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function canViewAnalytics(userRoles: readonly UserRole[]): boolean {
  return (
    hasRole(userRoles, "HR_ADMIN") ||
    hasRole(userRoles, "FINANCE_ADMIN") ||
    hasRole(userRoles, "SUPER_ADMIN")
  );
}

function toDateString(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultDateRange(): { startDate: string; endDate: string } {
  const today = new Date();
  const endDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - 89);

  return {
    startDate: toDateString(startDate),
    endDate: toDateString(endDate)
  };
}

function parseDateFromIso(value: string): Date | null {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value;
}

function toStringValue(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  return fallback;
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

/* ── Normalizers (from RPC data) ── */

function normalizePeople(value: unknown): Omit<AnalyticsPeopleSection, "statusDistribution"> & { statusDistribution: never[] } {
  const source = asRecord(value);
  const metrics = asRecord(source.metrics);

  return {
    metrics: {
      activeHeadcount: Math.trunc(toNumber(metrics.activeHeadcount)),
      newHires: Math.trunc(toNumber(metrics.newHires)),
      departures: 0,
      avgTenureMonths: 0,
      newHiresThisMonth: 0,
      activeDepartments: Math.trunc(toNumber(metrics.activeDepartments)),
      activeCountries: Math.trunc(toNumber(metrics.activeCountries))
    },
    byDepartment: asArray(source.byDepartment).map((rowValue) => {
      const row = asRecord(rowValue);

      return {
        key: toStringValue(row.key, "unknown"),
        label: toStringValue(row.label, "Unknown"),
        count: Math.trunc(toNumber(row.count))
      };
    }),
    byCountry: asArray(source.byCountry).map((rowValue) => {
      const row = asRecord(rowValue);

      return {
        key: toStringValue(row.key, "--"),
        count: Math.trunc(toNumber(row.count))
      };
    }),
    employmentType: asArray(source.employmentType).map((rowValue) => {
      const row = asRecord(rowValue);

      return {
        key: toStringValue(row.key, "unknown"),
        count: Math.trunc(toNumber(row.count))
      };
    }),
    statusDistribution: [] as never[],
    trend: asArray(source.trend).map((rowValue) => {
      const row = asRecord(rowValue);

      return {
        month: toStringValue(row.month, "--"),
        headcount: Math.trunc(toNumber(row.headcount)),
        hires: Math.trunc(toNumber(row.hires))
      };
    })
  };
}

function normalizeTimeOff(value: unknown): Omit<AnalyticsTimeOffSection, "byDepartment" | "topUsers"> & { byDepartment: never[]; topUsers: never[] } {
  const source = asRecord(value);
  const metrics = asRecord(source.metrics);

  return {
    metrics: {
      totalDaysTaken: 0,
      mostCommonType: null,
      avgLeaveBalance: 0,
      requestedDays: toNumber(metrics.requestedDays),
      approvedDays: toNumber(metrics.approvedDays),
      pendingRequests: Math.trunc(toNumber(metrics.pendingRequests)),
      currentlyOutCount: Math.trunc(toNumber(metrics.currentlyOutCount)),
      utilizationRate: toNumber(metrics.utilizationRate)
    },
    byType: asArray(source.byType).map((rowValue) => {
      const row = asRecord(rowValue);

      return {
        key: toStringValue(row.key, "other"),
        totalDays: toNumber(row.totalDays),
        requestCount: Math.trunc(toNumber(row.requestCount))
      };
    }),
    trend: asArray(source.trend).map((rowValue) => {
      const row = asRecord(rowValue);

      return {
        month: toStringValue(row.month, "--"),
        requestedDays: toNumber(row.requestedDays),
        approvedDays: toNumber(row.approvedDays)
      };
    }),
    byDepartment: [] as never[],
    topUsers: [] as never[],
    currentlyOut: asArray(source.currentlyOut).map((rowValue) => {
      const row = asRecord(rowValue);

      return {
        employeeId: toStringValue(row.employeeId, ""),
        fullName: toStringValue(row.fullName, "Unknown user"),
        department: toStringValue(row.department, "No department"),
        countryCode: toStringValue(row.countryCode, "--"),
        leaveType: toStringValue(row.leaveType, "other"),
        totalDays: toNumber(row.totalDays),
        endDate: toStringValue(row.endDate, "")
      };
    })
  };
}

function normalizePayroll(value: unknown): Omit<AnalyticsPayrollSection, "compensationBands"> & { compensationBands: { belowMidpoint: number; atMidpoint: number; aboveMidpoint: number } } {
  const source = asRecord(value);
  const metrics = asRecord(source.metrics);

  return {
    metrics: {
      lastRunGross: 0,
      lastRunNet: 0,
      avgGrossSalary: 0,
      totalAllowances: 0,
      totalGross: Math.trunc(toNumber(metrics.totalGross)),
      totalNet: Math.trunc(toNumber(metrics.totalNet)),
      totalDeductions: Math.trunc(toNumber(metrics.totalDeductions)),
      runCount: Math.trunc(toNumber(metrics.runCount)),
      avgNetPerEmployee: Math.trunc(toNumber(metrics.avgNetPerEmployee))
    },
    trend: asArray(source.trend).map((rowValue) => {
      const row = asRecord(rowValue);

      return {
        month: toStringValue(row.month, "--"),
        totalNet: Math.trunc(toNumber(row.totalNet)),
        totalGross: Math.trunc(toNumber(row.totalGross))
      };
    }),
    byDepartment: asArray(source.byDepartment).map((rowValue) => {
      const row = asRecord(rowValue);

      return {
        key: toStringValue(row.key, "unknown"),
        label: toStringValue(row.label, "Unknown"),
        totalNet: Math.trunc(toNumber(row.totalNet)),
        employeeCount: Math.trunc(toNumber(row.employeeCount)),
        avgNet: Math.trunc(toNumber(row.avgNet))
      };
    }),
    byCountry: asArray(source.byCountry).map((rowValue) => {
      const row = asRecord(rowValue);

      return {
        key: toStringValue(row.key, "--"),
        totalNet: Math.trunc(toNumber(row.totalNet)),
        employeeCount: Math.trunc(toNumber(row.employeeCount)),
        avgNet: Math.trunc(toNumber(row.avgNet))
      };
    }),
    compensationBands: { belowMidpoint: 0, atMidpoint: 0, aboveMidpoint: 0 }
  };
}

function normalizeExpenses(value: unknown): AnalyticsExpensesSection {
  const source = asRecord(value);
  const metrics = asRecord(source.metrics);

  return {
    metrics: {
      totalAmount: Math.trunc(toNumber(metrics.totalAmount)),
      reimbursedAmount: 0,
      pendingAmount: Math.trunc(toNumber(metrics.pendingAmount)),
      avgProcessingDays: 0,
      approvedAmount: Math.trunc(toNumber(metrics.approvedAmount)),
      expenseCount: Math.trunc(toNumber(metrics.expenseCount))
    },
    byCategory: asArray(source.byCategory).map((rowValue) => {
      const row = asRecord(rowValue);

      return {
        key: toStringValue(row.key, "other"),
        totalAmount: Math.trunc(toNumber(row.totalAmount)),
        expenseCount: Math.trunc(toNumber(row.expenseCount))
      };
    }),
    trend: asArray(source.trend).map((rowValue) => {
      const row = asRecord(rowValue);

      return {
        month: toStringValue(row.month, "--"),
        totalAmount: Math.trunc(toNumber(row.totalAmount)),
        expenseCount: Math.trunc(toNumber(row.expenseCount))
      };
    }),
    topSpenders: asArray(source.topSpenders).map((rowValue) => {
      const row = asRecord(rowValue);

      return {
        employeeId: toStringValue(row.employeeId, ""),
        fullName: toStringValue(row.fullName, "Unknown user"),
        department: toStringValue(row.department, "No department"),
        countryCode: toStringValue(row.countryCode, "--"),
        totalAmount: Math.trunc(toNumber(row.totalAmount)),
        expenseCount: Math.trunc(toNumber(row.expenseCount))
      };
    })
  };
}

/* ── CSV export ── */

function csvEscape(value: string | number): string {
  const rawValue = String(value);

  if (/[",\n]/.test(rawValue)) {
    return `"${rawValue.replace(/"/g, "\"\"")}"`;
  }

  return rawValue;
}

function toCsvContent(header: string[], rows: Array<Array<string | number>>): string {
  const csvHeader = header.map((cell) => csvEscape(cell)).join(",");
  const csvRows = rows.map((row) => row.map((cell) => csvEscape(cell)).join(","));
  return [csvHeader, ...csvRows].join("\n");
}

function peopleCsvRows(data: AnalyticsResponseData): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [];

  for (const row of data.people.byDepartment) {
    rows.push(["by_department", row.key, row.label, row.count, "", ""]);
  }

  for (const row of data.people.byCountry) {
    rows.push(["by_country", row.key, row.key, row.count, "", ""]);
  }

  for (const row of data.people.employmentType) {
    rows.push(["employment_type", row.key, row.key, row.count, "", ""]);
  }

  for (const row of data.people.trend) {
    rows.push(["trend", row.month, row.month, row.headcount, row.hires, ""]);
  }

  return rows;
}

function timeOffCsvRows(data: AnalyticsResponseData): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [];

  for (const row of data.timeOff.byType) {
    rows.push(["by_type", row.key, row.key, row.totalDays, row.requestCount, ""]);
  }

  for (const row of data.timeOff.trend) {
    rows.push(["trend", row.month, row.month, row.requestedDays, row.approvedDays, ""]);
  }

  for (const row of data.timeOff.topUsers) {
    rows.push(["top_users", row.employeeId, row.fullName, row.totalDays, row.mainType, row.department ?? "--"]);
  }

  for (const row of data.timeOff.currentlyOut) {
    rows.push(["currently_out", row.employeeId, row.fullName, row.totalDays, row.leaveType, row.endDate]);
  }

  return rows;
}

function payrollCsvRows(data: AnalyticsResponseData): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [];

  for (const row of data.payroll.byDepartment) {
    rows.push(["by_department", row.key, row.label, row.totalNet, row.employeeCount, row.avgNet]);
  }

  for (const row of data.payroll.byCountry) {
    rows.push(["by_country", row.key, row.key, row.totalNet, row.employeeCount, row.avgNet]);
  }

  for (const row of data.payroll.trend) {
    rows.push(["trend", row.month, row.month, row.totalNet, row.totalGross, ""]);
  }

  return rows;
}

function expensesCsvRows(data: AnalyticsResponseData): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [];

  for (const row of data.expenses.byCategory) {
    rows.push(["by_category", row.key, row.key, row.totalAmount, row.expenseCount, ""]);
  }

  for (const row of data.expenses.trend) {
    rows.push(["trend", row.month, row.month, row.totalAmount, row.expenseCount, ""]);
  }

  for (const row of data.expenses.topSpenders) {
    rows.push(["top_spenders", row.employeeId, row.fullName, row.totalAmount, row.expenseCount, row.countryCode ?? "--"]);
  }

  return rows;
}

function pipelineCsvRows(data: AnalyticsResponseData): Array<Array<string | number>> {
  const p = data.pipeline;
  return [
    ["onboarding", "active", "", p.onboarding.active, "", ""],
    ["onboarding", "overdue", "", p.onboarding.overdue, "", ""],
    ["review_cycles", "active", "", p.reviewCycles.active, p.reviewCycles.completionPct, ""],
    ["learning", "active_courses", "", p.learning.activeCourses, p.learning.completionPct, ""],
    ["compliance", "on_time_pct", "", p.complianceHealth.completedOnTimePct, "", ""]
  ];
}

function csvForSection(section: AnalyticsCsvSection, data: AnalyticsResponseData): string {
  const header = ["dataset", "key", "label", "value_1", "value_2", "value_3"];

  if (section === "people") {
    return toCsvContent(header, peopleCsvRows(data));
  }

  if (section === "time_off") {
    return toCsvContent(header, timeOffCsvRows(data));
  }

  if (section === "payroll") {
    return toCsvContent(header, payrollCsvRows(data));
  }

  if (section === "pipeline") {
    return toCsvContent(header, pipelineCsvRows(data));
  }

  return toCsvContent(header, expensesCsvRows(data));
}

/* ── Enhanced direct queries ── */

type EnhancedQueryCtx = {
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>;
  orgId: string;
  startDate: string;
  endDate: string;
  countryFilter?: string;
  departmentFilter?: string;
};

async function queryDeparturesAndTenure(ctx: EnhancedQueryCtx) {
  const { supabase, orgId, startDate, endDate } = ctx;

  // Departures: profiles with deleted_at in range
  let departuresQuery = supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .gte("deleted_at", `${startDate}T00:00:00.000Z`)
    .lte("deleted_at", `${endDate}T23:59:59.999Z`);

  if (ctx.countryFilter) {
    departuresQuery = departuresQuery.eq("country_code", ctx.countryFilter);
  }
  if (ctx.departmentFilter) {
    departuresQuery = departuresQuery.eq("department", ctx.departmentFilter);
  }

  const departuresResult = await departuresQuery;

  // Tenure: active profiles with start_date
  let tenureQuery = supabase
    .from("profiles")
    .select("start_date")
    .eq("org_id", orgId)
    .eq("status", "active")
    .is("deleted_at", null)
    .not("start_date", "is", null);

  if (ctx.countryFilter) {
    tenureQuery = tenureQuery.eq("country_code", ctx.countryFilter);
  }
  if (ctx.departmentFilter) {
    tenureQuery = tenureQuery.eq("department", ctx.departmentFilter);
  }

  const tenureResult = await tenureQuery;

  const departures = departuresResult.count ?? 0;
  let avgTenureMonths = 0;

  if (tenureResult.data && tenureResult.data.length > 0) {
    const now = new Date();
    let totalMonths = 0;

    for (const row of tenureResult.data) {
      const startDateValue = row.start_date as string | null;
      if (startDateValue) {
        const start = new Date(startDateValue);
        const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
        totalMonths += Math.max(0, months);
      }
    }

    avgTenureMonths = Math.round(totalMonths / tenureResult.data.length);
  }

  // New hires delta this month
  const now = new Date();
  const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const lastOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;

  let deltaQuery = supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .gte("start_date", firstOfMonth)
    .lte("start_date", lastOfMonth);

  if (ctx.countryFilter) {
    deltaQuery = deltaQuery.eq("country_code", ctx.countryFilter);
  }
  if (ctx.departmentFilter) {
    deltaQuery = deltaQuery.eq("department", ctx.departmentFilter);
  }

  const deltaResult = await deltaQuery;

  // Status distribution
  let statusQuery = supabase
    .from("profiles")
    .select("status")
    .eq("org_id", orgId)
    .is("deleted_at", null);

  if (ctx.countryFilter) {
    statusQuery = statusQuery.eq("country_code", ctx.countryFilter);
  }
  if (ctx.departmentFilter) {
    statusQuery = statusQuery.eq("department", ctx.departmentFilter);
  }

  const statusResult = await statusQuery;

  const statusCounts: Record<string, number> = {};
  if (statusResult.data) {
    for (const row of statusResult.data) {
      const status = (row.status as string) ?? "unknown";
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    }
  }

  const statusDistribution = Object.entries(statusCounts).map(([key, count]) => ({ key, count }));

  return {
    departures,
    avgTenureMonths,
    newHiresThisMonth: deltaResult.count ?? 0,
    statusDistribution
  };
}

async function queryLeaveEnhanced(ctx: EnhancedQueryCtx) {
  const { supabase, orgId, startDate, endDate } = ctx;

  // Top 5 employees by leave days — join with profiles
  const { data: topUsersRaw } = await supabase
    .from("leave_requests")
    .select("employee_id, leave_type, start_date, end_date, profiles!inner(full_name, department, country_code)")
    .eq("org_id", orgId)
    .eq("status", "approved")
    .gte("start_date", startDate)
    .lte("start_date", endDate);

  // Aggregate by employee
  const employeeMap: Record<string, {
    fullName: string;
    department: string | null;
    totalDays: number;
    typeCounts: Record<string, number>;
  }> = {};

  if (topUsersRaw) {
    for (const row of topUsersRaw) {
      const empId = row.employee_id as string;
      const profileData = row.profiles as unknown as { full_name: string; department: string | null; country_code: string | null } | null;

      if (ctx.countryFilter && profileData?.country_code !== ctx.countryFilter) continue;
      if (ctx.departmentFilter && profileData?.department !== ctx.departmentFilter) continue;

      const sDate = new Date(row.start_date as string);
      const eDate = new Date(row.end_date as string);
      const days = Math.max(1, Math.ceil((eDate.getTime() - sDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
      const leaveType = (row.leave_type as string) ?? "other";

      if (!employeeMap[empId]) {
        employeeMap[empId] = {
          fullName: profileData?.full_name ?? "Unknown",
          department: profileData?.department ?? null,
          totalDays: 0,
          typeCounts: {}
        };
      }

      employeeMap[empId].totalDays += days;
      employeeMap[empId].typeCounts[leaveType] = (employeeMap[empId].typeCounts[leaveType] ?? 0) + days;
    }
  }

  const topUsers = Object.entries(employeeMap)
    .map(([employeeId, data]) => {
      const mainType = Object.entries(data.typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "other";
      return {
        employeeId,
        fullName: data.fullName,
        department: data.department,
        totalDays: data.totalDays,
        mainType
      };
    })
    .sort((a, b) => b.totalDays - a.totalDays)
    .slice(0, 5);

  // Total days taken and most common type
  const totalDaysTaken = Object.values(employeeMap).reduce((sum, emp) => sum + emp.totalDays, 0);
  const allTypeCounts: Record<string, number> = {};
  for (const emp of Object.values(employeeMap)) {
    for (const [type, count] of Object.entries(emp.typeCounts)) {
      allTypeCounts[type] = (allTypeCounts[type] ?? 0) + count;
    }
  }
  const mostCommonType = Object.entries(allTypeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Average leave balance (annual_leave only)
  const { data: balancesRaw } = await supabase
    .from("leave_balances")
    .select("total_days, used_days, profiles!inner(country_code, department)")
    .eq("org_id", orgId)
    .eq("leave_type", "annual_leave");

  let avgLeaveBalance = 0;
  if (balancesRaw && balancesRaw.length > 0) {
    let filteredBalances = balancesRaw;
    if (ctx.countryFilter || ctx.departmentFilter) {
      filteredBalances = balancesRaw.filter((row) => {
        const profile = row.profiles as unknown as { country_code: string | null; department: string | null } | null;
        if (ctx.countryFilter && profile?.country_code !== ctx.countryFilter) return false;
        if (ctx.departmentFilter && profile?.department !== ctx.departmentFilter) return false;
        return true;
      });
    }

    if (filteredBalances.length > 0) {
      const totalRemaining = filteredBalances.reduce((sum, row) => {
        const total = toNumber(row.total_days);
        const used = toNumber(row.used_days);
        return sum + Math.max(0, total - used);
      }, 0);
      avgLeaveBalance = Math.round((totalRemaining / filteredBalances.length) * 10) / 10;
    }
  }

  // Leave utilization by department
  const deptMap: Record<string, { totalAllocated: number; totalUsed: number }> = {};
  if (balancesRaw) {
    for (const row of balancesRaw) {
      const profile = row.profiles as unknown as { country_code: string | null; department: string | null } | null;
      if (ctx.countryFilter && profile?.country_code !== ctx.countryFilter) continue;
      const dept = profile?.department ?? "Unassigned";
      if (ctx.departmentFilter && dept !== ctx.departmentFilter) continue;

      if (!deptMap[dept]) {
        deptMap[dept] = { totalAllocated: 0, totalUsed: 0 };
      }
      deptMap[dept].totalAllocated += toNumber(row.total_days);
      deptMap[dept].totalUsed += toNumber(row.used_days);
    }
  }

  const byDepartment = Object.entries(deptMap)
    .map(([department, data]) => ({
      department,
      totalAllocated: data.totalAllocated,
      totalUsed: data.totalUsed,
      utilizationPct: data.totalAllocated > 0
        ? Math.round((data.totalUsed / data.totalAllocated) * 100)
        : 0
    }))
    .sort((a, b) => b.utilizationPct - a.utilizationPct);

  return { topUsers, totalDaysTaken, mostCommonType, avgLeaveBalance, byDepartment };
}

async function queryPayrollEnhanced(ctx: EnhancedQueryCtx) {
  const { supabase, orgId } = ctx;

  // Last completed payroll run
  const { data: lastRun } = await supabase
    .from("payroll_runs")
    .select("total_gross, total_net")
    .eq("org_id", orgId)
    .eq("status", "completed")
    .order("pay_period_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastRunGross = lastRun ? Math.trunc(toNumber(lastRun.total_gross)) : 0;
  const lastRunNet = lastRun ? Math.trunc(toNumber(lastRun.total_net)) : 0;

  // Average gross salary from compensation_records
  const { data: compRecords } = await supabase
    .from("compensation_records")
    .select("base_salary_amount, profiles!inner(country_code, department)")
    .eq("org_id", orgId)
    .is("deleted_at", null);

  let avgGrossSalary = 0;
  if (compRecords && compRecords.length > 0) {
    let filtered = compRecords;
    if (ctx.countryFilter || ctx.departmentFilter) {
      filtered = compRecords.filter((row) => {
        const profile = row.profiles as unknown as { country_code: string | null; department: string | null } | null;
        if (ctx.countryFilter && profile?.country_code !== ctx.countryFilter) return false;
        if (ctx.departmentFilter && profile?.department !== ctx.departmentFilter) return false;
        return true;
      });
    }

    if (filtered.length > 0) {
      const totalSalary = filtered.reduce((sum, row) => sum + toNumber(row.base_salary_amount), 0);
      avgGrossSalary = Math.trunc(totalSalary / filtered.length);
    }
  }

  // Total allowances per month (latest month)
  const { data: allowancesData } = await supabase
    .from("allowances")
    .select("amount")
    .eq("org_id", orgId)
    .is("deleted_at", null);

  const totalAllowances = allowancesData
    ? allowancesData.reduce((sum, row) => sum + Math.trunc(toNumber(row.amount)), 0)
    : 0;

  // Compensation band distribution
  const { data: bandAssignments } = await supabase
    .from("compensation_band_assignments")
    .select("band_id, compensation_bands!inner(mid_salary_amount), profiles!inner(country_code, department), compensation_records!inner(base_salary_amount)")
    .eq("org_id", orgId)
    .is("effective_to", null);

  let belowMidpoint = 0;
  let atMidpoint = 0;
  let aboveMidpoint = 0;

  if (bandAssignments) {
    for (const row of bandAssignments) {
      const profile = row.profiles as unknown as { country_code: string | null; department: string | null } | null;
      if (ctx.countryFilter && profile?.country_code !== ctx.countryFilter) continue;
      if (ctx.departmentFilter && profile?.department !== ctx.departmentFilter) continue;

      const band = row.compensation_bands as unknown as { mid_salary_amount: number } | null;
      const comp = row.compensation_records as unknown as { base_salary_amount: number } | null;

      if (band && comp) {
        const midSalary = toNumber(band.mid_salary_amount);
        const baseSalary = toNumber(comp.base_salary_amount);
        const tolerance = midSalary * 0.05;

        if (baseSalary < midSalary - tolerance) {
          belowMidpoint++;
        } else if (baseSalary > midSalary + tolerance) {
          aboveMidpoint++;
        } else {
          atMidpoint++;
        }
      }
    }
  }

  return {
    lastRunGross,
    lastRunNet,
    avgGrossSalary,
    totalAllowances,
    compensationBands: { belowMidpoint, atMidpoint, aboveMidpoint }
  };
}

async function queryExpensesEnhanced(ctx: EnhancedQueryCtx) {
  const { supabase, orgId, startDate, endDate } = ctx;

  // Reimbursed amount
  let reimbursedQuery = supabase
    .from("expenses")
    .select("amount")
    .eq("org_id", orgId)
    .eq("status", "reimbursed")
    .gte("expense_date", startDate)
    .lte("expense_date", endDate);

  if (ctx.countryFilter) {
    reimbursedQuery = reimbursedQuery.eq("country_code", ctx.countryFilter);
  }

  const { data: reimbursedData } = await reimbursedQuery;
  const reimbursedAmount = reimbursedData
    ? reimbursedData.reduce((sum, row) => sum + Math.trunc(toNumber(row.amount)), 0)
    : 0;

  // Average processing time (submitted → reimbursed, in days)
  const { data: processingData } = await supabase
    .from("expenses")
    .select("created_at, reimbursed_at")
    .eq("org_id", orgId)
    .eq("status", "reimbursed")
    .not("reimbursed_at", "is", null)
    .gte("expense_date", startDate)
    .lte("expense_date", endDate);

  let avgProcessingDays = 0;
  if (processingData && processingData.length > 0) {
    let totalDays = 0;
    for (const row of processingData) {
      const submitted = new Date(row.created_at as string);
      const reimbursed = new Date(row.reimbursed_at as string);
      const days = (reimbursed.getTime() - submitted.getTime()) / (1000 * 60 * 60 * 24);
      totalDays += Math.max(0, days);
    }
    avgProcessingDays = Math.round((totalDays / processingData.length) * 10) / 10;
  }

  return { reimbursedAmount, avgProcessingDays };
}

async function queryPipeline(ctx: EnhancedQueryCtx): Promise<AnalyticsPipelineSection> {
  const { supabase, orgId } = ctx;

  // Onboarding instances
  const { count: activeOnboarding } = await supabase
    .from("onboarding_instances")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "active");

  // Overdue onboarding tasks
  const todayStr = toDateString(new Date());
  const { count: overdueOnboarding } = await supabase
    .from("onboarding_tasks")
    .select("id, onboarding_instances!inner(org_id, status)", { count: "exact", head: true })
    .eq("onboarding_instances.org_id", orgId)
    .eq("onboarding_instances.status", "active")
    .in("status", ["pending", "in_progress"])
    .lt("due_date", todayStr);

  // Review cycles
  const { data: activeCycles } = await supabase
    .from("review_cycles")
    .select("id")
    .eq("org_id", orgId)
    .in("status", ["active", "in_review"]);

  const activeCycleCount = activeCycles?.length ?? 0;
  let reviewCompletionPct = 0;

  if (activeCycles && activeCycles.length > 0) {
    const cycleIds = activeCycles.map((c) => c.id as string);
    const { count: totalAssignments } = await supabase
      .from("review_assignments")
      .select("id", { count: "exact", head: true })
      .in("cycle_id", cycleIds);

    const { count: completedAssignments } = await supabase
      .from("review_assignments")
      .select("id", { count: "exact", head: true })
      .in("cycle_id", cycleIds)
      .eq("status", "completed");

    if (totalAssignments && totalAssignments > 0) {
      reviewCompletionPct = Math.round(((completedAssignments ?? 0) / totalAssignments) * 100);
    }
  }

  // Learning courses
  const { count: activeCourses } = await supabase
    .from("courses")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("is_published", true);

  const { count: totalLearningAssignments } = await supabase
    .from("course_assignments")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);

  const { count: completedLearning } = await supabase
    .from("course_assignments")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "completed");

  const learningCompletionPct = (totalLearningAssignments ?? 0) > 0
    ? Math.round(((completedLearning ?? 0) / (totalLearningAssignments ?? 1)) * 100)
    : 0;

  // Compliance health: % of this month's deadlines completed on time
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;

  const { count: thisMonthDeadlines } = await supabase
    .from("compliance_deadlines")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .gte("due_date", monthStart)
    .lte("due_date", monthEnd);

  const { count: completedDeadlines } = await supabase
    .from("compliance_deadlines")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .gte("due_date", monthStart)
    .lte("due_date", monthEnd)
    .eq("status", "completed");

  const completedOnTimePct = (thisMonthDeadlines ?? 0) > 0
    ? Math.round(((completedDeadlines ?? 0) / (thisMonthDeadlines ?? 1)) * 100)
    : 100;

  return {
    onboarding: { active: activeOnboarding ?? 0, overdue: overdueOnboarding ?? 0 },
    reviewCycles: { active: activeCycleCount, completionPct: reviewCompletionPct },
    learning: { activeCourses: activeCourses ?? 0, completionPct: learningCompletionPct },
    complianceHealth: { completedOnTimePct }
  };
}

async function queryFilterOptions(ctx: EnhancedQueryCtx): Promise<AnalyticsFilterOptions> {
  const { supabase, orgId } = ctx;

  const { data: profiles } = await supabase
    .from("profiles")
    .select("country_code, department")
    .eq("org_id", orgId)
    .is("deleted_at", null);

  const countries = new Set<string>();
  const departments = new Set<string>();

  if (profiles) {
    for (const row of profiles) {
      const cc = row.country_code as string | null;
      const dept = row.department as string | null;
      if (cc && cc.length === 2) countries.add(cc);
      if (dept && dept.trim().length > 0) departments.add(dept.trim());
    }
  }

  return {
    countries: [...countries].sort(),
    departments: [...departments].sort()
  };
}

/* ── Main handler ── */

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view analytics."
      },
      meta: buildMeta()
    });
  }

  const normalizedRoles = normalizeUserRoles(session.profile.roles);

  if (!canViewAnalytics(normalizedRoles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin, Finance Admin, and Super Admin can access analytics."
      },
      meta: buildMeta()
    });
  }

  const requestUrl = new URL(request.url);
  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(requestUrl.searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid analytics query."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;
  const defaultRange = defaultDateRange();
  const startDate = query.startDate ?? defaultRange.startDate;
  const endDate = query.endDate ?? defaultRange.endDate;

  const parsedStart = parseDateFromIso(startDate);
  const parsedEnd = parseDateFromIso(endDate);

  if (!parsedStart || !parsedEnd || parsedStart > parsedEnd) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "startDate must be before or equal to endDate."
      },
      meta: buildMeta()
    });
  }

  if (query.format === "csv" && !query.section) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "section is required when format=csv."
      },
      meta: buildMeta()
    });
  }

  const supabase = createSupabaseServiceRoleClient();
  const orgId = session.profile.org_id;
  const rpcPayload = {
    p_org_id: orgId,
    p_start_date: startDate,
    p_end_date: endDate
  };

  const ctx: EnhancedQueryCtx = {
    supabase,
    orgId,
    startDate,
    endDate,
    countryFilter: query.country,
    departmentFilter: query.department
  };

  // Run all queries in parallel
  const [
    peopleResult,
    timeOffResult,
    payrollResult,
    expensesResult,
    enhancedPeople,
    enhancedLeave,
    enhancedPayroll,
    enhancedExpenses,
    pipeline,
    filterOptions
  ] = await Promise.all([
    supabase.rpc("analytics_people", rpcPayload),
    supabase.rpc("analytics_time_off", rpcPayload),
    supabase.rpc("analytics_payroll", rpcPayload),
    supabase.rpc("analytics_expenses", rpcPayload),
    queryDeparturesAndTenure(ctx),
    queryLeaveEnhanced(ctx),
    queryPayrollEnhanced(ctx),
    queryExpensesEnhanced(ctx),
    queryPipeline(ctx),
    queryFilterOptions(ctx)
  ]);

  const rpcError =
    peopleResult.error ??
    timeOffResult.error ??
    payrollResult.error ??
    expensesResult.error;

  if (rpcError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ANALYTICS_FETCH_FAILED",
        message: rpcError.message
      },
      meta: buildMeta()
    });
  }

  // Build people section
  const people: AnalyticsPeopleSection = {
    ...normalizePeople(peopleResult.data),
    metrics: {
      ...normalizePeople(peopleResult.data).metrics,
      departures: enhancedPeople.departures,
      avgTenureMonths: enhancedPeople.avgTenureMonths,
      newHiresThisMonth: enhancedPeople.newHiresThisMonth
    },
    statusDistribution: enhancedPeople.statusDistribution
  };

  // Apply country/department filters to breakdown arrays
  if (query.country) {
    people.byCountry = people.byCountry.filter((row) => row.key === query.country);
    people.metrics.activeHeadcount = people.byCountry.reduce((sum, row) => sum + row.count, 0);
  }

  if (query.department) {
    people.byDepartment = people.byDepartment.filter(
      (row) => row.key === query.department || row.label === query.department
    );
  }

  // Build time off section
  const timeOff: AnalyticsTimeOffSection = {
    ...normalizeTimeOff(timeOffResult.data),
    metrics: {
      ...normalizeTimeOff(timeOffResult.data).metrics,
      totalDaysTaken: enhancedLeave.totalDaysTaken,
      mostCommonType: enhancedLeave.mostCommonType,
      avgLeaveBalance: enhancedLeave.avgLeaveBalance
    },
    byDepartment: enhancedLeave.byDepartment,
    topUsers: enhancedLeave.topUsers
  };

  // Build payroll section
  const payroll: AnalyticsPayrollSection = {
    ...normalizePayroll(payrollResult.data),
    metrics: {
      ...normalizePayroll(payrollResult.data).metrics,
      lastRunGross: enhancedPayroll.lastRunGross,
      lastRunNet: enhancedPayroll.lastRunNet,
      avgGrossSalary: enhancedPayroll.avgGrossSalary,
      totalAllowances: enhancedPayroll.totalAllowances
    },
    compensationBands: enhancedPayroll.compensationBands
  };

  // Build expenses section
  const expenses: AnalyticsExpensesSection = {
    ...normalizeExpenses(expensesResult.data),
    metrics: {
      ...normalizeExpenses(expensesResult.data).metrics,
      reimbursedAmount: enhancedExpenses.reimbursedAmount,
      avgProcessingDays: enhancedExpenses.avgProcessingDays
    }
  };

  const responseData: AnalyticsResponseData = {
    dateRange: { startDate, endDate },
    filterOptions,
    people,
    timeOff,
    payroll,
    expenses,
    pipeline
  };

  if (query.format === "csv" && query.section) {
    const content = csvForSection(query.section, responseData);
    const fileName = `crew-hub-analytics-${query.section}-${startDate}-to-${endDate}.csv`;

    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"${fileName}\"`
      }
    });
  }

  return jsonResponse<AnalyticsResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
