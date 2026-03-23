import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { logAudit } from "../../../../../lib/audit";
import { formatDateRangeHuman } from "../../../../../lib/datetime";
import { logger } from "../../../../../lib/logger";
import { createBulkNotifications } from "../../../../../lib/notifications/service";
import {
  applyPendingBalanceDelta,
  fetchLeaveBalanceAvailability
} from "../../../../../lib/time-off/balances";
import {
  calculateBusinessDaysNotice,
  calculateWorkingDays,
  differenceInCalendarDays,
  formatLeaveTypeLabel,
  isIsoDate,
  isSickLeaveType,
  parseNumeric,
  spansMultipleCalendarYears
} from "../../../../../lib/time-off";
import { sendLeaveRequestedEmail } from "../../../../../lib/notifications/email";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import {
  AUTO_GRANTED_LEAVE_TYPES,
  LEAVE_REQUEST_STATUSES,
  type LeaveRequestRecord,
  type TimeOffRequestMutationResponseData,
  UNLIMITED_LEAVE_TYPES
} from "../../../../../types/time-off";

const createLeaveRequestSchema = z.object({
  leaveType: z.string().trim().min(1, "Leave type is required").max(50, "Leave type is too long"),
  startDate: z
    .string()
    .refine((value) => isIsoDate(value), "Start date must be in YYYY-MM-DD format"),
  endDate: z
    .string()
    .refine((value) => isIsoDate(value), "End date must be in YYYY-MM-DD format"),
  reason: z.string().trim().min(1, "Reason is required").max(2000, "Reason is too long"),
  medicalEvidencePath: z.string().trim().max(500).optional()
});

const profileRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  email: z.string().email(),
  full_name: z.string(),
  department: z.string().nullable(),
  country_code: z.string().nullable(),
  manager_id: z.string().uuid().nullable(),
  status: z.string().nullable()
});

const policyRowSchema = z.object({
  id: z.string().uuid(),
  country_code: z.string().nullable(),
  default_days_per_year: z.union([z.number(), z.string()]),
  is_unlimited: z.boolean()
});

const holidayRowSchema = z.object({
  date: z.string()
});

