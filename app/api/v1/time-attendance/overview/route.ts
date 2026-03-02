import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import {
  getCurrentIsoDate,
  getCurrentWeekRange,
  getOpenEntrySeconds,
  parseInteger,
  weekRangeFromIsoDate,
  resolveWorkedMinutes
} from "../../../../../lib/time-attendance";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import {
  TIME_ENTRY_METHODS,
  TIMESHEET_STATUSES,
  type TimeAttendanceOverviewResponseData,
  type TimeEntryRecord,
  type TimesheetRecord
} from "../../../../../types/time-attendance";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  weekStart: z.string().regex(isoDatePattern).optional()
});

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  department: z.string().nullable(),
  country_code: z.string().nullable()
});

const entryRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  policy_id: z.string().uuid().nullable(),
  clock_in: z.string(),
  clock_out: z.string().nullable(),
  regular_minutes: z.union([z.number(), z.string()]),
  overtime_minutes: z.union([z.number(), z.string()]),
  double_time_minutes: z.union([z.number(), z.string()]),
  break_minutes: z.union([z.number(), z.string()]),
  total_minutes: z.union([z.number(), z.string()]),
  clock_in_method: z.enum(TIME_ENTRY_METHODS),
  clock_out_method: z.enum(TIME_ENTRY_METHODS).nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const timesheetRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  week_start: z.string(),
  week_end: z.string(),
  total_regular_minutes: z.union([z.number(), z.string()]),
  total_overtime_minutes: z.union([z.number(), z.string()]),
  total_double_time_minutes: z.union([z.number(), z.string()]),
  total_break_minutes: z.union([z.number(), z.string()]),
  total_worked_minutes: z.union([z.number(), z.string()]),
  status: z.enum(TIMESHEET_STATUSES),
  submitted_at: z.string().nullable(),
  approved_by: z.string().uuid().nullable(),
  approved_at: z.string().nullable(),
  rejection_reason: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const actorRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function mapEntryRow({
  entry,
  profile
}: {
  entry: z.infer<typeof entryRowSchema>;
  profile: z.infer<typeof profileRowSchema>;
}): TimeEntryRecord {
  const recordedTotalMinutes = parseInteger(entry.total_minutes);

  return {
    id: entry.id,
    orgId: entry.org_id,
    employeeId: entry.employee_id,
    employeeName: profile.full_name,
    employeeDepartment: profile.department,
    employeeCountryCode: profile.country_code,
    policyId: entry.policy_id,
    clockIn: entry.clock_in,
    clockOut: entry.clock_out,
    regularMinutes: parseInteger(entry.regular_minutes),
    overtimeMinutes: parseInteger(entry.overtime_minutes),
    doubleTimeMinutes: parseInteger(entry.double_time_minutes),
    breakMinutes: parseInteger(entry.break_minutes),
    totalMinutes: resolveWorkedMinutes({
      totalMinutes: recordedTotalMinutes,
      clockIn: entry.clock_in,
      clockOut: entry.clock_out
    }),
    clockInMethod: entry.clock_in_method,
    clockOutMethod: entry.clock_out_method,
    notes: entry.notes,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at
  };
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view attendance overview."
      },
      meta: buildMeta()
    });
  }

  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid overview query parameters."
      },
      meta: buildMeta()
    });
  }

  const currentDate = getCurrentIsoDate();
  const targetWeek = parsedQuery.data.weekStart
    ? weekRangeFromIsoDate(parsedQuery.data.weekStart)
    : getCurrentWeekRange();

  if (!targetWeek) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Week start must be in YYYY-MM-DD format."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: rawProfile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, department, country_code")
    .eq("org_id", session.profile.org_id)
    .eq("id", session.profile.id)
    .is("deleted_at", null)
    .single();

  if (profileError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_FETCH_FAILED",
        message: "Unable to load profile for attendance overview."
      },
      meta: buildMeta()
    });
  }

  const parsedProfile = profileRowSchema.safeParse(rawProfile);

  if (!parsedProfile.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_PARSE_FAILED",
        message: "Profile data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const profile = parsedProfile.data;

  const [
    { data: rawActiveEntry, error: activeEntryError },
    { data: rawTodayEntries, error: todayEntriesError },
    { data: rawRecentEntries, error: recentEntriesError },
    { data: rawRecentTimesheets, error: recentTimesheetsError },
    { data: rawWeekTimesheet, error: weekTimesheetError },
    { count: pendingTimesheetCount, error: pendingCountError }
  ] = await Promise.all([
    supabase
      .from("time_entries")
      .select(
        "id, org_id, employee_id, policy_id, clock_in, clock_out, regular_minutes, overtime_minutes, double_time_minutes, break_minutes, total_minutes, clock_in_method, clock_out_method, notes, created_at, updated_at"
      )
      .eq("org_id", session.profile.org_id)
      .eq("employee_id", session.profile.id)
      .is("deleted_at", null)
      .is("clock_out", null)
      .order("clock_in", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("time_entries")
      .select(
        "id, org_id, employee_id, policy_id, clock_in, clock_out, regular_minutes, overtime_minutes, double_time_minutes, break_minutes, total_minutes, clock_in_method, clock_out_method, notes, created_at, updated_at"
      )
      .eq("org_id", session.profile.org_id)
      .eq("employee_id", session.profile.id)
      .is("deleted_at", null)
      .gte("clock_in", `${currentDate}T00:00:00.000Z`)
      .lte("clock_in", `${currentDate}T23:59:59.999Z`)
      .order("clock_in", { ascending: false }),
    supabase
      .from("time_entries")
      .select(
        "id, org_id, employee_id, policy_id, clock_in, clock_out, regular_minutes, overtime_minutes, double_time_minutes, break_minutes, total_minutes, clock_in_method, clock_out_method, notes, created_at, updated_at"
      )
      .eq("org_id", session.profile.org_id)
      .eq("employee_id", session.profile.id)
      .is("deleted_at", null)
      .order("clock_in", { ascending: false })
      .limit(12),
    supabase
      .from("timesheets")
      .select(
        "id, org_id, employee_id, week_start, week_end, total_regular_minutes, total_overtime_minutes, total_double_time_minutes, total_break_minutes, total_worked_minutes, status, submitted_at, approved_by, approved_at, rejection_reason, created_at, updated_at"
      )
      .eq("org_id", session.profile.org_id)
      .eq("employee_id", session.profile.id)
      .is("deleted_at", null)
      .order("week_start", { ascending: false })
      .limit(6),
    supabase
      .from("timesheets")
      .select(
        "id, org_id, employee_id, week_start, week_end, total_regular_minutes, total_overtime_minutes, total_double_time_minutes, total_break_minutes, total_worked_minutes, status, submitted_at, approved_by, approved_at, rejection_reason, created_at, updated_at"
      )
      .eq("org_id", session.profile.org_id)
      .eq("employee_id", session.profile.id)
      .eq("week_start", targetWeek.weekStart)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("timesheets")
      .select("id", { count: "exact", head: true })
      .eq("org_id", session.profile.org_id)
      .eq("employee_id", session.profile.id)
      .in("status", ["pending", "submitted"])
      .is("deleted_at", null)
  ]);

  if (
    activeEntryError ||
    todayEntriesError ||
    recentEntriesError ||
    recentTimesheetsError ||
    weekTimesheetError ||
    pendingCountError
  ) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "OVERVIEW_FETCH_FAILED",
        message: "Unable to load attendance overview data."
      },
      meta: buildMeta()
    });
  }

  const parsedActiveEntry = rawActiveEntry ? entryRowSchema.safeParse(rawActiveEntry) : null;
  const parsedTodayEntries = z.array(entryRowSchema).safeParse(rawTodayEntries ?? []);
  const parsedRecentEntries = z.array(entryRowSchema).safeParse(rawRecentEntries ?? []);
  const parsedRecentTimesheets = z.array(timesheetRowSchema).safeParse(rawRecentTimesheets ?? []);
  const parsedWeekTimesheet = rawWeekTimesheet ? timesheetRowSchema.safeParse(rawWeekTimesheet) : null;

  if (
    (parsedActiveEntry && !parsedActiveEntry.success) ||
    !parsedTodayEntries.success ||
    !parsedRecentEntries.success ||
    !parsedRecentTimesheets.success ||
    (parsedWeekTimesheet && !parsedWeekTimesheet.success)
  ) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "OVERVIEW_PARSE_FAILED",
        message: "Attendance overview data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const actorIds = [
    ...new Set(
      parsedRecentTimesheets.data
        .map((timesheet) => timesheet.approved_by)
        .filter((value): value is string => Boolean(value))
    )
  ];

  let actorNameById = new Map<string, string>();

  if (actorIds.length > 0) {
    const { data: rawActors, error: actorsError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .in("id", actorIds);

    if (actorsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "ACTORS_FETCH_FAILED",
          message: "Unable to load approver metadata."
        },
        meta: buildMeta()
      });
    }

    const parsedActors = z.array(actorRowSchema).safeParse(rawActors ?? []);

    if (!parsedActors.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "ACTORS_PARSE_FAILED",
          message: "Approver metadata is not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    actorNameById = new Map(parsedActors.data.map((actor) => [actor.id, actor.full_name]));
  }

  const activeEntry: TimeEntryRecord | null = parsedActiveEntry?.success
    ? mapEntryRow({
        entry: parsedActiveEntry.data,
        profile
      })
    : null;

  const recentEntries: TimeEntryRecord[] = parsedRecentEntries.data.map((entry) =>
    mapEntryRow({
      entry,
      profile
    })
  );

  const recentTimesheets: TimesheetRecord[] = parsedRecentTimesheets.data.map((timesheet) => ({
    id: timesheet.id,
    orgId: timesheet.org_id,
    employeeId: timesheet.employee_id,
    employeeName: profile.full_name,
    employeeDepartment: profile.department,
    employeeCountryCode: profile.country_code,
    weekStart: timesheet.week_start,
    weekEnd: timesheet.week_end,
    totalRegularMinutes: parseInteger(timesheet.total_regular_minutes),
    totalOvertimeMinutes: parseInteger(timesheet.total_overtime_minutes),
    totalDoubleTimeMinutes: parseInteger(timesheet.total_double_time_minutes),
    totalBreakMinutes: parseInteger(timesheet.total_break_minutes),
    totalWorkedMinutes: parseInteger(timesheet.total_worked_minutes),
    status: timesheet.status,
    submittedAt: timesheet.submitted_at,
    approvedBy: timesheet.approved_by,
    approvedByName: timesheet.approved_by ? actorNameById.get(timesheet.approved_by) ?? null : null,
    approvedAt: timesheet.approved_at,
    rejectionReason: timesheet.rejection_reason,
    createdAt: timesheet.created_at,
    updatedAt: timesheet.updated_at
  }));

  const todayWorkedMinutes = parsedTodayEntries.data.reduce((total, entry) => {
    return (
      total +
      resolveWorkedMinutes({
        totalMinutes: parseInteger(entry.total_minutes),
        clockIn: entry.clock_in,
        clockOut: entry.clock_out
      })
    );
  }, 0);

  const todayBreakMinutes = parsedTodayEntries.data.reduce(
    (total, entry) => total + parseInteger(entry.break_minutes),
    0
  );

  const weekWorkedMinutesFromTimesheet = parsedWeekTimesheet?.success
    ? parseInteger(parsedWeekTimesheet.data.total_worked_minutes)
    : 0;

  const weekOvertimeMinutesFromTimesheet = parsedWeekTimesheet?.success
    ? parseInteger(parsedWeekTimesheet.data.total_overtime_minutes)
    : 0;

  const weekFallbackWorkedMinutes = recentEntries
    .filter(
      (entry) =>
        entry.clockIn >= `${targetWeek.weekStart}T00:00:00.000Z` &&
        entry.clockIn <= `${targetWeek.weekEnd}T23:59:59.999Z`
    )
    .reduce((total, entry) => total + entry.totalMinutes, 0);

  const weekFallbackOvertimeMinutes = recentEntries
    .filter(
      (entry) =>
        entry.clockIn >= `${targetWeek.weekStart}T00:00:00.000Z` &&
        entry.clockIn <= `${targetWeek.weekEnd}T23:59:59.999Z`
    )
    .reduce((total, entry) => total + entry.overtimeMinutes, 0);

  const response: TimeAttendanceOverviewResponseData = {
    profile: {
      id: profile.id,
      fullName: profile.full_name,
      department: profile.department,
      countryCode: profile.country_code
    },
    activeEntry,
    recentEntries,
    recentTimesheets,
    totals: {
      workedMinutesToday: todayWorkedMinutes,
      breakMinutesToday: todayBreakMinutes,
      workedMinutesThisWeek:
        weekWorkedMinutesFromTimesheet > 0 ? weekWorkedMinutesFromTimesheet : weekFallbackWorkedMinutes,
      overtimeMinutesThisWeek:
        weekOvertimeMinutesFromTimesheet > 0
          ? weekOvertimeMinutesFromTimesheet
          : weekFallbackOvertimeMinutes,
      openEntrySeconds: activeEntry ? getOpenEntrySeconds(activeEntry.clockIn) : 0,
      pendingTimesheetCount: pendingTimesheetCount ?? 0
    }
  };

  return jsonResponse<TimeAttendanceOverviewResponseData>(200, {
    data: response,
    error: null,
    meta: buildMeta()
  });
}
