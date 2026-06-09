import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { getEffectiveApproverScope } from "../../../../../lib/delegation";
import type { UserRole } from "../../../../../lib/navigation";
import { hasRole } from "../../../../../lib/roles";
import { parseNumeric } from "../../../../../lib/time-off";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
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
  acting_for: z.string().uuid().nullable(),
  delegate_type: z.string().nullable(),
  rejection_reason: z.string().nullable(),
  pending_change_type: z.enum(["cancel", "edit"]).nullable().optional(),
  pending_start_date: z.string().nullable().optional(),
  pending_end_date: z.string().nullable().optional(),
  pending_total_days: z.union([z.number(), z.string()]).nullable().optional(),
  change_reason: z.string().nullable().optional(),
  change_requested_by: z.string().uuid().nullable().optional(),
  change_requested_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string()
});

const APPROVALS_SELECT_COLUMNS =
  "id, employee_id, leave_type, start_date, end_date, total_days, status, reason, approver_id, acting_for, delegate_type, rejection_reason, pending_change_type, pending_start_date, pending_end_date, pending_total_days, change_reason, change_requested_by, change_requested_at, created_at, updated_at";

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

  // HR_ADMIN / SUPER_ADMIN can view all; MANAGER sees scoped results.
  // Non-managers may still see items via delegation (checked below).
  const isAdmin = canViewAllRequests(session.profile.roles);
  const isApprover = canApproveRequests(session.profile.roles);

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

  // Use the service-role client for data queries after authorisation is resolved.
  // RLS on leave_requests does not model delegation or team-lead access.
  const svcClient = createSupabaseServiceRoleClient();

  let reportIds: string[] = [];

  if (!isAdmin) {
    // Use delegation-aware scope: includes direct operational reports
    // (team_lead_id ?? manager_id) plus delegated reports when principal is away.
    const scope = await getEffectiveApproverScope({
      supabase,
      orgId: session.profile.org_id,
      userId: session.profile.id,
      scope: "leave"
    });

    reportIds = [...scope.directReportIds, ...scope.delegatedReportIds];

    // If not an approver-role user AND no delegated reports, deny access
    if (!isApprover && reportIds.length === 0) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "You are not allowed to review leave approvals."
        },
        meta: buildMeta()
      });
    }

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

  let requestsQuery = svcClient
    .from("leave_requests")
    .select(APPROVALS_SELECT_COLUMNS)
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

  // On the default (pending) approvals view, also surface already-approved leaves that have a
  // retrospective change awaiting a decision (cancel or move dates). These carry pendingChangeType
  // so the UI can render distinct "approve change / decline change" actions.
  let rawChangeRequests: unknown[] = [];
  if (query.status === "pending") {
    let changeQuery = svcClient
      .from("leave_requests")
      .select(APPROVALS_SELECT_COLUMNS)
      .eq("org_id", session.profile.org_id)
      .not("pending_change_type", "is", null)
      .is("deleted_at", null)
      .order("change_requested_at", { ascending: false })
      .limit(query.limit);

    if (reportIds.length > 0) {
      changeQuery = changeQuery.in("employee_id", reportIds);
    }

    const { data: changeRows } = await changeQuery;
    rawChangeRequests = changeRows ?? [];
  }

  const mergedRawById = new Map<string, unknown>();
  for (const row of [...(rawRequests ?? []), ...rawChangeRequests]) {
    const id = (row as { id?: unknown }).id;
    if (typeof id === "string") {
      mergedRawById.set(id, row);
    }
  }

  const parsedRequests = z.array(requestRowSchema).safeParse([...mergedRawById.values()]);

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

  // Collect all profile IDs we need to resolve (employees, approvers, acting_for principals)
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
  const actingForIds = [
    ...new Set(
      parsedRequests.data
        .map((row) => row.acting_for)
        .filter((value): value is string => Boolean(value))
    )
  ];
  const changeRequesterIds = [
    ...new Set(
      parsedRequests.data
        .map((row) => row.change_requested_by)
        .filter((value): value is string => Boolean(value))
    )
  ];
  const actorIds = [
    ...new Set([...employeeIds, ...approverIds, ...actingForIds, ...changeRequesterIds])
  ];

  const { data: rawProfiles, error: profilesError } = await svcClient
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
    const actingForProfile = row.acting_for ? profileById.get(row.acting_for) : null;

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
      actingFor: row.acting_for,
      actingForName: actingForProfile?.full_name ?? null,
      delegateType: row.delegate_type,
      pendingChangeType: row.pending_change_type ?? null,
      pendingStartDate: row.pending_start_date ?? null,
      pendingEndDate: row.pending_end_date ?? null,
      pendingTotalDays:
        row.pending_total_days === null || row.pending_total_days === undefined
          ? null
          : parseNumeric(row.pending_total_days),
      changeReason: row.change_reason ?? null,
      changeRequestedBy: row.change_requested_by ?? null,
      changeRequestedByName: row.change_requested_by
        ? profileById.get(row.change_requested_by)?.full_name ?? null
        : null,
      changeRequestedAt: row.change_requested_at ?? null,
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