const leaveRequestRowSchema = z.object({
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

const ROUTINE_NOTICE_BUSINESS_DAYS = 5;
const EXTENDED_LEAVE_MIN_WORKING_DAYS = 10;
const EXTENDED_LEAVE_NOTICE_CALENDAR_DAYS = 28;

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function toRequestRecord(
  requestRow: z.infer<typeof leaveRequestRowSchema>,
  employeeProfile: z.infer<typeof profileRowSchema>
): LeaveRequestRecord {
  return {
    id: requestRow.id,
    employeeId: requestRow.employee_id,
    employeeName: employeeProfile.full_name,
    employeeDepartment: employeeProfile.department,
    employeeCountryCode: employeeProfile.country_code,
    leaveType: requestRow.leave_type,
    startDate: requestRow.start_date,
    endDate: requestRow.end_date,
    totalDays: parseNumeric(requestRow.total_days),
    status: requestRow.status,
    reason: requestRow.reason,
    approverId: requestRow.approver_id,
    approverName: null,
    rejectionReason: requestRow.rejection_reason,
    actingFor: null,
    actingForName: null,
    delegateType: null,
    createdAt: requestRow.created_at,
    updatedAt: requestRow.updated_at
  };
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to request time off."
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

  const parsedBody = createLeaveRequestSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid leave request payload."
      },
      meta: buildMeta()
    });
  }

  if (parsedBody.data.endDate < parsedBody.data.startDate) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "End date must be on or after start date."
      },
      meta: buildMeta()
    });
  }

  if (spansMultipleCalendarYears(parsedBody.data.startDate, parsedBody.data.endDate)) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "CROSS_YEAR_REQUEST_NOT_SUPPORTED",
        message: "Time off cannot span multiple calendar years. Please submit separate requests for each year."
      },
      meta: buildMeta()
    });
  }

  const requestDate = todayIso();

  if (parsedBody.data.startDate < requestDate) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "PAST_DATE_NOT_ALLOWED",
        message: "Time off requests must start today or later."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("id, org_id, email, full_name, department, country_code, manager_id, status")
    .eq("id", session.profile.id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .single();

  if (profileError || !profileRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_FETCH_FAILED",
        message: "Unable to resolve employee profile for leave request."
      },
      meta: buildMeta()
    });
  }

  const parsedProfile = profileRowSchema.safeParse(profileRow);

  if (!parsedProfile.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_PARSE_FAILED",
        message: "Employee profile data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const employeeProfile = parsedProfile.data;

  // Block auto-granted leave types from manual requests
  if (AUTO_GRANTED_LEAVE_TYPES.has(parsedBody.data.leaveType)) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: `${formatLeaveTypeLabel(parsedBody.data.leaveType)} is automatically granted and cannot be manually requested.`
      },
      meta: buildMeta()
    });
  }

  // Onboarding restriction: only unpaid personal days allowed
  if (
    employeeProfile.status === "onboarding" &&
    parsedBody.data.leaveType !== "unpaid_personal_day"
  ) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "ONBOARDING_RESTRICTION",
        message: "During your onboarding period, only unpaid personal days can be requested. Once onboarding is complete, all leave types become available."
      },
      meta: buildMeta()
    });
  }

  const policiesQuery = supabase
    .from("leave_policies")
    .select("id, default_days_per_year, country_code, is_unlimited")
    .eq("org_id", employeeProfile.org_id)
    .eq("leave_type", parsedBody.data.leaveType)
    .is("deleted_at", null)
    .limit(5);

  // Leave policies are org-wide — no country filtering

  const { data: policyRows, error: policyError } = await policiesQuery;

  if (policyError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "POLICY_FETCH_FAILED",
        message: "Unable to validate leave policy."
      },
      meta: buildMeta()
    });
  }

  const parsedPolicyRows = z.array(policyRowSchema).safeParse(policyRows ?? []);

  if (!parsedPolicyRows.success || parsedPolicyRows.data.length === 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "POLICY_NOT_FOUND",
        message: "Leave type is not configured for your organization."
      },
      meta: buildMeta()
    });
  }

  // Policies are org-wide — pick the first matching one
  const selectedPolicy = parsedPolicyRows.data[0];

  const { data: rawHolidays, error: holidaysError } = await supabase
    .from("holiday_calendars")
    .select("date")
    .eq("org_id", employeeProfile.org_id)
    .eq("country_code", employeeProfile.country_code ?? "NG")
    .gte("date", requestDate)
    .lte("date", parsedBody.data.endDate)
    .is("deleted_at", null);

  if (holidaysError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "HOLIDAYS_FETCH_FAILED",
        message: "Unable to resolve holiday calendar for leave calculation."
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

  const holidayDateKeys = new Set(parsedHolidays.data.map((holiday) => holiday.date));
  const totalDays = calculateWorkingDays(
    parsedBody.data.startDate,
    parsedBody.data.endDate,
    holidayDateKeys
  );

  if (totalDays <= 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "INVALID_WORKING_DAYS",
        message: "Selected range contains no working days after excluding weekends and holidays."
      },
      meta: buildMeta()
    });
  }

  if (parsedBody.data.leaveType === "annual_leave") {
    const businessDaysNotice = calculateBusinessDaysNotice(
      requestDate,
      parsedBody.data.startDate,
      holidayDateKeys
    );

    if (totalDays >= EXTENDED_LEAVE_MIN_WORKING_DAYS) {
      const calendarDaysNotice = differenceInCalendarDays(
        requestDate,
        parsedBody.data.startDate
      );

      if (calendarDaysNotice < EXTENDED_LEAVE_NOTICE_CALENDAR_DAYS) {
        return jsonResponse<null>(422, {
          data: null,
          error: {
            code: "INSUFFICIENT_ADVANCE_NOTICE",
            message: "Leave requests that are 2 weeks or longer must be submitted at least 4 weeks in advance."
          },
          meta: buildMeta()
        });
      }
    }

    if (businessDaysNotice < ROUTINE_NOTICE_BUSINESS_DAYS) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "INSUFFICIENT_ADVANCE_NOTICE",
          message: "Annual leave requests need at least 5 business days' notice."
        },
        meta: buildMeta()
      });
    }
  }

  const isUnlimitedType = selectedPolicy.is_unlimited || UNLIMITED_LEAVE_TYPES.has(parsedBody.data.leaveType);

  // Balance check for non-unlimited types
  if (!isUnlimitedType) {
    const requestYear = Number.parseInt(parsedBody.data.startDate.slice(0, 4), 10);

    const balance = await fetchLeaveBalanceAvailability({
      orgId: employeeProfile.org_id,
      employeeId: employeeProfile.id,
      leaveType: parsedBody.data.leaveType,
      year: requestYear,
      fallbackTotalDays: parseNumeric(selectedPolicy.default_days_per_year)
    });

    if (totalDays > balance.availableDays) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "BALANCE_EXCEEDED",
          message: `Requested days (${totalDays}) exceed your available balance (${balance.availableDays} days).`
        },
        meta: buildMeta()
      });
    }
  }

  // Sick leave > 2 consecutive working days requires documentation
  const requiresDocumentation = isSickLeaveType(parsedBody.data.leaveType) && totalDays > 2;

  if (requiresDocumentation && !parsedBody.data.medicalEvidencePath) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "MEDICAL_EVIDENCE_REQUIRED",
        message: "Medical evidence is required for sick leave longer than 2 days."
      },
      meta: buildMeta()
    });
  }

  const { data: insertedRequest, error: requestInsertError } = await supabase
    .from("leave_requests")
    .insert({
      org_id: employeeProfile.org_id,
      employee_id: employeeProfile.id,
      leave_type: parsedBody.data.leaveType,
      start_date: parsedBody.data.startDate,
      end_date: parsedBody.data.endDate,
      total_days: totalDays,
      status: "pending",
      reason: parsedBody.data.reason.trim(),
      requires_documentation: requiresDocumentation,
      medical_evidence_path: parsedBody.data.medicalEvidencePath ?? null
    })
    .select(
      "id, employee_id, leave_type, start_date, end_date, total_days, status, reason, approver_id, rejection_reason, created_at, updated_at"
    )
    .single();

  if (requestInsertError || !insertedRequest) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "REQUEST_CREATE_FAILED",
        message: "Unable to create leave request."
      },
      meta: buildMeta()
    });
  }

  // Skip balance tracking for unlimited leave types (e.g. sick leave)
  if (!isUnlimitedType) {
    try {
      await applyPendingBalanceDelta({
        orgId: employeeProfile.org_id,
        employeeId: employeeProfile.id,
        leaveType: parsedBody.data.leaveType,
        year: Number.parseInt(parsedBody.data.startDate.slice(0, 4), 10),
        pendingDaysDelta: totalDays,
        fallbackTotalDays: parseNumeric(selectedPolicy.default_days_per_year)
      });
    } catch (error) {
      const rollbackResult = await supabase
        .from("leave_requests")
        .delete()
        .eq("id", insertedRequest.id)
        .eq("org_id", employeeProfile.org_id);

      if (rollbackResult.error) {
        logger.error("Unable to rollback leave request after balance failure.", {
          leaveRequestId: insertedRequest.id,
          message: rollbackResult.error.message
        });
      }

      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "BALANCE_UPDATE_FAILED",
          message: error instanceof Error ? error.message : "Unable to update leave balance."
        },
        meta: buildMeta()
      });
    }
  }

  const parsedRequest = leaveRequestRowSchema.safeParse(insertedRequest);

  if (!parsedRequest.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "REQUEST_PARSE_FAILED",
        message: "Created leave request data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "submitted",
    tableName: "leave_requests",
    recordId: parsedRequest.data.id,
    newValue: {
      leaveType: parsedRequest.data.leave_type,
      startDate: parsedRequest.data.start_date,
      endDate: parsedRequest.data.end_date,
      totalDays: parsedRequest.data.total_days
    }
  }).catch(() => undefined);

  const responseData: TimeOffRequestMutationResponseData = {
    request: toRequestRecord(parsedRequest.data, employeeProfile)
  };

  const { data: approvalRows, error: approvalError } = await supabase
    .from("profiles")
    .select("id, roles")
    .eq("org_id", employeeProfile.org_id)
    .is("deleted_at", null);

  if (approvalError) {
    logger.error("Unable to load leave approver recipients.", {
      leaveRequestId: parsedRequest.data.id,
      message: approvalError.message
    });
  } else {
    const adminApproverIds = (approvalRows ?? [])
      .filter((row) => {
        const roles = Array.isArray(row.roles)
          ? row.roles.filter((role): role is string => typeof role === "string")
          : [];
        return roles.includes("HR_ADMIN") || roles.includes("SUPER_ADMIN");
      })
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string");

    const recipientIds = [
      ...(employeeProfile.manager_id ? [employeeProfile.manager_id] : []),
      ...adminApproverIds
    ].filter((id) => id !== employeeProfile.id);

    const leaveLabel = formatLeaveTypeLabel(parsedBody.data.leaveType);
    const dateLabel = formatDateRangeHuman(parsedBody.data.startDate, parsedBody.data.endDate);

    await createBulkNotifications({
      orgId: employeeProfile.org_id,
      userIds: recipientIds,
      type: "leave_submitted",
      title: `${leaveLabel} request submitted by ${employeeProfile.full_name}`,
      body: `${leaveLabel} for ${dateLabel}.`,
      link: "/time-off/approvals",
      actions: [
        {
          label: "Approve",
          variant: "primary",
          action_type: "api",
          api_endpoint: `/api/v1/time-off/requests/${parsedRequest.data.id}`,
          api_method: "PATCH",
          api_body: { action: "approve" }
        },
        {
          label: "Decline",
          variant: "destructive",
          action_type: "api",
          api_endpoint: `/api/v1/time-off/requests/${parsedRequest.data.id}`,
          api_method: "PATCH",
          api_body: { action: "reject" },
          requires_reason: true
        },
        {
          label: "View",
          variant: "outline",
          action_type: "navigate",
          navigate_url: "/time-off/approvals"
        }
      ]
    });

    // Notify HR when sick leave may require documentation (>2 consecutive working days)
    if (requiresDocumentation) {
      const hrAdminIds = adminApproverIds.filter((id) => id !== employeeProfile.id);

      if (hrAdminIds.length > 0) {
        await createBulkNotifications({
          orgId: employeeProfile.org_id,
          userIds: hrAdminIds,
          type: "leave_submitted",
          title: `Doctor's note may be required`,
          body: `${employeeProfile.full_name} submitted sick leave for ${totalDays} consecutive working days (${dateLabel}). A doctor's note may be required.`,
          link: "/time-off/approvals"
        });
      }
    }
  }

  // Fire-and-forget email notification to manager
  if (employeeProfile.manager_id) {
    sendLeaveRequestedEmail({
      orgId: employeeProfile.org_id,
      managerId: employeeProfile.manager_id,
      employeeName: employeeProfile.full_name,
      leaveType: parsedBody.data.leaveType,
      startDate: parsedBody.data.startDate,
      endDate: parsedBody.data.endDate,
      note: parsedBody.data.reason
    }).catch(err => console.error('Email send failed:', err));
  }

  return jsonResponse<TimeOffRequestMutationResponseData>(201, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
