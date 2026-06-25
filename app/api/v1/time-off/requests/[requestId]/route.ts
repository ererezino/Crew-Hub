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
import {
  calculateWorkingDays,
  formatLeaveTypeLabel,
  parseNumeric,
  spansMultipleCalendarYears
} from "../../../../../../lib/time-off";
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

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

const mutationSchema = z
  .object({
    action: z.enum([
      "approve",
      "reject",
      "cancel",
      "request_change",
      "approve_change",
      "reject_change"
    ]),
    rejectionReason: z.string().trim().max(2000).optional(),
    // request_change fields
    changeType: z.enum(["cancel", "edit"]).optional(),
    newStartDate: z.string().regex(isoDatePattern, "newStartDate must be YYYY-MM-DD.").optional(),
    newEndDate: z.string().regex(isoDatePattern, "newEndDate must be YYYY-MM-DD.").optional(),
    changeReason: z.string().trim().max(2000).optional()
  })
  .refine(
    (value) =>
      value.action !== "request_change" ||
      value.changeType === "cancel" ||
      (value.changeType === "edit" && Boolean(value.newStartDate) && Boolean(value.newEndDate)),
    {
      message: "A date change requires both a new start date and a new end date.",
      path: ["newStartDate"]
    }
  );

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

const SELECT_COLUMNS =
  "id, org_id, employee_id, leave_type, start_date, end_date, total_days, status, reason, approver_id, rejection_reason, pending_change_type, pending_start_date, pending_end_date, pending_total_days, change_reason, change_requested_by, change_requested_at, created_at, updated_at";

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
  actingForName,
  changeRequestedByName
}: {
  requestRow: z.infer<typeof leaveRequestRowSchema>;
  employeeRow: z.infer<typeof employeeProfileSchema>;
  approverName: string | null;
  actingForName?: string | null;
  changeRequestedByName?: string | null;
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
    pendingChangeType: requestRow.pending_change_type ?? null,
    pendingStartDate: requestRow.pending_start_date ?? null,
    pendingEndDate: requestRow.pending_end_date ?? null,
    pendingTotalDays:
      requestRow.pending_total_days === null || requestRow.pending_total_days === undefined
        ? null
        : parseNumeric(requestRow.pending_total_days),
    changeReason: requestRow.change_reason ?? null,
    changeRequestedBy: requestRow.change_requested_by ?? null,
    changeRequestedByName: changeRequestedByName ?? null,
    changeRequestedAt: requestRow.change_requested_at ?? null,
    createdAt: requestRow.created_at,
    updatedAt: requestRow.updated_at
  };
}

