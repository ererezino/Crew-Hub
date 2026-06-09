import "server-only";

import { z } from "zod";

import type { SessionProfile } from "../auth/session";
import { getCurrentMonthKey, monthToDateRange, parseNumeric } from "../time-off";
import { createSupabaseServerClient } from "../supabase/server";
import {
  LEAVE_ACCRUAL_TYPES,
  LEAVE_REQUEST_STATUSES,
  type HolidayCalendarDay,
  type LeaveBalance,
  type LeavePolicy,
  type LeaveRequestRecord,
  type TimeOffSummaryResponseData
} from "../../types/time-off";

/* ── Zod row schemas ── */

const profileBirthdayRowSchema = z.object({
  date_of_birth: z.string().nullable().optional().default(null),
  birthday_month: z.number().int().nullable().optional().default(null),
  birthday_day: z.number().int().nullable().optional().default(null)
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

/* ── Query parameter types ── */

export type TimeOffSummaryQuery = {
  year?: number;
  month?: string;
};

/* ── Main data-fetching function ── */

/**
 * Fetch the time-off summary data for a single employee.
 * Accepts a session profile (already authenticated) and optional query params.
 * Returns the same `TimeOffSummaryResponseData` shape the client expects.
 * Throws on unrecoverable errors so the caller can handle them.
 */
export async function fetchTimeOffSummaryData(
  profile: SessionProfile,
  query: TimeOffSummaryQuery = {}
): Promise<TimeOffSummaryResponseData> {
  const now = new Date();
  const year = query.year ?? now.getUTCFullYear();
  const month = query.month ?? getCurrentMonthKey();
  const monthRange = monthToDateRange(month);

  if (!monthRange) {
    throw new Error("Month must be in YYYY-MM format.");
  }

  const supabase = await createSupabaseServerClient();
  const yearStart = `${String(year)}-01-01`;
  const yearEnd = `${String(year)}-12-31`;

  const employeeProfile = {
    id: profile.id,
    full_name: profile.full_name,
    department: profile.department,
    country_code: profile.country_code,
    status: profile.status,
    date_of_birth: null as string | null,
    birthday_month: null as number | null,
    birthday_day: null as number | null
  };

  // Fetch birthday fields separately (optional columns, may not exist on older schemas)
  const profileBirthdayResult = await supabase
    .from("profiles")
    .select("date_of_birth, birthday_month, birthday_day")
    .eq("id", profile.id)
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (profileBirthdayResult.error) {
    const message = profileBirthdayResult.error.message.toLowerCase();
    const missingDateOfBirthColumn =
      profileBirthdayResult.error.code === "42703" ||
      message.includes("date_of_birth") ||
      message.includes("birthday_month") ||
      message.includes("birthday_day");

    if (!missingDateOfBirthColumn) {
      throw new Error("Unable to resolve employee profile for time off.");
    }
  } else if (profileBirthdayResult.data) {
    const parsedProfileBirthday = profileBirthdayRowSchema.safeParse(profileBirthdayResult.data);
    if (!parsedProfileBirthday.success) {
      throw new Error("Employee profile data is not in the expected shape.");
    }
    employeeProfile.date_of_birth = parsedProfileBirthday.data.date_of_birth;
    employeeProfile.birthday_month = parsedProfileBirthday.data.birthday_month;
    employeeProfile.birthday_day = parsedProfileBirthday.data.birthday_day;
  }

  const orgId = profile.org_id;

  // Build policies query — try with is_unlimited, fall back without it
  const buildPoliciesQuery = (withUnlimited: boolean) => {
    const selectCols = withUnlimited
      ? "id, country_code, leave_type, default_days_per_year, accrual_type, carry_over, is_unlimited, notes, created_at, updated_at"
      : "id, country_code, leave_type, default_days_per_year, accrual_type, carry_over, notes, created_at, updated_at";

    return supabase
      .from("leave_policies")
      .select(selectCols)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .order("leave_type", { ascending: true });
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
      .eq("org_id", orgId)
      .eq("employee_id", profile.id)
      .eq("year", year)
      .is("deleted_at", null)
      .order("leave_type", { ascending: true }),
    supabase
      .from("leave_requests")
      .select(
        "id, employee_id, leave_type, start_date, end_date, total_days, status, reason, approver_id, rejection_reason, pending_change_type, pending_start_date, pending_end_date, pending_total_days, change_reason, change_requested_by, change_requested_at, created_at, updated_at"
      )
      .eq("org_id", orgId)
      .eq("employee_id", profile.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    employeeProfile.country_code
      ? supabase
          .from("holiday_calendars")
          .select("id, country_code, date, name, year")
          .eq("org_id", orgId)
          .eq("country_code", employeeProfile.country_code)
          .gte("date", yearStart)
          .lte("date", yearEnd)
          .is("deleted_at", null)
          .order("date", { ascending: true })
      : Promise.resolve({ data: [] as never[], error: null })
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
    throw new Error("Unable to load time off summary data.");
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
    throw new Error("Time off data is not in the expected shape.");
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
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .in("id", approverIds);

    if (approversError) {
      throw new Error("Unable to resolve leave approvers.");
    }

    const parsedApprovers = z.array(actorProfileRowSchema).safeParse(rawApprovers ?? []);

    if (!parsedApprovers.success) {
      throw new Error("Approver data is not in the expected shape.");
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
    actingFor: null,
    actingForName: null,
    delegateType: null,
    pendingChangeType: row.pending_change_type ?? null,
    pendingStartDate: row.pending_start_date ?? null,
    pendingEndDate: row.pending_end_date ?? null,
    pendingTotalDays:
      row.pending_total_days === null || row.pending_total_days === undefined
        ? null
        : parseNumeric(row.pending_total_days),
    changeReason: row.change_reason ?? null,
    changeRequestedBy: row.change_requested_by ?? null,
    changeRequestedByName: null,
    changeRequestedAt: row.change_requested_at ?? null,
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

  return {
    profile: {
      id: employeeProfile.id,
      fullName: employeeProfile.full_name,
      department: employeeProfile.department,
      countryCode: employeeProfile.country_code,
      dateOfBirth: employeeProfile.date_of_birth,
      birthdayMonth: employeeProfile.birthday_month,
      birthdayDay: employeeProfile.birthday_day,
      status: employeeProfile.status
    },
    policies,
    balances,
    requests,
    holidays
  };
}
