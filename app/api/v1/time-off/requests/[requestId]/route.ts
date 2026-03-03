import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { sendLeaveStatusEmail } from "../../../../../../lib/notifications/email";
import { createNotification } from "../../../../../../lib/notifications/service";
import type { UserRole } from "../../../../../../lib/navigation";
import { hasRole } from "../../../../../../lib/roles";
import { parseNumeric } from "../../../../../../lib/time-off";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../../types/auth";
import {
  LEAVE_REQUEST_STATUSES,
  type LeaveRequestRecord,
  type TimeOffRequestMutationResponseData
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
  approverName
}: {
  requestRow: z.infer<typeof leaveRequestRowSchema>;
  employeeRow: z.infer<typeof employeeProfileSchema>;
  approverName: string | null;
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

  const { data: requestRow, error: requestError } = await supabase
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

  const { data: employeeRow, error: employeeError } = await supabase
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
  const isManagerOfEmployee = employeeProfile.manager_id === session.profile.id;

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
    if (!(isOverrideUser || (isApproverUser && isManagerOfEmployee))) {
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

  const { data: updatedRequestRow, error: updateError } = await supabase
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

  const totalDays = parseNumeric(existingRequest.total_days);
  let usedDaysDelta = 0;
  let pendingDaysDelta = 0;

  if (existingRequest.status === "pending" && nextStatus === "approved") {
    pendingDaysDelta = totalDays * -1;
    usedDaysDelta = totalDays;
  } else if (
    existingRequest.status === "pending" &&
    (nextStatus === "rejected" || nextStatus === "cancelled")
  ) {
    pendingDaysDelta = totalDays * -1;
  }

  if (usedDaysDelta !== 0 || pendingDaysDelta !== 0) {
    try {
      await applyBalanceDeltas({
        orgId: session.profile.org_id,
        employeeId: existingRequest.employee_id,
        leaveType: existingRequest.leave_type,
        year: Number.parseInt(existingRequest.start_date.slice(0, 4), 10),
        usedDaysDelta,
        pendingDaysDelta
      });
    } catch (error) {
      const rollbackResponse = await supabase
        .from("leave_requests")
        .update({
          status: existingRequest.status,
          approver_id: existingRequest.approver_id,
          rejection_reason: existingRequest.rejection_reason
        })
        .eq("id", existingRequest.id)
        .eq("org_id", session.profile.org_id);

      if (rollbackResponse.error) {
        console.error("Unable to rollback leave request after balance update error.", {
          leaveRequestId: existingRequest.id,
          message: rollbackResponse.error.message
        });
      }

      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "BALANCE_UPDATE_FAILED",
          message: error instanceof Error ? error.message : "Unable to sync leave balances."
        },
        meta: buildMeta()
      });
    }
  }

  let approverName: string | null = null;

  if (parsedUpdatedRequest.data.approver_id) {
    const { data: approverRow } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", session.profile.org_id)
      .eq("id", parsedUpdatedRequest.data.approver_id)
      .is("deleted_at", null)
      .maybeSingle();

    const parsedApprover = approverProfileSchema.safeParse(approverRow);
    approverName = parsedApprover.success ? parsedApprover.data.full_name : "Unknown user";
  }

  const responseData: TimeOffRequestMutationResponseData = {
    request: toLeaveRequestRecord({
      requestRow: parsedUpdatedRequest.data,
      employeeRow: employeeProfile,
      approverName
    })
  };

  if (
    existingRequest.status === "pending" &&
    (nextStatus === "approved" || nextStatus === "rejected")
  ) {
    await createNotification({
      orgId: session.profile.org_id,
      userId: employeeProfile.id,
      type: "leave_status",
      title:
        nextStatus === "approved"
          ? "Leave request approved"
          : "Leave request rejected",
      body:
        nextStatus === "approved"
          ? `${existingRequest.leave_type} leave (${existingRequest.start_date} to ${existingRequest.end_date}) was approved.`
          : `${existingRequest.leave_type} leave (${existingRequest.start_date} to ${existingRequest.end_date}) was rejected.`,
      link: "/time-off"
    });

    await sendLeaveStatusEmail({
      orgId: session.profile.org_id,
      userId: employeeProfile.id,
      leaveType: existingRequest.leave_type,
      status: nextStatus,
      startDate: existingRequest.start_date,
      endDate: existingRequest.end_date,
      rejectionReason: nextStatus === "rejected" ? nextRejectionReason : null
    });
  }

  return jsonResponse<TimeOffRequestMutationResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
