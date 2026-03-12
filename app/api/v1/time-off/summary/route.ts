import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { getCurrentMonthKey, monthToDateRange, parseNumeric } from "../../../../../lib/time-off";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import {
  LEAVE_ACCRUAL_TYPES,
  LEAVE_REQUEST_STATUSES,
  type HolidayCalendarDay,
  type LeaveBalance,
  type LeavePolicy,
  type LeaveRequestRecord,
  type TimeOffSummaryResponseData
} from "../../../../../types/time-off";

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(3000).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional()
});

const profileDobRowSchema = z.object({
  date_of_birth: z.string().nullable().optional().default(null)
});

const policyRowSchema = z.object({
  id: z.string().uuid(),
  country_code: z.string().nullable(),
  leave_type: z.string(),
  default_days_per_year: z.union([z.number(), z.string()]),
  accrual_type: z.enum(LEAVE_ACCRUAL_TYPES),
  carry_over: z.boolean(),
  is_unlimited: z.boolean().optional().default(false),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const balanceRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  leave_type: z.string(),
  year: z.number(),
  total_days: z.union([z.number(), z.string()]),
  used_days: z.union([z.number(), z.string()]),
  pending_days: z.union([z.number(), z.string()]),
  carried_days: z.union([z.number(), z.string()]),
  created_at: z.string(),
  updated_at: z.string()
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

const actorProfileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string()
});

