import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { parseInteger, resolveWorkedMinutes } from "../../../../../lib/time-attendance";
import type { UserRole } from "../../../../../lib/navigation";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import {
  TIME_ENTRY_METHODS,
  type TimeAttendanceEntriesResponseData,
  type TimeEntryRecord
} from "../../../../../types/time-attendance";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  scope: z.enum(["mine", "team"]).default("mine"),
  employeeId: z.string().uuid().optional(),
  startDate: z.string().regex(isoDatePattern).optional(),
  endDate: z.string().regex(isoDatePattern).optional(),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(500).default(100)
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

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  department: z.string().nullable(),
  country_code: z.string().nullable()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function canViewTeamEntries(userRoles: readonly UserRole[]): boolean {
  return (
    hasRole(userRoles, "MANAGER") ||
    hasRole(userRoles, "HR_ADMIN") ||
    hasRole(userRoles, "FINANCE_ADMIN") ||
    hasRole(userRoles, "SUPER_ADMIN")
  );
}

function canViewAllEntries(userRoles: readonly UserRole[]): boolean {
  return (
    hasRole(userRoles, "HR_ADMIN") ||
    hasRole(userRoles, "FINANCE_ADMIN") ||
    hasRole(userRoles, "SUPER_ADMIN")
  );
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view time entries."
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
        message: parsedQuery.error.issues[0]?.message ?? "Invalid entries query parameters."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;

  if (query.endDate && query.startDate && query.endDate < query.startDate) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "End date must be on or after start date."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const scope = query.scope;
  const canViewTeam = canViewTeamEntries(session.profile.roles);
  const canViewAll = canViewAllEntries(session.profile.roles);

  if (scope === "team" && !canViewTeam) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to view team time entries."
      },
      meta: buildMeta()
    });
  }

  let filterEmployeeIds: string[] = [];

  if (scope === "mine") {
    filterEmployeeIds = [session.profile.id];
  } else if (query.employeeId) {
    if (canViewAll) {
      filterEmployeeIds = [query.employeeId];
    } else {
      const { data: reportRow, error: reportError } = await supabase
        .from("profiles")
        .select("id")
        .eq("org_id", session.profile.org_id)
        .eq("id", query.employeeId)
        .eq("manager_id", session.profile.id)
        .is("deleted_at", null)
        .maybeSingle();

      if (reportError) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "REPORT_FETCH_FAILED",
            message: "Unable to resolve manager scope for time entries."
          },
          meta: buildMeta()
        });
      }

      if (!reportRow?.id) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "You can only view time entries for your direct reports."
          },
          meta: buildMeta()
        });
      }

      filterEmployeeIds = [query.employeeId];
    }
  } else if (!canViewAll) {
    const { data: reportRows, error: reportError } = await supabase
      .from("profiles")
      .select("id")
      .eq("org_id", session.profile.org_id)
      .eq("manager_id", session.profile.id)
      .is("deleted_at", null);

    if (reportError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REPORTS_FETCH_FAILED",
          message: "Unable to load direct reports for team entries."
        },
        meta: buildMeta()
      });
    }

    filterEmployeeIds = (reportRows ?? [])
      .map((row) => row.id)
      .filter((value): value is string => typeof value === "string");

    if (filterEmployeeIds.length === 0) {
      return jsonResponse<TimeAttendanceEntriesResponseData>(200, {
        data: {
          entries: []
        },
        error: null,
        meta: buildMeta()
      });
    }
  }

  let entriesQuery = supabase
    .from("time_entries")
    .select(
      "id, org_id, employee_id, policy_id, clock_in, clock_out, regular_minutes, overtime_minutes, double_time_minutes, break_minutes, total_minutes, clock_in_method, clock_out_method, notes, created_at, updated_at"
    )
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .order("clock_in", { ascending: query.sortDir === "asc" })
    .limit(query.limit);

  if (query.startDate) {
    entriesQuery = entriesQuery.gte("clock_in", `${query.startDate}T00:00:00.000Z`);
  }

  if (query.endDate) {
    entriesQuery = entriesQuery.lte("clock_in", `${query.endDate}T23:59:59.999Z`);
  }

  if (filterEmployeeIds.length > 0) {
    entriesQuery = entriesQuery.in("employee_id", filterEmployeeIds);
  }

  const { data: rawEntries, error: entriesError } = await entriesQuery;

  if (entriesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ENTRIES_FETCH_FAILED",
        message: "Unable to load time entries."
      },
      meta: buildMeta()
    });
  }

  const parsedEntries = z.array(entryRowSchema).safeParse(rawEntries ?? []);

  if (!parsedEntries.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ENTRIES_PARSE_FAILED",
        message: "Time entry data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  if (parsedEntries.data.length === 0) {
    return jsonResponse<TimeAttendanceEntriesResponseData>(200, {
      data: {
        entries: []
      },
      error: null,
      meta: buildMeta()
    });
  }

  const employeeIds = [...new Set(parsedEntries.data.map((entry) => entry.employee_id))];

  const { data: rawProfiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, full_name, department, country_code")
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .in("id", employeeIds);

  if (profilesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILES_FETCH_FAILED",
        message: "Unable to resolve employee metadata for time entries."
      },
      meta: buildMeta()
    });
  }

  const parsedProfiles = z.array(profileRowSchema).safeParse(rawProfiles ?? []);

  if (!parsedProfiles.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILES_PARSE_FAILED",
        message: "Employee metadata is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const profileById = new Map(parsedProfiles.data.map((profile) => [profile.id, profile]));

  const entries: TimeEntryRecord[] = parsedEntries.data.map((entry) => {
    const profile = profileById.get(entry.employee_id);
    const recordedTotalMinutes = parseInteger(entry.total_minutes);

    return {
      id: entry.id,
      orgId: entry.org_id,
      employeeId: entry.employee_id,
      employeeName: profile?.full_name ?? "Unknown user",
      employeeDepartment: profile?.department ?? null,
      employeeCountryCode: profile?.country_code ?? null,
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
  });

  return jsonResponse<TimeAttendanceEntriesResponseData>(200, {
    data: {
      entries
    },
    error: null,
    meta: buildMeta()
  });
}
