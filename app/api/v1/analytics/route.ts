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
  AnalyticsPeopleSection,
  AnalyticsPayrollSection,
  AnalyticsResponseData,
  AnalyticsTimeOffSection
} from "../../../../types/analytics";

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
const querySchema = z.object({
  startDate: z.string().regex(isoDateRegex).optional(),
  endDate: z.string().regex(isoDateRegex).optional(),
  format: z.enum(["json", "csv"]).optional(),
  section: z.enum(["people", "time_off", "payroll", "expenses"]).optional()
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

function normalizePeople(value: unknown): AnalyticsPeopleSection {
  const source = asRecord(value);
  const metrics = asRecord(source.metrics);

  return {
    metrics: {
      activeHeadcount: Math.trunc(toNumber(metrics.activeHeadcount)),
      newHires: Math.trunc(toNumber(metrics.newHires)),
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

function normalizeTimeOff(value: unknown): AnalyticsTimeOffSection {
  const source = asRecord(value);
  const metrics = asRecord(source.metrics);

  return {
    metrics: {
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

function normalizePayroll(value: unknown): AnalyticsPayrollSection {
  const source = asRecord(value);
  const metrics = asRecord(source.metrics);

  return {
    metrics: {
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
    })
  };
}

function normalizeExpenses(value: unknown): AnalyticsExpensesSection {
  const source = asRecord(value);
  const metrics = asRecord(source.metrics);

  return {
    metrics: {
      totalAmount: Math.trunc(toNumber(metrics.totalAmount)),
      approvedAmount: Math.trunc(toNumber(metrics.approvedAmount)),
      pendingAmount: Math.trunc(toNumber(metrics.pendingAmount)),
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

  for (const row of data.timeOff.currentlyOut) {
    rows.push([
      "currently_out",
      row.employeeId,
      row.fullName,
      row.totalDays,
      row.leaveType,
      row.endDate
    ]);
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
    rows.push([
      "top_spenders",
      row.employeeId,
      row.fullName,
      row.totalAmount,
      row.expenseCount,
      row.countryCode ?? "--"
    ]);
  }

  return rows;
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

  return toCsvContent(header, expensesCsvRows(data));
}

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
  const rpcPayload = {
    p_org_id: session.profile.org_id,
    p_start_date: startDate,
    p_end_date: endDate
  };

  const [peopleResult, timeOffResult, payrollResult, expensesResult] = await Promise.all([
    supabase.rpc("analytics_people", rpcPayload),
    supabase.rpc("analytics_time_off", rpcPayload),
    supabase.rpc("analytics_payroll", rpcPayload),
    supabase.rpc("analytics_expenses", rpcPayload)
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

  const responseData: AnalyticsResponseData = {
    dateRange: {
      startDate,
      endDate
    },
    people: normalizePeople(peopleResult.data),
    timeOff: normalizeTimeOff(timeOffResult.data),
    payroll: normalizePayroll(payrollResult.data),
    expenses: normalizeExpenses(expensesResult.data)
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