const holidayRowSchema = z.object({
  id: z.string().uuid(),
  country_code: z.string(),
  date: z.string(),
  name: z.string(),
  year: z.number()
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
        message: "You must be logged in to view time off data."
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
        message: parsedQuery.error.issues[0]?.message ?? "Invalid time off query parameters."
      },
      meta: buildMeta()
    });
  }

  const now = new Date();
  const year = parsedQuery.data.year ?? now.getUTCFullYear();
  const month = parsedQuery.data.month ?? getCurrentMonthKey();
  const monthRange = monthToDateRange(month);

  if (!monthRange) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Month must be in YYYY-MM format."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const yearStart = `${String(year)}-01-01`;
  const yearEnd = `${String(year)}-12-31`;

  const employeeProfile = {
    id: session.profile.id,
    full_name: session.profile.full_name,
    department: session.profile.department,
    country_code: session.profile.country_code,
    status: session.profile.status,
    date_of_birth: null as string | null
  };

  const profileDobResult = await supabase
    .from("profiles")
    .select("date_of_birth")
    .eq("id", session.profile.id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (profileDobResult.error) {
    const message = profileDobResult.error.message.toLowerCase();
    const missingDateOfBirthColumn =
      profileDobResult.error.code === "42703" || message.includes("date_of_birth");

    if (!missingDateOfBirthColumn) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PROFILE_FETCH_FAILED",
          message: "Unable to resolve employee profile for time off."
        },
        meta: buildMeta()
      });
    }
  } else if (profileDobResult.data) {
    const parsedProfileDob = profileDobRowSchema.safeParse(profileDobResult.data);
    if (!parsedProfileDob.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PROFILE_PARSE_FAILED",
          message: "Employee profile data is not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    employeeProfile.date_of_birth = parsedProfileDob.data.date_of_birth;
  }

  const orgId = session.profile.org_id;

  // Build policies query — try with is_unlimited, fall back without it
  const buildPoliciesQuery = (withUnlimited: boolean) => {
    const selectCols = withUnlimited
      ? "id, country_code, leave_type, default_days_per_year, accrual_type, carry_over, is_unlimited, notes, created_at, updated_at"
      : "id, country_code, leave_type, default_days_per_year, accrual_type, carry_over, notes, created_at, updated_at";

    const query = supabase
      .from("leave_policies")
      .select(selectCols)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .order("leave_type", { ascending: true });

    // Leave policies are org-wide — no country filtering needed
    return query;
  };

  let rawPolicies: unknown[] | null = null;
  let policiesError: { message: string } | null = null;

  const [
    policiesResult,
    { data: rawBalances, error: balancesError },
    { data: rawRequests, error: requestsError },
    { data: rawHolidays, error: holidaysError }
  ] = await Promise.all([
    buildPoliciesQuery(true),
    supabase
      .from("leave_balances")
      .select(
        "id, employee_id, leave_type, year, total_days, used_days, pending_days, carried_days, created_at, updated_at"
      )
      .eq("org_id", session.profile.org_id)
      .eq("employee_id", session.profile.id)
      .eq("year", year)
      .is("deleted_at", null)
      .order("leave_type", { ascending: true }),
    supabase
      .from("leave_requests")
      .select(
        "id, employee_id, leave_type, start_date, end_date, total_days, status, reason, approver_id, rejection_reason, created_at, updated_at"
      )
      .eq("org_id", session.profile.org_id)
      .eq("employee_id", session.profile.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    employeeProfile.country_code
      ? supabase
          .from("holiday_calendars")
          .select("id, country_code, date, name, year")
          .eq("org_id", session.profile.org_id)
          .eq("country_code", employeeProfile.country_code)
          .gte("date", yearStart)
          .lte("date", yearEnd)
          .is("deleted_at", null)
          .order("date", { ascending: true })
      : Promise.resolve({ data: [], error: null })
  ]);

  // Handle policies with fallback for missing is_unlimited column
  if (policiesResult.error) {
    const fallbackResult = await buildPoliciesQuery(false);
    rawPolicies = fallbackResult.data as unknown[] | null;
    policiesError = fallbackResult.error;
  } else {
    rawPolicies = policiesResult.data as unknown[] | null;
  }

  if (policiesError || balancesError || requestsError || holidaysError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TIME_OFF_FETCH_FAILED",
        message: "Unable to load time off summary data."
      },
      meta: buildMeta()
    });
  }

  const parsedPolicies = z.array(policyRowSchema).safeParse(rawPolicies ?? []);
  const parsedBalances = z.array(balanceRowSchema).safeParse(rawBalances ?? []);
  const parsedRequests = z.array(requestRowSchema).safeParse(rawRequests ?? []);
  const parsedHolidays = z.array(holidayRowSchema).safeParse(rawHolidays ?? []);

  if (
    !parsedPolicies.success ||
    !parsedBalances.success ||
    !parsedRequests.success ||
    !parsedHolidays.success
  ) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TIME_OFF_PARSE_FAILED",
        message: "Time off data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const approverIds = [
    ...new Set(
      parsedRequests.data
        .map((row) => row.approver_id)
        .filter((value): value is string => Boolean(value))
    )
  ];

  let approverNameById = new Map<string, string>();

  if (approverIds.length > 0) {
    const { data: rawApprovers, error: approversError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .in("id", approverIds);

    if (approversError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "APPROVERS_FETCH_FAILED",
          message: "Unable to resolve leave approvers."
        },
        meta: buildMeta()
      });
    }

    const parsedApprovers = z.array(actorProfileRowSchema).safeParse(rawApprovers ?? []);

    if (!parsedApprovers.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "APPROVERS_PARSE_FAILED",
          message: "Approver data is not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    approverNameById = new Map(parsedApprovers.data.map((row) => [row.id, row.full_name]));
  }

  // Filter policies for probation users: only unpaid_personal_day
  const filteredPolicyRows = employeeProfile.status === "onboarding"
    ? parsedPolicies.data.filter((row) => row.leave_type === "unpaid_personal_day")
    : parsedPolicies.data;

  const policies: LeavePolicy[] = filteredPolicyRows.map((row) => ({
    id: row.id,
    countryCode: row.country_code,
    leaveType: row.leave_type,
    defaultDaysPerYear: parseNumeric(row.default_days_per_year),
    accrualType: row.accrual_type,
    carryOver: row.carry_over,
    isUnlimited: row.is_unlimited,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  const balances: LeaveBalance[] = parsedBalances.data.map((row) => {
    const totalDays = parseNumeric(row.total_days);
    const usedDays = parseNumeric(row.used_days);
    const pendingDays = parseNumeric(row.pending_days);
    const carriedDays = parseNumeric(row.carried_days);
    const availableDays = totalDays + carriedDays - usedDays - pendingDays;

    return {
      id: row.id,
      employeeId: row.employee_id,
      leaveType: row.leave_type,
      year: row.year,
      totalDays,
      usedDays,
      pendingDays,
      carriedDays,
      availableDays,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  });

  const requests: LeaveRequestRecord[] = parsedRequests.data.map((row) => ({
    id: row.id,
    employeeId: row.employee_id,
    employeeName: employeeProfile.full_name,
    employeeDepartment: employeeProfile.department,
    employeeCountryCode: employeeProfile.country_code,
    leaveType: row.leave_type,
    startDate: row.start_date,
    endDate: row.end_date,
    totalDays: parseNumeric(row.total_days),
    status: row.status,
    reason: row.reason,
    approverId: row.approver_id,
    approverName: row.approver_id ? approverNameById.get(row.approver_id) ?? "Unknown user" : null,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  const holidays: HolidayCalendarDay[] = parsedHolidays.data.map((row) => ({
    id: row.id,
    countryCode: row.country_code,
    date: row.date,
    name: row.name,
    year: row.year
  }));

  const responseData: TimeOffSummaryResponseData = {
    profile: {
      id: employeeProfile.id,
      fullName: employeeProfile.full_name,
      department: employeeProfile.department,
      countryCode: employeeProfile.country_code,
      dateOfBirth: employeeProfile.date_of_birth,
      status: employeeProfile.status
    },
    policies,
    balances,
    requests,
    holidays
  };

  return jsonResponse<TimeOffSummaryResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
