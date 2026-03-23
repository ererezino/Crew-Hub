import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { logger } from "../../../../../lib/logger";
import { createBulkNotifications } from "../../../../../lib/notifications/service";
import {
  applyPendingBalanceDelta,
  fetchLeaveBalanceAvailability
} from "../../../../../lib/time-off/balances";
import { isIsoDate, parseNumeric } from "../../../../../lib/time-off";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import type { AfkLogRecord, AfkLogsResponseData } from "../../../../../types/time-off";

const HH_MM_REGEX = /^\d{2}:\d{2}$/;

const createAfkSchema = z.object({
  date: z
    .string()
    .refine((value) => isIsoDate(value), "Date must be in YYYY-MM-DD format"),
  startTime: z
    .string()
    .regex(HH_MM_REGEX, "Start time must be in HH:MM format"),
  endTime: z
    .string()
    .regex(HH_MM_REGEX, "End time must be in HH:MM format"),
  notes: z.string().trim().max(500, "Notes must be 500 characters or fewer").default("")
});

const afkLogRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  duration_minutes: z.number(),
  reclassified_as: z.string().nullable(),
  leave_request_id: z.string().uuid().nullable(),
  notes: z.string(),
  created_at: z.string()
});

const leavePolicyRowSchema = z.object({
  default_days_per_year: z.union([z.number(), z.string()]),
  is_unlimited: z.boolean()
});

