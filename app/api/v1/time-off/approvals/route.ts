import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import type { UserRole } from "../../../../../lib/navigation";
import { hasRole } from "../../../../../lib/roles";
import { parseNumeric } from "../../../../../lib/time-off";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import {
  LEAVE_REQUEST_STATUSES,
  type LeaveRequestRecord,
  type TimeOffApprovalsResponseData
} from "../../../../../types/time-off";

const querySchema = z.object({
  status: z.enum(LEAVE_REQUEST_STATUSES).default("pending"),
  sortBy: z.enum(["start_date", "created_at"]).default("start_date"),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
  limit: z.coerce.number().int().min(1).max(200).default(200)
});

const requestRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  leave_type: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  total_days: z.union([z.number(), z.string()]),
  status: z.enum(LEAVE_REQUEST_STATUSES),
  reason: z.string(),
  approver_id: z.string().uuid().nullable(),
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

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function canApproveRequests(userRoles: readonly UserRole[]): boolean {
  return (
    hasRole(userRoles, "MANAGER") ||
    hasRole(userRoles, "HR_ADMIN") ||
    hasRole(userRoles, "SUPER_ADMIN")
  );
}

function canViewAllRequests(userRoles: readonly UserRole[]): boolean {
  return hasRole(userRoles, "HR_ADMIN") || hasRole(userRoles, "SUPER_ADMIN");
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view leave approvals."
      },
      meta: buildMeta()
    });
  }

  if (!canApproveRequests(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to review leave approvals."
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
        message: parsedQuery.error.issues[0]?.message ?? "Invalid approvals query parameters."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;
  const supabase = await createSupabaseServerClient();

  let reportIds: string[] = [];

  if (!canViewAllRequests(session.profile.roles)) {
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
          message: "Unable to load direct reports for approvals scope."
        },
        meta: buildMeta()
      });
    }

    reportIds = (reportRows ?? [])
      .map((row) => row.id)
      .filter((value): value is string => typeof value === "string");

    if (reportIds.length === 0) {
      return jsonResponse<TimeOffApprovalsResponseData>(200, {
        data: {
          requests: []
        },
        error: null,
        meta: buildMeta()
      });
    }
  }

  let requestsQuery = supabase
    .from("leave_requests")
    .select(
      "id, employee_id, leave_type, start_date, end_date, total_days, status, reason, approver_id, rejection_reason, created_at, updated_at"
    )
    .eq("org_id", session.profile.org_id)
    .eq("status", query.status)
    .is("deleted_at", null)
    .order(query.sortBy, { ascending: query.sortDir === "asc" })
    .limit(query.limit);

  if (reportIds.length > 0) {
    requestsQuery = requestsQuery.in("employee_id", reportIds);
  }

  const { data: rawRequests, error: requestsError } = await requestsQuery;

  if (requestsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "APPROVALS_FETCH_FAILED",
        message: "Unable to load leave approval requests."
      },
      meta: buildMeta()
    });
  }

  const parsedRequests = z.array(requestRowSchema).safeParse(rawRequests ?? []);

  if (!parsedRequests.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "APPROVALS_PARSE_FAILED",
        message: "Leave approvals data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  if (parsedRequests.data.length === 0) {
    return jsonResponse<TimeOffApprovalsResponseData>(200, {
      data: {
        requests: []
      },
      error: null,
      meta: buildMeta()
    });
  }

  const employeeIds = [
    ...new Set(parsedRequests.data.map((row) => row.employee_id))
  ];
  const approverIds = [
    ...new Set(
      parsedRequests.data
        .map((row) => row.approver_id)
        .filter((value): value is string => Boolean(value))
    )
  ];
  const actorIds = [...new Set([...employeeIds, ...approverIds])];

  const { data: rawProfiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, full_name, department, country_code")
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .in("id", actorIds);

  if (profilesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "APPROVALS_ACTORS_FETCH_FAILED",
        message: "Unable to resolve employee metadata for approvals."
      },
      meta: buildMeta()
    });
  }

  const parsedProfiles = z.array(profileRowSchema).safeParse(rawProfiles ?? []);

  if (!parsedProfiles.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "APPROVALS_ACTORS_PARSE_FAILED",
        message: "Approvals actor metadata is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const profileById = new Map(parsedProfiles.data.map((row) => [row.id, row]));

  const requests: LeaveRequestRecord[] = parsedRequests.data.map((row) => {
    const employee = profileById.get(row.employee_id);
    const approver = row.approver_id ? profileById.get(row.approver_id) : null;

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
      approverName: approver?.full_name ?? null,
      rejectionReason: row.rejection_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  });

  return jsonResponse<TimeOffApprovalsResponseData>(200, {
    data: {
      requests
    },
    error: null,
    meta: buildMeta()
  });
}
