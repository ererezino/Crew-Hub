import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createBulkNotifications } from "../../../../../lib/notifications/service";
import {
  calculateWorkingDays,
  isIsoDate,
  parseNumeric
} from "../../../../../lib/time-off";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import {
  LEAVE_REQUEST_STATUSES,
  type LeaveRequestRecord,
  type TimeOffRequestMutationResponseData
} from "../../../../../types/time-off";

const createLeaveRequestSchema = z.object({
  leaveType: z.string().trim().min(1, "Leave type is required").max(50, "Leave type is too long"),
  startDate: z
    .string()
    .refine((value) => isIsoDate(value), "Start date must be in YYYY-MM-DD format"),
  endDate: z
    .string()
    .refine((value) => isIsoDate(value), "End date must be in YYYY-MM-DD format"),
  reason: z.string().trim().min(1, "Reason is required").max(2000, "Reason is too long")
});

const profileRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  email: z.string().email(),
  full_name: z.string(),
  department: z.string().nullable(),
  country_code: z.string().nullable(),
  manager_id: z.string().uuid().nullable()
});

const policyRowSchema = z.object({
  id: z.string().uuid(),
  country_code: z.string(),
  default_days_per_year: z.union([z.number(), z.string()])
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

const leaveBalanceRowSchema = z.object({
  id: z.string().uuid(),
  total_days: z.union([z.number(), z.string()]),
  used_days: z.union([z.number(), z.string()]),
  pending_days: z.union([z.number(), z.string()]),
  carried_days: z.union([z.number(), z.string()])
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
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
    createdAt: requestRow.created_at,
    updatedAt: requestRow.updated_at
  };
}

async function applyPendingBalanceDelta({
  supabase,
  orgId,
  employeeId,
  leaveType,
  year,
  pendingDaysDelta,
  fallbackTotalDays
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
  employeeId: string;
  leaveType: string;
  year: number;
  pendingDaysDelta: number;
  fallbackTotalDays: number;
}): Promise<void> {
  const { data: rawBalance, error: balanceFetchError } = await supabase
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
    const nextPendingDays = Math.max(0, pendingDaysDelta);
    const { error: balanceInsertError } = await supabase.from("leave_balances").insert({
      org_id: orgId,
      employee_id: employeeId,
      leave_type: leaveType,
      year,
      total_days: Math.max(0, fallbackTotalDays),
      used_days: 0,
      pending_days: nextPendingDays,
      carried_days: 0
    });

    if (balanceInsertError) {
      throw new Error(`Unable to create leave balance: ${balanceInsertError.message}`);
    }

    return;
  }

  const parsedBalance = leaveBalanceRowSchema.safeParse(rawBalance);

  if (!parsedBalance.success) {
    throw new Error("Existing leave balance data is not in the expected shape.");
  }

  const currentPendingDays = parseNumeric(parsedBalance.data.pending_days);
  const nextPendingDays = Math.max(0, currentPendingDays + pendingDaysDelta);

  const { error: balanceUpdateError } = await supabase
    .from("leave_balances")
    .update({
      pending_days: nextPendingDays
    })
    .eq("id", parsedBalance.data.id)
    .eq("org_id", orgId);

  if (balanceUpdateError) {
    throw new Error(`Unable to update leave balance: ${balanceUpdateError.message}`);
  }
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

  const supabase = await createSupabaseServerClient();

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("id, org_id, email, full_name, department, country_code, manager_id")
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

  let policiesQuery = supabase
    .from("leave_policies")
    .select("id, default_days_per_year, country_code")
    .eq("org_id", employeeProfile.org_id)
    .eq("leave_type", parsedBody.data.leaveType)
    .is("deleted_at", null)
    .limit(5);

  if (employeeProfile.country_code) {
    policiesQuery = policiesQuery.in("country_code", [employeeProfile.country_code, "NG"]);
  }

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
        message: "Leave type is not configured for your country policy."
      },
      meta: buildMeta()
    });
  }

  const selectedPolicy =
    parsedPolicyRows.data.find((policy) => policy.country_code === employeeProfile.country_code) ??
    parsedPolicyRows.data.find((policy) => policy.country_code === "NG") ??
    parsedPolicyRows.data[0];

  const { data: rawHolidays, error: holidaysError } = await supabase
    .from("holiday_calendars")
    .select("date")
    .eq("org_id", employeeProfile.org_id)
    .eq("country_code", employeeProfile.country_code ?? "NG")
    .gte("date", parsedBody.data.startDate)
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
      reason: parsedBody.data.reason.trim()
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

  try {
    await applyPendingBalanceDelta({
      supabase,
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
      console.error("Unable to rollback leave request after balance failure.", {
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

  const responseData: TimeOffRequestMutationResponseData = {
    request: toRequestRecord(parsedRequest.data, employeeProfile)
  };

  const { data: approvalRows, error: approvalError } = await supabase
    .from("profiles")
    .select("id, roles")
    .eq("org_id", employeeProfile.org_id)
    .is("deleted_at", null);

  if (approvalError) {
    console.error("Unable to load leave approver recipients.", {
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

    await createBulkNotifications({
      orgId: employeeProfile.org_id,
      userIds: recipientIds,
      type: "leave_submitted",
      title: `Leave request submitted by ${employeeProfile.full_name}`,
      body: `${parsedBody.data.leaveType} leave from ${parsedBody.data.startDate} to ${parsedBody.data.endDate}.`,
      link: "/time-off/approvals"
    });
  }

  return jsonResponse<TimeOffRequestMutationResponseData>(201, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