const AFK_WEEKLY_LIMIT = 2;
const AFK_RECLASSIFY_THRESHOLD_MINUTES = 120;

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function parseTimeToMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function getIsoWeekStart(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const day = date.getUTCDay();
  const diff = day === 0 ? 6 : day - 1; // Monday = 0
  date.setUTCDate(date.getUTCDate() - diff);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getIsoWeekEnd(weekStart: string): string {
  const date = new Date(`${weekStart}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 6);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function mapAfkLogRow(row: z.infer<typeof afkLogRowSchema>): AfkLogRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    durationMinutes: row.duration_minutes,
    reclassifiedAs: row.reclassified_as,
    leaveRequestId: row.leave_request_id,
    notes: row.notes,
    createdAt: row.created_at
  };
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in to view AFK logs." },
      meta: buildMeta()
    });
  }

  const requestUrl = new URL(request.url);
  const dateParam = requestUrl.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const weekStart = getIsoWeekStart(dateParam);
  const weekEnd = getIsoWeekEnd(weekStart);

  const supabase = await createSupabaseServerClient();

  const { data: rawLogs, error: logsError } = await supabase
    .from("afk_logs")
    .select("id, employee_id, date, start_time, end_time, duration_minutes, reclassified_as, leave_request_id, notes, created_at")
    .eq("org_id", session.profile.org_id)
    .eq("employee_id", session.profile.id)
    .gte("date", weekStart)
    .lte("date", weekEnd)
    .is("deleted_at", null)
    .order("date", { ascending: false })
    .order("start_time", { ascending: false });

  if (logsError) {
    // Table may not exist yet (pre-migration) — return empty data gracefully
    const errStr = `${logsError.message ?? ""} ${logsError.code ?? ""}`.toLowerCase();
    const isMissingTable = errStr.includes("does not exist")
      || errStr.includes("42p01")
      || errStr.includes("not found")
      || errStr.includes("afk_logs");

    if (isMissingTable) {
      return jsonResponse<AfkLogsResponseData>(200, {
        data: { logs: [], weeklyCount: 0, weeklyLimit: AFK_WEEKLY_LIMIT },
        error: null,
        meta: buildMeta()
      });
    }

    return jsonResponse<null>(500, {
      data: null,
      error: { code: "AFK_FETCH_FAILED", message: "Unable to load AFK logs." },
      meta: buildMeta()
    });
  }

  const parsedLogs = z.array(afkLogRowSchema).safeParse(rawLogs ?? []);

  if (!parsedLogs.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "AFK_PARSE_FAILED", message: "AFK log data is not in the expected shape." },
      meta: buildMeta()
    });
  }

  const responseData: AfkLogsResponseData = {
    logs: parsedLogs.data.map(mapAfkLogRow),
    weeklyCount: parsedLogs.data.length,
    weeklyLimit: AFK_WEEKLY_LIMIT
  };

  return jsonResponse<AfkLogsResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in to log AFK time." },
      meta: buildMeta()
    });
  }

  const sessionProfile = session.profile;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Request body must be valid JSON." },
      meta: buildMeta()
    });
  }

  const parsedBody = createAfkSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid AFK log payload."
      },
      meta: buildMeta()
    });
  }

  const startMinutes = parseTimeToMinutes(parsedBody.data.startTime);
  const endMinutes = parseTimeToMinutes(parsedBody.data.endTime);

  if (endMinutes <= startMinutes) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: "End time must be after start time." },
      meta: buildMeta()
    });
  }

  const durationMinutes = endMinutes - startMinutes;

  // Weekly cap check
  const weekStart = getIsoWeekStart(parsedBody.data.date);
  const weekEnd = getIsoWeekEnd(weekStart);
  const supabase = await createSupabaseServerClient();

  const { count: weeklyCount, error: countError } = await supabase
    .from("afk_logs")
    .select("id", { count: "exact", head: true })
    .eq("org_id", sessionProfile.org_id)
    .eq("employee_id", sessionProfile.id)
    .gte("date", weekStart)
    .lte("date", weekEnd)
    .is("deleted_at", null);

  if (countError) {
    // Table may not exist yet (pre-migration)
    if (countError.message?.includes("does not exist") || countError.code === "42P01") {
      return jsonResponse<null>(422, {
        data: null,
        error: { code: "TABLE_NOT_READY", message: "AFK logging is not available yet. Please contact your administrator." },
        meta: buildMeta()
      });
    }

    return jsonResponse<null>(500, {
      data: null,
      error: { code: "AFK_COUNT_FAILED", message: "Unable to check weekly AFK count." },
      meta: buildMeta()
    });
  }

  const shouldReclassifyAsPersonalDay = durationMinutes > AFK_RECLASSIFY_THRESHOLD_MINUTES;

  if (!shouldReclassifyAsPersonalDay && (weeklyCount ?? 0) >= AFK_WEEKLY_LIMIT) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "WEEKLY_LIMIT_REACHED",
        message: `Maximum ${AFK_WEEKLY_LIMIT} AFK entries per week. You have already logged ${weeklyCount ?? 0}.`
      },
      meta: buildMeta()
    });
  }

  let reclassifiedAs: string | null = null;
  let leaveRequestId: string | null = null;

  // Auto-reclassify if > 2 hours
  if (shouldReclassifyAsPersonalDay) {
    reclassifiedAs = "personal_days";

    const { data: rawPolicy, error: policyError } = await supabase
      .from("leave_policies")
      .select("default_days_per_year, is_unlimited")
      .eq("org_id", sessionProfile.org_id)
      .eq("leave_type", "personal_days")
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    if (policyError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "POLICY_FETCH_FAILED",
          message: "Unable to validate personal day policy for AFK reclassification."
        },
        meta: buildMeta()
      });
    }

    const parsedPolicy = leavePolicyRowSchema.safeParse(rawPolicy);

    if (!parsedPolicy.success) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "POLICY_NOT_FOUND",
          message: "Personal days are not configured for your organization."
        },
        meta: buildMeta()
      });
    }

    const leaveYear = Number.parseInt(parsedBody.data.date.slice(0, 4), 10);
    const fallbackTotalDays = parseNumeric(parsedPolicy.data.default_days_per_year);

    if (!parsedPolicy.data.is_unlimited) {
      const balance = await fetchLeaveBalanceAvailability({
        orgId: sessionProfile.org_id,
        employeeId: sessionProfile.id,
        leaveType: "personal_days",
        year: leaveYear,
        fallbackTotalDays
      });

      if (balance.availableDays < 1) {
        return jsonResponse<null>(422, {
          data: null,
          error: {
            code: "BALANCE_EXCEEDED",
            message: "AFKs longer than 2 hours must be recorded as a personal day, but you do not have a personal day available. Please contact your manager."
          },
          meta: buildMeta()
        });
      }
    }

    const { data: leaveRequest, error: leaveError } = await supabase
      .from("leave_requests")
      .insert({
        org_id: sessionProfile.org_id,
        employee_id: sessionProfile.id,
        leave_type: "personal_days",
        start_date: parsedBody.data.date,
        end_date: parsedBody.data.date,
        total_days: 1,
        status: "pending",
        reason: `Auto-reclassified from AFK (${durationMinutes} minutes)`
      })
      .select("id")
      .single();

    if (leaveError || !leaveRequest) {
      logger.error("Failed to create reclassified leave request.", {
        employeeId: sessionProfile.id,
        afkDate: parsedBody.data.date,
        message: leaveError?.message ?? "Leave request not returned."
      });
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "RECLASSIFICATION_FAILED",
          message: "Unable to convert this AFK into a personal day request."
        },
        meta: buildMeta()
      });
    } else {
      try {
        await applyPendingBalanceDelta({
          orgId: sessionProfile.org_id,
          employeeId: sessionProfile.id,
          leaveType: "personal_days",
          year: leaveYear,
          pendingDaysDelta: 1,
          fallbackTotalDays
        });
      } catch (error) {
        await supabase
          .from("leave_requests")
          .delete()
          .eq("id", leaveRequest.id)
          .eq("org_id", sessionProfile.org_id);

        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "BALANCE_UPDATE_FAILED",
            message: error instanceof Error ? error.message : "Unable to update personal day balance."
          },
          meta: buildMeta()
        });
      }

      leaveRequestId = leaveRequest.id;

      const { data: profileRow } = await supabase
        .from("profiles")
        .select("full_name, manager_id")
        .eq("id", sessionProfile.id)
        .eq("org_id", sessionProfile.org_id)
        .is("deleted_at", null)
        .single();

      const { data: approverRows, error: approverError } = await supabase
        .from("profiles")
        .select("id, roles")
        .eq("org_id", sessionProfile.org_id)
        .is("deleted_at", null);

      if (approverError) {
        logger.error("Unable to load AFK approver recipients.", {
          employeeId: sessionProfile.id,
          afkDate: parsedBody.data.date,
          message: approverError.message
        });
      }

      const adminApproverIds = (approverRows ?? [])
        .filter((row) => {
          const roles = Array.isArray(row.roles)
            ? row.roles.filter((role): role is string => typeof role === "string")
            : [];
          return roles.includes("HR_ADMIN") || roles.includes("SUPER_ADMIN");
        })
        .map((row) => row.id)
        .filter((id): id is string => typeof id === "string");

      const recipientIds = [
        ...(profileRow?.manager_id ? [profileRow.manager_id] : []),
        ...adminApproverIds
      ].filter((id) => id !== sessionProfile.id);

      if (recipientIds.length > 0) {
        await createBulkNotifications({
          orgId: sessionProfile.org_id,
          userIds: recipientIds,
          type: "leave_submitted",
          title: "AFK reclassified as personal day",
          body: `${profileRow?.full_name ?? "An employee"} logged ${durationMinutes} minutes AFK, which has been automatically reclassified as a personal day request.`,
          link: "/time-off/approvals"
        });
      }
    }
  }

  const { data: insertedLog, error: insertError } = await supabase
    .from("afk_logs")
    .insert({
      org_id: sessionProfile.org_id,
      employee_id: sessionProfile.id,
      date: parsedBody.data.date,
      start_time: parsedBody.data.startTime,
      end_time: parsedBody.data.endTime,
      duration_minutes: durationMinutes,
      reclassified_as: reclassifiedAs,
      leave_request_id: leaveRequestId,
      notes: parsedBody.data.notes
    })
    .select("id, employee_id, date, start_time, end_time, duration_minutes, reclassified_as, leave_request_id, notes, created_at")
    .single();

  if (insertError || !insertedLog) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "AFK_CREATE_FAILED", message: "Unable to log AFK entry." },
      meta: buildMeta()
    });
  }

  const parsedLog = afkLogRowSchema.safeParse(insertedLog);

  if (!parsedLog.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "AFK_PARSE_FAILED", message: "Created AFK log data is not in the expected shape." },
      meta: buildMeta()
    });
  }

  const responseData: AfkLogsResponseData = {
    logs: [mapAfkLogRow(parsedLog.data)],
    weeklyCount: (weeklyCount ?? 0) + 1,
    weeklyLimit: AFK_WEEKLY_LIMIT
  };

  return jsonResponse<AfkLogsResponseData>(201, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
