import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { logAudit } from "../../../../../lib/audit";
import { parseInteger } from "../../../../../lib/time-attendance";
import type { UserRole } from "../../../../../lib/navigation";
import { hasRole, isDepartmentScopedTeamLead } from "../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import {
  TIMESHEET_STATUSES,
  type TimeAttendanceApprovalMutationResponseData,
  type TimeAttendanceApprovalsResponseData,
  type TimesheetRecord
} from "../../../../../types/time-attendance";

const querySchema = z.object({
  status: z.enum(TIMESHEET_STATUSES).default("submitted"),
  sortBy: z.enum(["week_start", "created_at"]).default("week_start"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(300).default(120)
});

const updateApprovalSchema = z.object({
  timesheetId: z.string().uuid("timesheetId must be a valid UUID."),
  action: z.enum(["approve", "reject"]),
  rejectionReason: z.string().trim().max(500).optional()
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

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  department: z.string().nullable(),
  country_code: z.string().nullable()
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

function canReviewTimesheets(userRoles: readonly UserRole[]): boolean {
  return (
    hasRole(userRoles, "TEAM_LEAD") ||
    hasRole(userRoles, "MANAGER") ||
    hasRole(userRoles, "HR_ADMIN") ||
    hasRole(userRoles, "FINANCE_ADMIN") ||
    hasRole(userRoles, "SUPER_ADMIN")
  );
}

function canViewAllTimesheets(userRoles: readonly UserRole[]): boolean {
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
        message: "You must be logged in to review timesheet approvals."
      },
      meta: buildMeta()
    });
  }

  if (!canReviewTimesheets(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to review timesheet approvals."
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
        message: parsedQuery.error.issues[0]?.message ?? "Invalid approvals query parameters."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;
  const supabase = await createSupabaseServerClient();
  const isScopedTeamLead = isDepartmentScopedTeamLead(session.profile.roles);

  if (isScopedTeamLead && !session.profile.department) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "TEAM_LEAD_DEPARTMENT_REQUIRED",
        message: "Team lead attendance review requires a department on your profile."
      },
      meta: buildMeta()
    });
  }

  let reportIds: string[] = [];

  if (!canViewAllTimesheets(session.profile.roles)) {
    const reportQuery = supabase
      .from("profiles")
      .select("id")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null);

    const { data: reportRows, error: reportError } = isScopedTeamLead
      ? await reportQuery.ilike("department", session.profile.department as string)
      : await reportQuery.eq("manager_id", session.profile.id);

    if (reportError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REPORTS_FETCH_FAILED",
          message: isScopedTeamLead
            ? "Unable to load department scope for timesheet approvals."
            : "Unable to load direct reports for timesheet approvals."
        },
        meta: buildMeta()
      });
    }

    reportIds = (reportRows ?? [])
      .map((row) => row.id)
      .filter((value): value is string => typeof value === "string");

    if (reportIds.length === 0) {
      return jsonResponse<TimeAttendanceApprovalsResponseData>(200, {
        data: {
          timesheets: []
        },
        error: null,
        meta: buildMeta()
      });
    }
  }

  let timesheetQuery = supabase
    .from("timesheets")
    .select(
      "id, org_id, employee_id, week_start, week_end, total_regular_minutes, total_overtime_minutes, total_double_time_minutes, total_break_minutes, total_worked_minutes, status, submitted_at, approved_by, approved_at, rejection_reason, created_at, updated_at"
    )
    .eq("org_id", session.profile.org_id)
    .eq("status", query.status)
    .is("deleted_at", null)
    .order(query.sortBy, { ascending: query.sortDir === "asc" })
    .limit(query.limit);

  if (reportIds.length > 0) {
    timesheetQuery = timesheetQuery.in("employee_id", reportIds);
  }

  const { data: rawTimesheets, error: timesheetsError } = await timesheetQuery;

  if (timesheetsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TIMESHEETS_FETCH_FAILED",
        message: "Unable to load timesheet approvals."
      },
      meta: buildMeta()
    });
  }

  const parsedTimesheets = z.array(timesheetRowSchema).safeParse(rawTimesheets ?? []);

  if (!parsedTimesheets.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TIMESHEETS_PARSE_FAILED",
        message: "Timesheet approval data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  if (parsedTimesheets.data.length === 0) {
    return jsonResponse<TimeAttendanceApprovalsResponseData>(200, {
      data: {
        timesheets: []
      },
      error: null,
      meta: buildMeta()
    });
  }

  const employeeIds = [...new Set(parsedTimesheets.data.map((timesheet) => timesheet.employee_id))];
  const approverIds = [
    ...new Set(
      parsedTimesheets.data
        .map((timesheet) => timesheet.approved_by)
        .filter((value): value is string => Boolean(value))
    )
  ];

  const [{ data: rawProfiles, error: profilesError }, { data: rawApprovers, error: approversError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, department, country_code")
        .eq("org_id", session.profile.org_id)
        .is("deleted_at", null)
        .in("id", employeeIds),
      approverIds.length > 0
        ? supabase
            .from("profiles")
            .select("id, full_name")
            .eq("org_id", session.profile.org_id)
            .is("deleted_at", null)
            .in("id", approverIds)
        : Promise.resolve({ data: [], error: null })
    ]);

  if (profilesError || approversError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TIMESHEET_ACTORS_FETCH_FAILED",
        message: "Unable to resolve employee metadata for approvals."
      },
      meta: buildMeta()
    });
  }

  const parsedProfiles = z.array(profileRowSchema).safeParse(rawProfiles ?? []);
  const parsedApprovers = z.array(actorRowSchema).safeParse(rawApprovers ?? []);

  if (!parsedProfiles.success || !parsedApprovers.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TIMESHEET_ACTORS_PARSE_FAILED",
        message: "Employee metadata is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const profileById = new Map(parsedProfiles.data.map((profile) => [profile.id, profile]));
  const approverNameById = new Map(parsedApprovers.data.map((actor) => [actor.id, actor.full_name]));

  const timesheets: TimesheetRecord[] = parsedTimesheets.data.map((timesheet) => {
    const employee = profileById.get(timesheet.employee_id);

    return {
      id: timesheet.id,
      orgId: timesheet.org_id,
      employeeId: timesheet.employee_id,
      employeeName: employee?.full_name ?? "Unknown user",
      employeeDepartment: employee?.department ?? null,
      employeeCountryCode: employee?.country_code ?? null,
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
      approvedByName: timesheet.approved_by
        ? approverNameById.get(timesheet.approved_by) ?? null
        : null,
      approvedAt: timesheet.approved_at,
      rejectionReason: timesheet.rejection_reason,
      createdAt: timesheet.created_at,
      updatedAt: timesheet.updated_at
    };
  });

  return jsonResponse<TimeAttendanceApprovalsResponseData>(200, {
    data: {
      timesheets
    },
    error: null,
    meta: buildMeta()
  });
}

