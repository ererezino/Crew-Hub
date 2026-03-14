import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import { formatDateRangeHuman } from "../../../../../../lib/datetime";
import {
  getEffectiveApproverScope,
  resolveDelegationContext
} from "../../../../../../lib/delegation";
import { sendLeaveCancelledEmail, sendLeaveStatusEmail } from "../../../../../../lib/notifications/email";
import { createNotification } from "../../../../../../lib/notifications/service";
import type { UserRole } from "../../../../../../lib/navigation";
import { hasRole } from "../../../../../../lib/roles";
import { formatLeaveTypeLabel, parseNumeric } from "../../../../../../lib/time-off";
import { humanizeError } from "../../../../../../lib/errors";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../../types/auth";
import {
  LEAVE_REQUEST_STATUSES,
  type LeaveRequestRecord,
  type TimeOffRequestMutationResponseData,
  UNLIMITED_LEAVE_TYPES
} from "../../../../../../types/time-off";

const paramsSchema = z.object({
  requestId: z.string().uuid()
});

const mutationSchema = z.object({
  action: z.enum(["approve", "reject", "cancel"]),
  rejectionReason: z.string().trim().max(2000).optional()
});

const leaveRequestRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  leave_type: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  total_days: z.union([z.number(), z.string()]),
  status: z.enum(LEAVE_REQUEST_STATUSES),
  reason: z.string(),
  approver_id: z.string().uuid().nullable(),
  acting_for: z.string().uuid().nullable().optional(),
  delegate_type: z.string().nullable().optional(),
  rejection_reason: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const employeeProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  full_name: z.string(),
  department: z.string().nullable(),
  country_code: z.string().nullable(),
  manager_id: z.string().uuid().nullable()
});

const approverProfileSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string()
});

const leaveBalanceRowSchema = z.object({
  id: z.string().uuid(),
  total_days: z.union([z.number(), z.string()]),
  used_days: z.union([z.number(), z.string()]),
  pending_days: z.union([z.number(), z.string()]),
  carried_days: z.union([z.number(), z.string()])
});

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function canOverrideRequests(userRoles: readonly UserRole[]): boolean {
  return hasRole(userRoles, "HR_ADMIN") || hasRole(userRoles, "SUPER_ADMIN");
}

function canApproveRequests(userRoles: readonly UserRole[]): boolean {
  return hasRole(userRoles, "MANAGER") || canOverrideRequests(userRoles);
}

async function applyBalanceDeltas({
  orgId,
  employeeId,
  leaveType,
  year,
  usedDaysDelta,
  pendingDaysDelta
}: {
  orgId: string;
  employeeId: string;
  leaveType: string;
  year: number;
  usedDaysDelta: number;
  pendingDaysDelta: number;
}): Promise<void> {
  const serviceClient = createSupabaseServiceRoleClient();

  const { data: rawBalance, error: balanceFetchError } = await serviceClient
    .from("leave_balances")
    .select("id, total_days, used_days, pending_days, carried_days")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .eq("leave_type", leaveType)
    .eq("year", year)
    .is("deleted_at", null)
    .maybeSingle();

  if (balanceFetchError) {
    throw new Error(`Unable to load leave balance: ${balanceFetchError.message}`);
  }

  if (!rawBalance) {
    const { error: insertError } = await serviceClient.from("leave_balances").insert({
      org_id: orgId,
      employee_id: employeeId,
      leave_type: leaveType,
      year,
      total_days: 0,
      used_days: Math.max(0, usedDaysDelta),
      pending_days: Math.max(0, pendingDaysDelta),
      carried_days: 0
    });

    if (insertError) {
      throw new Error(`Unable to create leave balance: ${insertError.message}`);
    }

    return;
  }

  const parsedBalance = leaveBalanceRowSchema.safeParse(rawBalance);

  if (!parsedBalance.success) {
    throw new Error("Leave balance data is not in the expected shape.");
  }

  const currentUsedDays = parseNumeric(parsedBalance.data.used_days);
  const currentPendingDays = parseNumeric(parsedBalance.data.pending_days);

  const nextUsedDays = Math.max(0, currentUsedDays + usedDaysDelta);
  const nextPendingDays = Math.max(0, currentPendingDays + pendingDaysDelta);

  const { error: updateError } = await serviceClient
    .from("leave_balances")
    .update({
      used_days: nextUsedDays,
      pending_days: nextPendingDays
    })
    .eq("id", parsedBalance.data.id)
    .eq("org_id", orgId);

  if (updateError) {
    throw new Error(`Unable to update leave balance: ${updateError.message}`);
  }
}

