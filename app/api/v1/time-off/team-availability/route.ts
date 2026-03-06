import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { formatLeaveTypeLabel, isIsoDate } from "../../../../../lib/time-off";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";

type TeamAvailabilityMember = {
  employeeId: string;
  employeeName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
};

type TeamAvailabilityResponseData = {
  teamSize: number;
  overlapping: TeamAvailabilityMember[];
  awayCount: number;
};

const querySchema = z.object({
  start: z
    .string()
    .refine((value) => isIsoDate(value), "Start date must be in YYYY-MM-DD format"),
  end: z
    .string()
    .refine((value) => isIsoDate(value), "End date must be in YYYY-MM-DD format")
});

const teamProfileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string()
});

const leaveRequestRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  leave_type: z.string(),
  start_date: z.string(),
  end_date: z.string()
});

const afkLogRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  date: z.string(),
  start_time: z.string(),
  end_time: z.string()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view team availability."
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
        message: parsedQuery.error.issues[0]?.message ?? "Invalid query parameters."
      },
      meta: buildMeta()
    });
  }

  if (parsedQuery.data.end < parsedQuery.data.start) {
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

  // Resolve the current user's department
  const { data: currentProfile, error: profileError } = await supabase
    .from("profiles")
    .select("id, department")
    .eq("id", session.profile.id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .single();

  if (profileError || !currentProfile) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_FETCH_FAILED",
        message: "Unable to resolve employee profile for team availability."
      },
      meta: buildMeta()
    });
  }

  // If user has no department, return empty team
  if (!currentProfile.department) {
    return jsonResponse<TeamAvailabilityResponseData>(200, {
      data: {
        teamSize: 0,
        overlapping: [],
        awayCount: 0
      },
      error: null,
      meta: buildMeta()
    });
  }

  // Find team members in the same department (excluding the current user)
  const { data: rawTeamMembers, error: teamError } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("org_id", session.profile.org_id)
    .eq("department", currentProfile.department)
    .neq("id", session.profile.id)
    .is("deleted_at", null);

  if (teamError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TEAM_FETCH_FAILED",
        message: "Unable to load team members."
      },
      meta: buildMeta()
    });
  }

  const parsedTeamMembers = z.array(teamProfileRowSchema).safeParse(rawTeamMembers ?? []);

  if (!parsedTeamMembers.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TEAM_PARSE_FAILED",
        message: "Team member data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const teamMembers = parsedTeamMembers.data;
  const teamSize = teamMembers.length;

  if (teamSize === 0) {
    return jsonResponse<TeamAvailabilityResponseData>(200, {
      data: {
        teamSize: 0,
        overlapping: [],
        awayCount: 0
      },
      error: null,
      meta: buildMeta()
    });
  }

  const teamMemberIds = teamMembers.map((member) => member.id);

  // Query approved leave requests that overlap with [start, end]
  // A request overlaps if: request.start_date <= end AND request.end_date >= start
  const { data: rawLeaveRequests, error: leaveError } = await supabase
    .from("leave_requests")
    .select("id, employee_id, leave_type, start_date, end_date")
    .eq("org_id", session.profile.org_id)
    .eq("status", "approved")
    .in("employee_id", teamMemberIds)
    .lte("start_date", parsedQuery.data.end)
    .gte("end_date", parsedQuery.data.start)
    .is("deleted_at", null);

  if (leaveError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "LEAVE_REQUESTS_FETCH_FAILED",
        message: "Unable to load team leave requests."
      },
      meta: buildMeta()
    });
  }

  const parsedLeaveRequests = z.array(leaveRequestRowSchema).safeParse(rawLeaveRequests ?? []);

  if (!parsedLeaveRequests.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "LEAVE_REQUESTS_PARSE_FAILED",
        message: "Team leave request data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  // Build a name lookup map
  const nameById = new Map(teamMembers.map((member) => [member.id, member.full_name]));

  const overlappingLeave: TeamAvailabilityMember[] = parsedLeaveRequests.data.map((row) => ({
    employeeId: row.employee_id,
    employeeName: nameById.get(row.employee_id) ?? "Unknown",
    leaveType: formatLeaveTypeLabel(row.leave_type),
    startDate: row.start_date,
    endDate: row.end_date
  }));

  const { data: rawAfkLogs, error: afkLogsError } = await supabase
    .from("afk_logs")
    .select("id, employee_id, date, start_time, end_time")
    .eq("org_id", session.profile.org_id)
    .in("employee_id", teamMemberIds)
    .is("reclassified_as", null)
    .gte("date", parsedQuery.data.start)
    .lte("date", parsedQuery.data.end)
    .is("deleted_at", null);

  if (afkLogsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "AFK_LOGS_FETCH_FAILED",
        message: "Unable to load team AFK logs."
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
        message: "Team AFK log data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const overlappingAfk: TeamAvailabilityMember[] = parsedAfkLogs.data.map((row) => ({
    employeeId: row.employee_id,
    employeeName: nameById.get(row.employee_id) ?? "Unknown",
    leaveType: `AFK ${row.start_time}-${row.end_time}`,
    startDate: row.date,
    endDate: row.date
  }));

  const overlapping = [...overlappingLeave, ...overlappingAfk].sort((leftValue, rightValue) => {
    if (leftValue.startDate !== rightValue.startDate) {
      return leftValue.startDate.localeCompare(rightValue.startDate);
    }

    return leftValue.employeeName.localeCompare(rightValue.employeeName);
  });

  // Count unique employees who are away
  const uniqueAwayIds = new Set(overlapping.map((member) => member.employeeId));

  return jsonResponse<TeamAvailabilityResponseData>(200, {
    data: {
      teamSize,
      overlapping,
      awayCount: uniqueAwayIds.size
    },
    error: null,
    meta: buildMeta()
  });
}