export async function PUT(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to update timesheet approvals."
      },
      meta: buildMeta()
    });
  }

  if (!canReviewTimesheets(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to update timesheet approvals."
      },
      meta: buildMeta()
    });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Request body must be valid JSON."
      },
      meta: buildMeta()
    });
  }

  const parsedBody = updateApprovalSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid approval payload."
      },
      meta: buildMeta()
    });
  }

  if (
    parsedBody.data.action === "reject" &&
    (!parsedBody.data.rejectionReason || parsedBody.data.rejectionReason.trim().length === 0)
  ) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Rejection reason is required when rejecting a timesheet."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const isScopedTeamLead = isDepartmentScopedTeamLead(session.profile.roles);

  if (isScopedTeamLead && !session.profile.department) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "TEAM_LEAD_DEPARTMENT_REQUIRED",
        message: "Team lead attendance review requires a department on your profile."
      },
      meta: buildMeta()
    });
  }

  const { data: rawTimesheet, error: timesheetError } = await supabase
    .from("timesheets")
    .select(
      "id, org_id, employee_id, week_start, week_end, total_regular_minutes, total_overtime_minutes, total_double_time_minutes, total_break_minutes, total_worked_minutes, status, submitted_at, approved_by, approved_at, rejection_reason, created_at, updated_at"
    )
    .eq("org_id", session.profile.org_id)
    .eq("id", parsedBody.data.timesheetId)
    .is("deleted_at", null)
    .maybeSingle();

  if (timesheetError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TIMESHEET_FETCH_FAILED",
        message: "Unable to load timesheet."
      },
      meta: buildMeta()
    });
  }

  if (!rawTimesheet) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "TIMESHEET_NOT_FOUND",
        message: "Timesheet was not found."
      },
      meta: buildMeta()
    });
  }

  const parsedTimesheet = timesheetRowSchema.safeParse(rawTimesheet);

  if (!parsedTimesheet.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TIMESHEET_PARSE_FAILED",
        message: "Timesheet data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const currentTimesheet = parsedTimesheet.data;

  if (currentTimesheet.status !== "submitted" && currentTimesheet.status !== "pending") {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "TIMESHEET_STATUS_INVALID",
        message: "Only pending or submitted timesheets can be approved or rejected."
      },
      meta: buildMeta()
    });
  }

  if (!canViewAllTimesheets(session.profile.roles)) {
    if (isScopedTeamLead) {
      const { data: employeeRow, error: employeeScopeError } = await supabase
        .from("profiles")
        .select("id")
        .eq("org_id", session.profile.org_id)
        .eq("id", currentTimesheet.employee_id)
        .ilike("department", session.profile.department as string)
        .is("deleted_at", null)
        .maybeSingle();

      if (employeeScopeError) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "TIMESHEET_SCOPE_FETCH_FAILED",
            message: "Unable to verify department scope for this timesheet."
          },
          meta: buildMeta()
        });
      }

      if (!employeeRow?.id) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "You can only update timesheets for employees in your department."
          },
          meta: buildMeta()
        });
      }
    } else {
      const { data: employeeRow, error: employeeScopeError } = await supabase
        .from("profiles")
        .select("id")
        .eq("org_id", session.profile.org_id)
        .eq("id", currentTimesheet.employee_id)
        .eq("manager_id", session.profile.id)
        .is("deleted_at", null)
        .maybeSingle();

      if (employeeScopeError) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "TIMESHEET_SCOPE_FETCH_FAILED",
            message: "Unable to verify manager scope for this timesheet."
          },
          meta: buildMeta()
        });
      }

      if (!employeeRow?.id) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "You can only update timesheets for your direct reports."
          },
          meta: buildMeta()
        });
      }
    }
  }

  const nowIso = new Date().toISOString();
  const nextStatus = parsedBody.data.action === "approve" ? "approved" : "rejected";
  const nextRejectionReason =
    parsedBody.data.action === "reject" ? parsedBody.data.rejectionReason?.trim() ?? null : null;

  const { data: rawUpdatedTimesheet, error: updateError } = await supabase
    .from("timesheets")
    .update({
      status: nextStatus,
      approved_by: parsedBody.data.action === "approve" ? session.profile.id : null,
      approved_at: parsedBody.data.action === "approve" ? nowIso : null,
      rejection_reason: nextRejectionReason
    })
    .eq("id", currentTimesheet.id)
    .eq("org_id", session.profile.org_id)
    .select(
      "id, org_id, employee_id, week_start, week_end, total_regular_minutes, total_overtime_minutes, total_double_time_minutes, total_break_minutes, total_worked_minutes, status, submitted_at, approved_by, approved_at, rejection_reason, created_at, updated_at"
    )
    .single();

  if (updateError || !rawUpdatedTimesheet) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TIMESHEET_UPDATE_FAILED",
        message: "Unable to update timesheet status."
      },
      meta: buildMeta()
    });
  }

  const parsedUpdatedTimesheet = timesheetRowSchema.safeParse(rawUpdatedTimesheet);

  if (!parsedUpdatedTimesheet.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TIMESHEET_UPDATED_PARSE_FAILED",
        message: "Updated timesheet data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const [{ data: rawEmployeeRows, error: employeeError }, { data: rawApproverRows, error: approverError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, department, country_code")
        .eq("org_id", session.profile.org_id)
        .eq("id", parsedUpdatedTimesheet.data.employee_id)
        .is("deleted_at", null),
      parsedUpdatedTimesheet.data.approved_by
        ? supabase
            .from("profiles")
            .select("id, full_name")
            .eq("org_id", session.profile.org_id)
            .eq("id", parsedUpdatedTimesheet.data.approved_by)
            .is("deleted_at", null)
        : Promise.resolve({ data: [], error: null })
    ]);

  if (employeeError || approverError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TIMESHEET_ACTORS_FETCH_FAILED",
        message: "Unable to resolve employee metadata for the updated timesheet."
      },
      meta: buildMeta()
    });
  }

  const parsedEmployeeRows = z.array(profileRowSchema).safeParse(rawEmployeeRows ?? []);
  const parsedApproverRows = z.array(actorRowSchema).safeParse(rawApproverRows ?? []);

  if (!parsedEmployeeRows.success || !parsedApproverRows.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TIMESHEET_ACTORS_PARSE_FAILED",
        message: "Updated timesheet actor metadata is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const employee = parsedEmployeeRows.data[0];
  const approverNameById = new Map(parsedApproverRows.data.map((actor) => [actor.id, actor.full_name]));
  const updatedTimesheet = parsedUpdatedTimesheet.data;

  const timesheet: TimesheetRecord = {
    id: updatedTimesheet.id,
    orgId: updatedTimesheet.org_id,
    employeeId: updatedTimesheet.employee_id,
    employeeName: employee?.full_name ?? "Unknown user",
    employeeDepartment: employee?.department ?? null,
    employeeCountryCode: employee?.country_code ?? null,
    weekStart: updatedTimesheet.week_start,
    weekEnd: updatedTimesheet.week_end,
    totalRegularMinutes: parseInteger(updatedTimesheet.total_regular_minutes),
    totalOvertimeMinutes: parseInteger(updatedTimesheet.total_overtime_minutes),
    totalDoubleTimeMinutes: parseInteger(updatedTimesheet.total_double_time_minutes),
    totalBreakMinutes: parseInteger(updatedTimesheet.total_break_minutes),
    totalWorkedMinutes: parseInteger(updatedTimesheet.total_worked_minutes),
    status: updatedTimesheet.status,
    submittedAt: updatedTimesheet.submitted_at,
    approvedBy: updatedTimesheet.approved_by,
    approvedByName: updatedTimesheet.approved_by
      ? approverNameById.get(updatedTimesheet.approved_by) ?? null
      : null,
    approvedAt: updatedTimesheet.approved_at,
    rejectionReason: updatedTimesheet.rejection_reason,
    createdAt: updatedTimesheet.created_at,
    updatedAt: updatedTimesheet.updated_at
  };

  void logAudit({
    action: parsedBody.data.action === "approve" ? "approved" : "rejected",
    tableName: "timesheets",
    recordId: timesheet.id,
    oldValue: {
      status: currentTimesheet.status,
      approved_by: currentTimesheet.approved_by,
      approved_at: currentTimesheet.approved_at,
      rejection_reason: currentTimesheet.rejection_reason
    },
    newValue: {
      status: timesheet.status,
      approved_by: timesheet.approvedBy,
      approved_at: timesheet.approvedAt,
      rejection_reason: timesheet.rejectionReason
    }
  });

  return jsonResponse<TimeAttendanceApprovalMutationResponseData>(200, {
    data: { timesheet },
    error: null,
    meta: buildMeta()
  });
}
