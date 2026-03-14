import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import type { UserRole } from "../../../../../lib/navigation";
import { hasRole } from "../../../../../lib/roles";
import {
  getCurrentMonthKey,
  monthToDateRange,
  normalizeCountryCode,
  parseNumeric
} from "../../../../../lib/time-off";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import {
  type AfkCalendarRecord,
  type HolidayCalendarDay,
  type LeaveRequestRecord,
  type TimeOffCalendarResponseData
} from "../../../../../types/time-off";

const querySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  countryCode: z.string().trim().min(2).max(2).optional(),
  department: z.string().trim().min(1).max(100).optional()
});

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  department: z.string().nullable(),
  country_code: z.string().nullable()
});

const requestRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  leave_type: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  total_days: z.union([z.number(), z.string()]),
  status: z.enum(["pending", "approved", "rejected", "cancelled"]),
  reason: z.string(),
  approver_id: z.string().uuid().nullable(),
  rejection_reason: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const holidayRowSchema = z.object({
  id: z.string().uuid(),
  country_code: z.string(),
  date: z.string(),
  name: z.string(),
  year: z.number()
});

const afkLogRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  duration_minutes: z.union([z.number(), z.string()]),
  notes: z.string().nullable(),
  created_at: z.string()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function canViewAllRequests(userRoles: readonly UserRole[]): boolean {
  return hasRole(userRoles, "HR_ADMIN") || hasRole(userRoles, "SUPER_ADMIN");
}

function isManager(userRoles: readonly UserRole[]): boolean {
  return hasRole(userRoles, "MANAGER");
}

function dedupeSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((leftValue, rightValue) => leftValue.localeCompare(rightValue));
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view the team time off calendar."
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
        message: parsedQuery.error.issues[0]?.message ?? "Invalid calendar query parameters."
      },
      meta: buildMeta()
    });
  }

  const month = parsedQuery.data.month ?? getCurrentMonthKey();
  const monthRange = monthToDateRange(month);

  if (!monthRange) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Month must be in YYYY-MM format."
      },
      meta: buildMeta()
    });
  }

  const countryFilter = normalizeCountryCode(parsedQuery.data.countryCode ?? null);
  const departmentFilter = parsedQuery.data.department ?? null;
  const supabase = await createSupabaseServerClient();

  let accessibleProfilesQuery = supabase
    .from("profiles")
    .select("id, full_name, department, country_code")
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .order("full_name", { ascending: true });

  if (!canViewAllRequests(session.profile.roles)) {
    if (isManager(session.profile.roles)) {
      const { data: reportRows, error: reportsError } = await supabase
        .from("profiles")
        .select("id")
        .eq("org_id", session.profile.org_id)
        .eq("manager_id", session.profile.id)
        .is("deleted_at", null);

      if (reportsError) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "REPORTS_FETCH_FAILED",
            message: "Unable to resolve manager report scope for calendar view."
          },
          meta: buildMeta()
        });
      }

      const reportIds = (reportRows ?? [])
        .map((row) => row.id)
        .filter((value): value is string => typeof value === "string");
      const scopedIds = dedupeSorted([session.profile.id, ...reportIds]);

      accessibleProfilesQuery = accessibleProfilesQuery.in("id", scopedIds);
    } else {
      accessibleProfilesQuery = accessibleProfilesQuery.eq("id", session.profile.id);
    }
  }

  const { data: rawAccessibleProfiles, error: accessibleProfilesError } = await accessibleProfilesQuery;

  if (accessibleProfilesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILES_FETCH_FAILED",
        message: "Unable to load employee profiles for calendar view."
      },
      meta: buildMeta()
    });
  }

  const parsedAccessibleProfiles = z.array(profileRowSchema).safeParse(rawAccessibleProfiles ?? []);

  if (!parsedAccessibleProfiles.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILES_PARSE_FAILED",
        message: "Employee profile data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const accessibleProfiles = parsedAccessibleProfiles.data;

  const filters = {
    countries: dedupeSorted(
      accessibleProfiles
        .map((profile) => normalizeCountryCode(profile.country_code))
        .filter((value): value is string => Boolean(value))
    ),
    departments: dedupeSorted(
      accessibleProfiles
        .map((profile) => profile.department)
        .filter((value): value is string => Boolean(value))
    )
  };

  const filteredProfiles = accessibleProfiles.filter((profile) => {
    if (countryFilter && normalizeCountryCode(profile.country_code) !== countryFilter) {
      return false;
    }

    if (departmentFilter && profile.department !== departmentFilter) {
      return false;
    }

    return true;
  });

  const filteredProfileIds = filteredProfiles.map((profile) => profile.id);
  const profileById = new Map(filteredProfiles.map((profile) => [profile.id, profile]));

  let requests: LeaveRequestRecord[] = [];
  let afkLogs: AfkCalendarRecord[] = [];

  if (filteredProfileIds.length > 0) {
    const { data: rawRequests, error: requestsError } = await supabase
      .from("leave_requests")
      .select(
        "id, employee_id, leave_type, start_date, end_date, total_days, status, reason, approver_id, rejection_reason, created_at, updated_at"
      )
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .in("employee_id", filteredProfileIds)
      .in("status", ["pending", "approved"])
      .lte("start_date", monthRange.endDate)
      .gte("end_date", monthRange.startDate)
      .order("start_date", { ascending: true });

    if (requestsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REQUESTS_FETCH_FAILED",
          message: "Unable to load leave requests for calendar view."
        },
        meta: buildMeta()
      });
    }

    const parsedRequests = z.array(requestRowSchema).safeParse(rawRequests ?? []);

    if (!parsedRequests.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REQUESTS_PARSE_FAILED",
          message: "Leave request data is not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    requests = parsedRequests.data.map((row) => {
      const employee = profileById.get(row.employee_id);

      return {
        id: row.id,
        employeeId: row.employee_id,
        employeeName: employee?.full_name ?? "Unknown user",
        employeeDepartment: employee?.department ?? null,
        employeeCountryCode: employee?.country_code ?? null,
        leaveType: row.leave_type,
        startDate: row.start_date,
        endDate: row.end_date,
        totalDays: parseNumeric(row.total_days),
        status: row.status,
        reason: row.reason,
        approverId: row.approver_id,
        approverName: null,
        rejectionReason: row.rejection_reason,
        actingFor: null,
        actingForName: null,
        delegateType: null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    });

    const { data: rawAfkLogs, error: afkLogsError } = await supabase
      .from("afk_logs")
      .select("id, employee_id, date, start_time, end_time, duration_minutes, notes, created_at")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .is("reclassified_as", null)
      .in("employee_id", filteredProfileIds)
      .gte("date", monthRange.startDate)
      .lte("date", monthRange.endDate)
      .order("date", { ascending: true })
      .order("start_time", { ascending: true });

    if (afkLogsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "AFK_LOGS_FETCH_FAILED",
          message: "Unable to load AFK logs for calendar view."
        },
        meta: buildMeta()
      });
    }

    const parsedAfkLogs = z.array(afkLogRowSchema).safeParse(rawAfkLogs ?? []);

    if (!parsedAfkLogs.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "AFK_LOGS_PARSE_FAILED",
          message: "AFK log data is not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    afkLogs = parsedAfkLogs.data.map((row) => {
      const employee = profileById.get(row.employee_id);

      return {
        id: row.id,
        employeeId: row.employee_id,
        employeeName: employee?.full_name ?? "Unknown user",
        employeeDepartment: employee?.department ?? null,
        employeeCountryCode: employee?.country_code ?? null,
        date: row.date,
        startTime: row.start_time,
        endTime: row.end_time,
        durationMinutes: parseNumeric(row.duration_minutes),
        notes: row.notes ?? "",
        createdAt: row.created_at
      };
    });
  }

  const holidayCountryCodes = countryFilter
    ? [countryFilter]
    : dedupeSorted(
        filteredProfiles
          .map((profile) => normalizeCountryCode(profile.country_code))
          .filter((value): value is string => Boolean(value))
      );

  let holidays: HolidayCalendarDay[] = [];

  if (holidayCountryCodes.length > 0) {
    const { data: rawHolidays, error: holidaysError } = await supabase
      .from("holiday_calendars")
      .select("id, country_code, date, name, year")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .in("country_code", holidayCountryCodes)
      .gte("date", monthRange.startDate)
      .lte("date", monthRange.endDate)
      .order("date", { ascending: true });

    if (holidaysError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "HOLIDAYS_FETCH_FAILED",
          message: "Unable to load holidays for calendar view."
        },
        meta: buildMeta()
      });
    }

    const parsedHolidays = z.array(holidayRowSchema).safeParse(rawHolidays ?? []);

    if (!parsedHolidays.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "HOLIDAYS_PARSE_FAILED",
          message: "Holiday data is not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    holidays = parsedHolidays.data.map((row) => ({
      id: row.id,
      countryCode: row.country_code,
      date: row.date,
      name: row.name,
      year: row.year
    }));
  }

  const responseData: TimeOffCalendarResponseData = {
    month,
    monthStart: monthRange.startDate,
    monthEnd: monthRange.endDate,
    requests,
    afkLogs,
    holidays,
    filters
  };

  return jsonResponse<TimeOffCalendarResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