function toLeaveRequestRecord({
  requestRow,
  employeeRow,
  approverName,
  actingForName
}: {
  requestRow: z.infer<typeof leaveRequestRowSchema>;
  employeeRow: z.infer<typeof employeeProfileSchema>;
  approverName: string | null;
  actingForName?: string | null;
}): LeaveRequestRecord {
  return {
    id: requestRow.id,
    employeeId: requestRow.employee_id,
    employeeName: employeeRow.full_name,
    employeeDepartment: employeeRow.department,
    employeeCountryCode: employeeRow.country_code,
    leaveType: requestRow.leave_type,
    startDate: requestRow.start_date,
    endDate: requestRow.end_date,
    totalDays: parseNumeric(requestRow.total_days),
    status: requestRow.status,
    reason: requestRow.reason,
    approverId: requestRow.approver_id,
    approverName,
    rejectionReason: requestRow.rejection_reason,
    actingFor: requestRow.acting_for ?? null,
    actingForName: actingForName ?? null,
    delegateType: requestRow.delegate_type ?? null,
    createdAt: requestRow.created_at,
    updatedAt: requestRow.updated_at
  };
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to update leave requests."
      },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Leave request id must be a valid UUID."
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

  const parsedBody = mutationSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid leave request mutation payload."
      },
      meta: buildMeta()
    });
  }

  if (
    parsedBody.data.action === "reject" &&
    !parsedBody.data.rejectionReason?.trim()
  ) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Rejection reason is required when rejecting a leave request."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const svcClient = createSupabaseServiceRoleClient();

  const { data: requestRow, error: requestError } = await svcClient
    .from("leave_requests")
    .select(
      "id, org_id, employee_id, leave_type, start_date, end_date, total_days, status, reason, approver_id, rejection_reason, created_at, updated_at"
    )
    .eq("id", parsedParams.data.requestId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (requestError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "REQUEST_FETCH_FAILED",
        message: "Unable to load leave request."
      },
      meta: buildMeta()
    });
  }

  const parsedRequest = leaveRequestRowSchema.safeParse(requestRow);

  if (!parsedRequest.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Leave request not found."
      },
      meta: buildMeta()
    });
  }

  const existingRequest = parsedRequest.data;

  const { data: employeeRow, error: employeeError } = await svcClient
    .from("profiles")
    .select("id, email, full_name, department, country_code, manager_id")
    .eq("id", existingRequest.employee_id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .single();

  if (employeeError || !employeeRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EMPLOYEE_FETCH_FAILED",
        message: "Unable to resolve employee profile for leave request."
      },
      meta: buildMeta()
    });
  }

  const parsedEmployee = employeeProfileSchema.safeParse(employeeRow);

  if (!parsedEmployee.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EMPLOYEE_PARSE_FAILED",
        message: "Employee profile data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const employeeProfile = parsedEmployee.data;
  const isOverrideUser = canOverrideRequests(session.profile.roles);
  const isApproverUser = canApproveRequests(session.profile.roles);
  const isEmployeeOwner = existingRequest.employee_id === session.profile.id;

  // Delegation-aware authorization: check if this user is the operational lead
  // (team_lead_id ?? manager_id) or an active delegate for the employee's lead.
  let delegationCtx = { actingFor: null as string | null, delegateType: null as string | null };
  let isOperationalLeadOrDelegate = false;

  if (!isOverrideUser && !isEmployeeOwner) {
    const scope = await getEffectiveApproverScope({
      supabase,
      orgId: session.profile.org_id,
      userId: session.profile.id,
      scope: "leave"
    });

    const allReportIds = [...scope.directReportIds, ...scope.delegatedReportIds];
    isOperationalLeadOrDelegate = allReportIds.includes(existingRequest.employee_id);

    if (isOperationalLeadOrDelegate) {
      delegationCtx = resolveDelegationContext(existingRequest.employee_id, scope);
    }
  }

  let nextStatus = existingRequest.status;
  let nextApproverId = existingRequest.approver_id;
  let nextRejectionReason = existingRequest.rejection_reason;

  if (parsedBody.data.action === "cancel") {
    if (!(isEmployeeOwner || isOverrideUser)) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "You are not allowed to cancel this leave request."
        },
        meta: buildMeta()
      });
    }

    if (existingRequest.status !== "pending") {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "INVALID_STATUS",
          message: "Only pending leave requests can be cancelled."
        },
        meta: buildMeta()
      });
    }

    nextStatus = "cancelled";
    nextApproverId = isOverrideUser && !isEmployeeOwner ? session.profile.id : existingRequest.approver_id;
    nextRejectionReason = null;
  } else if (parsedBody.data.action === "approve" || parsedBody.data.action === "reject") {
    if (isEmployeeOwner) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "You cannot approve your own leave request. It must be approved by your manager or HR."
        },
        meta: buildMeta()
      });
    }

    if (!(isOverrideUser || (isApproverUser && isOperationalLeadOrDelegate) || isOperationalLeadOrDelegate)) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "You are not allowed to approve or reject this leave request."
        },
        meta: buildMeta()
      });
    }

    if (existingRequest.status !== "pending") {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "INVALID_STATUS",
          message: "Only pending leave requests can be approved or rejected."
        },
        meta: buildMeta()
      });
    }

    if (parsedBody.data.action === "approve") {
      nextStatus = "approved";
      nextRejectionReason = null;
    } else {
      nextStatus = "rejected";
      nextRejectionReason = parsedBody.data.rejectionReason?.trim() ?? null;
    }

    nextApproverId = session.profile.id;
  }

  // Use atomic RPC functions for approve/reject to ensure all-or-nothing transactions.
  // Cancel still uses the multi-step approach since it's simpler (no balance updates on cancel for approved requests).
  if (parsedBody.data.action === "approve" || parsedBody.data.action === "reject") {
    const serviceClient = createSupabaseServiceRoleClient();
    const rpcName = parsedBody.data.action === "approve" ? "approve_leave_request" : "reject_leave_request";
    const rpcParams =
      parsedBody.data.action === "approve"
        ? {
            p_request_id: existingRequest.id,
            p_approver_id: session.profile.id,
            p_acting_for: delegationCtx.actingFor,
            p_delegate_type: delegationCtx.delegateType
          }
        : {
            p_request_id: existingRequest.id,
            p_approver_id: session.profile.id,
            p_reason: nextRejectionReason ?? "",
            p_acting_for: delegationCtx.actingFor,
            p_delegate_type: delegationCtx.delegateType
          };

    const { data: rpcResult, error: rpcError } = await serviceClient.rpc(rpcName, rpcParams);

    if (rpcError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REQUEST_UPDATE_FAILED",
          message: humanizeError(rpcError.message)
        },
        meta: buildMeta()
      });
    }

    const rpcData = rpcResult as Record<string, unknown> | null;

    if (rpcData && typeof rpcData === "object" && "error" in rpcData) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "INVALID_STATUS",
          message: String(rpcData.error)
        },
        meta: buildMeta()
      });
    }

    const parsedUpdatedRequest = leaveRequestRowSchema.safeParse(rpcData);

    if (!parsedUpdatedRequest.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REQUEST_PARSE_FAILED",
          message: "Updated leave request data is not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    let approverName: string | null = null;
    let actingForName: string | null = null;

    // Resolve approver and acting_for profile names for the response
    const profileIdsToResolve = [
      parsedUpdatedRequest.data.approver_id,
      parsedUpdatedRequest.data.acting_for
    ].filter((id): id is string => Boolean(id));

    if (profileIdsToResolve.length > 0) {
      const { data: resolvedProfiles } = await svcClient
        .from("profiles")
        .select("id, full_name")
        .eq("org_id", session.profile.org_id)
        .is("deleted_at", null)
        .in("id", profileIdsToResolve);

      const profileMap = new Map(
        (resolvedProfiles ?? [])
          .map((p) => {
            const parsed = approverProfileSchema.safeParse(p);
            return parsed.success ? [parsed.data.id, parsed.data.full_name] as const : null;
          })
          .filter((entry): entry is readonly [string, string] => entry !== null)
      );

      approverName = parsedUpdatedRequest.data.approver_id
        ? profileMap.get(parsedUpdatedRequest.data.approver_id) ?? "Unknown user"
        : null;

      actingForName = parsedUpdatedRequest.data.acting_for
        ? profileMap.get(parsedUpdatedRequest.data.acting_for) ?? null
        : null;
    }

    const responseData: TimeOffRequestMutationResponseData = {
      request: toLeaveRequestRecord({
        requestRow: parsedUpdatedRequest.data,
        employeeRow: employeeProfile,
        approverName,
        actingForName
      })
    };

    const leaveLabel = formatLeaveTypeLabel(existingRequest.leave_type);
    const dateLabel = formatDateRangeHuman(existingRequest.start_date, existingRequest.end_date);

    const approverDisplayName = session.profile.full_name;
    const delegationSuffix = delegationCtx.actingFor
      ? ` (covering for a team lead who is away)`
      : "";

    await createNotification({
      orgId: session.profile.org_id,
      userId: employeeProfile.id,
      type: "leave_status",
      title:
        nextStatus === "approved"
          ? `${leaveLabel} request approved`
          : `${leaveLabel} request rejected`,
      body:
        nextStatus === "approved"
          ? `Your ${leaveLabel} request (${dateLabel}) was approved by ${approverDisplayName}${delegationSuffix}.`
          : `Your ${leaveLabel} request (${dateLabel}) was rejected by ${approverDisplayName}${delegationSuffix}.`,
      link: "/time-off"
    });

    const emailStatus = parsedBody.data.action === "approve" ? "approved" as const : "rejected" as const;

    await sendLeaveStatusEmail({
      orgId: session.profile.org_id,
      userId: employeeProfile.id,
      leaveType: existingRequest.leave_type,
      status: emailStatus,
      startDate: existingRequest.start_date,
      endDate: existingRequest.end_date,
      rejectionReason: emailStatus === "rejected" ? nextRejectionReason : null
    });

    await logAudit({
      action: nextStatus === "approved" ? "approved" : "rejected",
      tableName: "leave_requests",
      recordId: existingRequest.id,
      oldValue: { status: existingRequest.status },
      newValue: {
        status: nextStatus,
        leaveType: existingRequest.leave_type,
        employeeId: existingRequest.employee_id,
        rejectionReason: nextRejectionReason
      }
    }).catch(() => undefined);

    return jsonResponse<TimeOffRequestMutationResponseData>(200, {
      data: responseData,
      error: null,
      meta: buildMeta()
    });
  }

  // Cancel path: standard multi-step (no balance atomicity needed for cancels)
  const { data: updatedRequestRow, error: updateError } = await svcClient
    .from("leave_requests")
    .update({
      status: nextStatus,
      approver_id: nextApproverId,
      rejection_reason: nextRejectionReason
    })
    .eq("id", existingRequest.id)
    .eq("org_id", session.profile.org_id)
    .select(
      "id, org_id, employee_id, leave_type, start_date, end_date, total_days, status, reason, approver_id, rejection_reason, created_at, updated_at"
    )
    .single();

  if (updateError || !updatedRequestRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "REQUEST_UPDATE_FAILED",
        message: "Unable to update leave request."
      },
      meta: buildMeta()
    });
  }

  const parsedUpdatedRequest = leaveRequestRowSchema.safeParse(updatedRequestRow);

  if (!parsedUpdatedRequest.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "REQUEST_PARSE_FAILED",
        message: "Updated leave request data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  // Handle pending_days reduction for cancellations
  const totalDays = parseNumeric(existingRequest.total_days);
  const isUnlimitedType = UNLIMITED_LEAVE_TYPES.has(existingRequest.leave_type);

  if (!isUnlimitedType && totalDays > 0 && existingRequest.status === "pending" && nextStatus === "cancelled") {
    try {
      await applyBalanceDeltas({
        orgId: session.profile.org_id,
        employeeId: existingRequest.employee_id,
        leaveType: existingRequest.leave_type,
        year: Number.parseInt(existingRequest.start_date.slice(0, 4), 10),
        usedDaysDelta: 0,
        pendingDaysDelta: totalDays * -1
      });
    } catch {
      // Balance delta for cancel is best-effort — the request is already cancelled
    }
  }

  let approverName: string | null = null;

  if (parsedUpdatedRequest.data.approver_id) {
    const { data: approverRow } = await svcClient
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", session.profile.org_id)
      .eq("id", parsedUpdatedRequest.data.approver_id)
      .is("deleted_at", null)
      .maybeSingle();

    const parsedApprover = approverProfileSchema.safeParse(approverRow);
    approverName = parsedApprover.success ? parsedApprover.data.full_name : "Unknown user";
  }

  await logAudit({
    action: "cancelled",
    tableName: "leave_requests",
    recordId: existingRequest.id,
    oldValue: { status: existingRequest.status },
    newValue: {
      status: nextStatus,
      leaveType: existingRequest.leave_type,
      employeeId: existingRequest.employee_id
    }
  }).catch(() => undefined);

  // Fire-and-forget email notification to manager on cancellation
  if (employeeProfile.manager_id) {
    sendLeaveCancelledEmail({
      orgId: session.profile.org_id,
      managerId: employeeProfile.manager_id,
      employeeName: employeeProfile.full_name,
      leaveType: existingRequest.leave_type,
      startDate: existingRequest.start_date,
      endDate: existingRequest.end_date
    }).catch(err => console.error('Email send failed:', err));
  }

  const responseData: TimeOffRequestMutationResponseData = {
    request: toLeaveRequestRecord({
      requestRow: parsedUpdatedRequest.data,
      employeeRow: employeeProfile,
      approverName,
      actingForName: null
    })
  };

  return jsonResponse<TimeOffRequestMutationResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
