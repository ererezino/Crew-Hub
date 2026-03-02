import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { parseNumeric } from "../../../../../lib/time-attendance";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import {
  TIME_ROUNDING_RULES,
  type TimeAttendancePoliciesResponseData,
  type TimePolicyRecord
} from "../../../../../types/time-attendance";

const policyRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  name: z.string(),
  applies_to_departments: z.array(z.string()).nullable(),
  applies_to_types: z.array(z.string()).nullable(),
  country_code: z.string().nullable(),
  weekly_hours_target: z.union([z.number(), z.string()]),
  daily_hours_max: z.union([z.number(), z.string()]),
  overtime_after_daily: z.union([z.number(), z.string()]).nullable(),
  overtime_after_weekly: z.union([z.number(), z.string()]).nullable(),
  overtime_multiplier: z.union([z.number(), z.string()]),
  double_time_after: z.union([z.number(), z.string()]).nullable(),
  double_time_multiplier: z.union([z.number(), z.string()]),
  break_after_hours: z.union([z.number(), z.string()]),
  break_duration_minutes: z.number(),
  paid_break: z.boolean(),
  rounding_rule: z.enum(TIME_ROUNDING_RULES),
  require_geolocation: z.boolean(),
  allowed_locations: z.unknown(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function parseOptionalNumeric(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }

  return parseNumeric(value);
}

export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view attendance policies."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: rawPolicies, error: policiesError } = await supabase
    .from("time_policies")
    .select(
      "id, org_id, name, applies_to_departments, applies_to_types, country_code, weekly_hours_target, daily_hours_max, overtime_after_daily, overtime_after_weekly, overtime_multiplier, double_time_after, double_time_multiplier, break_after_hours, break_duration_minutes, paid_break, rounding_rule, require_geolocation, allowed_locations, is_active, created_at, updated_at"
    )
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false });

  if (policiesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "POLICIES_FETCH_FAILED",
        message: "Unable to load attendance policies."
      },
      meta: buildMeta()
    });
  }

  const parsedPolicies = z.array(policyRowSchema).safeParse(rawPolicies ?? []);

  if (!parsedPolicies.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "POLICIES_PARSE_FAILED",
        message: "Attendance policy data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const policies: TimePolicyRecord[] = parsedPolicies.data.map((policy) => ({
    id: policy.id,
    orgId: policy.org_id,
    name: policy.name,
    appliesToDepartments: policy.applies_to_departments,
    appliesToTypes: policy.applies_to_types,
    countryCode: policy.country_code,
    weeklyHoursTarget: parseNumeric(policy.weekly_hours_target),
    dailyHoursMax: parseNumeric(policy.daily_hours_max),
    overtimeAfterDaily: parseOptionalNumeric(policy.overtime_after_daily),
    overtimeAfterWeekly: parseOptionalNumeric(policy.overtime_after_weekly),
    overtimeMultiplier: parseNumeric(policy.overtime_multiplier),
    doubleTimeAfter: parseOptionalNumeric(policy.double_time_after),
    doubleTimeMultiplier: parseNumeric(policy.double_time_multiplier),
    breakAfterHours: parseNumeric(policy.break_after_hours),
    breakDurationMinutes: policy.break_duration_minutes,
    paidBreak: policy.paid_break,
    roundingRule: policy.rounding_rule,
    requireGeolocation: policy.require_geolocation,
    allowedLocations: Array.isArray(policy.allowed_locations) ? policy.allowed_locations : [],
    isActive: policy.is_active,
    createdAt: policy.created_at,
    updatedAt: policy.updated_at
  }));

  return jsonResponse<TimeAttendancePoliciesResponseData>(200, {
    data: {
      policies
    },
    error: null,
    meta: buildMeta()
  });
}