/** Working days for a date range, excluding weekends and the org's holidays for that country. */
async function workingDaysForRange({
  svcClient,
  orgId,
  countryCode,
  startDate,
  endDate
}: {
  svcClient: ReturnType<typeof createSupabaseServiceRoleClient>;
  orgId: string;
  countryCode: string | null;
  startDate: string;
  endDate: string;
}): Promise<number> {
  const { data: rawHolidays } = await svcClient
    .from("holiday_calendars")
    .select("date")
    .eq("org_id", orgId)
    .eq("country_code", countryCode ?? "NG")
    .gte("date", startDate)
    .lte("date", endDate)
    .is("deleted_at", null);

  const holidayKeys = new Set(
    (rawHolidays ?? [])
      .map((row) => (typeof row.date === "string" ? row.date : null))
      .filter((value): value is string => Boolean(value))
  );

  return calculateWorkingDays(startDate, endDate, holidayKeys);
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
    .select(SELECT_COLUMNS)
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

  // --- Retrospective change flow: cancel or move an already-approved leave (manager approval required) ---
  // Employees request the change; a manager (or HR) approves it. Until approval, the leave stays
  // approved and the person stays "on leave" on the schedule — exactly what we want for accuracy.
  if (
    parsedBody.data.action === "request_change" ||
    parsedBody.data.action === "approve_change" ||
    parsedBody.data.action === "reject_change"
  ) {
    const err = (status: number, code: string, message: string) =>
      jsonResponse<null>(status, { data: null, error: { code, message }, meta: buildMeta() });

    // Capture the narrowed org id so the nested finalize() closure keeps the non-null narrowing.
    const actorOrgId = session.profile.org_id;

    const leaveLabel = formatLeaveTypeLabel(existingRequest.leave_type);
    const dateLabel = formatDateRangeHuman(existingRequest.start_date, existingRequest.end_date);

    const finalize = async (updatedRow: unknown) => {
      const parsed = leaveRequestRowSchema.safeParse(updatedRow);
      if (!parsed.success) {
        return err(500, "REQUEST_PARSE_FAILED", "Updated leave request data is not in the expected shape.");
      }

      const ids = [parsed.data.approver_id, parsed.data.change_requested_by].filter(
        (value): value is string => Boolean(value)
      );
      let approverName: string | null = null;
      let changeRequestedByName: string | null = null;

      if (ids.length > 0) {
        const { data: nameRows } = await svcClient
          .from("profiles")
          .select("id, full_name")
          .eq("org_id", actorOrgId)
          .is("deleted_at", null)
          .in("id", ids);
        const nameMap = new Map(
          (nameRows ?? [])
            .map((row) => {
              const parsedName = approverProfileSchema.safeParse(row);
              return parsedName.success ? ([parsedName.data.id, parsedName.data.full_name] as const) : null;
            })
            .filter((entry): entry is readonly [string, string] => entry !== null)
        );
        approverName = parsed.data.approver_id ? nameMap.get(parsed.data.approver_id) ?? null : null;
        changeRequestedByName = parsed.data.change_requested_by
          ? nameMap.get(parsed.data.change_requested_by) ?? null
          : null;
      }

      return jsonResponse<TimeOffRequestMutationResponseData>(200, {
        data: {
          request: toLeaveRequestRecord({
            requestRow: parsed.data,
            employeeRow: employeeProfile,
            approverName,
            changeRequestedByName
          })
        },
        error: null,
        meta: buildMeta()
      });
    };

    // 1) Employee (or HR) stages a change on an approved leave.
    if (parsedBody.data.action === "request_change") {
      if (!(isEmployeeOwner || isOverrideUser)) {
        return err(403, "FORBIDDEN", "You are not allowed to request a change to this leave request.");
      }
      if (existingRequest.status !== "approved") {
        return err(
          422,
          "INVALID_STATUS",
          "Only approved leave can be changed retrospectively. A pending request can be cancelled directly."
        );
      }
      if (existingRequest.pending_change_type) {
        return err(422, "INVALID_STATUS", "A change is already awaiting approval for this leave request.");
      }

      const changeType = parsedBody.data.changeType;
      let pendingStartDate: string | null = null;
      let pendingEndDate: string | null = null;
      let pendingTotalDays: number | null = null;

      if (changeType === "edit") {
        const newStart = parsedBody.data.newStartDate as string;
        const newEnd = parsedBody.data.newEndDate as string;

        if (newEnd < newStart) {
          return err(422, "VALIDATION_ERROR", "The new end date cannot be before the new start date.");
        }
        if (spansMultipleCalendarYears(newStart, newEnd)) {
          return err(
            422,
            "VALIDATION_ERROR",
            "The new dates span multiple calendar years. Please request separate leaves for each year."
          );
        }

        pendingStartDate = newStart;
        pendingEndDate = newEnd;
        pendingTotalDays = await workingDaysForRange({
          svcClient,
          orgId: session.profile.org_id,
          countryCode: employeeProfile.country_code,
          startDate: newStart,
          endDate: newEnd
        });

        if (pendingTotalDays <= 0) {
          return err(
            422,
            "VALIDATION_ERROR",
            "The new dates contain no working days after excluding weekends and holidays."
          );
        }
      }

      // P1-5: stage the change as a CONDITIONAL transition. The update only
      // applies while the request is still approved AND has no pending change,
      // so two concurrent stage requests cannot both pass the earlier read and
      // overwrite each other — the loser gets a 409.
      const { data: updatedRow, error: updateErr } = await svcClient
        .from("leave_requests")
        .update({
          pending_change_type: changeType,
          pending_start_date: pendingStartDate,
          pending_end_date: pendingEndDate,
          pending_total_days: pendingTotalDays,
          change_reason: parsedBody.data.changeReason?.trim() || null,
          change_requested_by: session.profile.id,
          change_requested_at: new Date().toISOString()
        })
        .eq("id", existingRequest.id)
        .eq("org_id", session.profile.org_id)
        .eq("status", "approved")
        .is("pending_change_type", null)
        .select(SELECT_COLUMNS)
        .maybeSingle();

      if (updateErr) {
        return err(500, "REQUEST_UPDATE_FAILED", "Unable to record the change request.");
      }

      if (!updatedRow) {
        return err(409, "CHANGE_CONFLICT", "A change was already submitted for this leave. Please refresh.");
      }

      // Notify whoever decides: the original approver, else the employee's manager.
      const notifyTargetId = existingRequest.approver_id ?? employeeProfile.manager_id;
      if (notifyTargetId) {
        const actionLabel =
          changeType === "cancel"
            ? `cancel their ${leaveLabel}`
            : `move their ${leaveLabel} to ${formatDateRangeHuman(pendingStartDate as string, pendingEndDate as string)}`;
        await createNotification({
          orgId: session.profile.org_id,
          userId: notifyTargetId,
          type: "leave_status",
          title: `${leaveLabel} change request`,
          body: `${employeeProfile.full_name} requested to ${actionLabel} (originally ${dateLabel}). It needs your approval.`,
          link: "/time-off/approvals"
        }).catch(() => undefined);
      }

      await logAudit({
        action: "updated",
        tableName: "leave_requests",
        recordId: existingRequest.id,
        oldValue: { pending_change_type: existingRequest.pending_change_type ?? null },
        newValue: { pending_change_type: changeType, pending_start_date: pendingStartDate, pending_end_date: pendingEndDate }
      }).catch(() => undefined);

      return finalize(updatedRow);
    }

    // 2) Manager approves or rejects the staged change.
    if (isEmployeeOwner) {
      return err(403, "FORBIDDEN", "You cannot decide on a change to your own leave request.");
    }
    if (!(isOverrideUser || isOperationalLeadOrDelegate)) {
      return err(403, "FORBIDDEN", "You are not allowed to decide on this change request.");
    }
    if (!existingRequest.pending_change_type) {
      return err(422, "INVALID_STATUS", "There is no pending change to act on for this leave request.");
    }

    // LEAVE-01: apply the change decision atomically. decide_leave_change locks
    // the request row, re-verifies the expected state (status approved AND a
    // pending change still present), applies the status/date change, clears the
    // pending change, and adjusts the balance — all in one transaction. A
    // competing decision that already consumed the pending change returns
    // STALE_CHANGE → 409 instead of double-applying the balance delta.
    const decision = parsedBody.data.action === "approve_change" ? "approve" : "reject";
    const changeType = existingRequest.pending_change_type;

    const { data: changeRpcResult, error: changeRpcError } = await svcClient.rpc("decide_leave_change", {
      p_request_id: existingRequest.id,
      p_org_id: session.profile.org_id,
      p_decision: decision,
      p_actor_id: session.profile.id
    });

    if (changeRpcError) {
      return err(500, "REQUEST_UPDATE_FAILED", humanizeError(changeRpcError.message));
    }

    const changeRpcData = changeRpcResult as Record<string, unknown> | null;
    if (changeRpcData && typeof changeRpcData === "object" && typeof changeRpcData.error === "string") {
      if (changeRpcData.error === "STALE_CHANGE") {
        return err(409, "CHANGE_CONFLICT", "This change was already decided. Please refresh.");
      }
      if (changeRpcData.error === "NOT_FOUND") {
        return err(404, "NOT_FOUND", "Leave request not found.");
      }
      return err(422, "INVALID_STATUS", String(changeRpcData.error));
    }

    // Note: the audit row for the change decision is written transactionally
    // inside decide_leave_change (using the actor id), so the route only sends
    // the user-facing notification here.
    if (decision === "reject") {
      await createNotification({
        orgId: session.profile.org_id,
        userId: employeeProfile.id,
        type: "leave_status",
        title: `${leaveLabel} change declined`,
        body: `Your request to change your ${leaveLabel} (${dateLabel}) was declined by ${session.profile.full_name}.`,
        link: "/time-off"
      }).catch(() => undefined);

      return finalize(changeRpcData);
    }

    const resultLabel =
      changeType === "cancel"
        ? `Your ${leaveLabel} (${dateLabel}) was cancelled as requested, approved by ${session.profile.full_name}.`
        : `Your ${leaveLabel} was moved to ${formatDateRangeHuman(
            existingRequest.pending_start_date as string,
            existingRequest.pending_end_date as string
          )}, approved by ${session.profile.full_name}.`;

    await createNotification({
      orgId: session.profile.org_id,
      userId: employeeProfile.id,
      type: "leave_status",
      title: changeType === "cancel" ? `${leaveLabel} cancelled` : `${leaveLabel} dates updated`,
      body: resultLabel,
      link: "/time-off"
    }).catch(() => undefined);

    return finalize(changeRpcData);
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
      if (spansMultipleCalendarYears(existingRequest.start_date, existingRequest.end_date)) {
        return jsonResponse<null>(422, {
          data: null,
          error: {
            code: "CROSS_YEAR_REQUEST_NOT_SUPPORTED",
            message: "This leave request spans multiple calendar years and cannot be approved. Please ask the employee to submit separate requests for each year."
          },
          meta: buildMeta()
        });
      }

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

  // Cancel path. LEAVE-01: make it a CONDITIONAL transition — the update only
  // applies if the row is still in the status we read (expected-state guard), so
  // a competing decision that already moved it can't be silently overwritten.
  const { data: updatedRequestRow, error: updateError } = await svcClient
    .from("leave_requests")
    .update({
      status: nextStatus,
      approver_id: nextApproverId,
      rejection_reason: nextRejectionReason
    })
    .eq("id", existingRequest.id)
    .eq("org_id", session.profile.org_id)
    .eq("status", existingRequest.status)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (updateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "REQUEST_UPDATE_FAILED",
        message: "Unable to update leave request."
      },
      meta: buildMeta()
    });
  }

  if (!updatedRequestRow) {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "REQUEST_CONFLICT",
        message: "This leave request was already updated. Please refresh."
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
