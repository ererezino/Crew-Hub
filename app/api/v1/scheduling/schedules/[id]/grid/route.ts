import { NextResponse } from "next/server";
import { z } from "zod";

import { checkApiAccess } from "../../../../../../../lib/auth/check-api-access";
import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { areDepartmentsEqual } from "../../../../../../../lib/department";
import { isDepartmentOnlyTeamLead } from "../../../../../../../lib/roles";
import { extractIsoTime, isSchedulingManager } from "../../../../../../../lib/scheduling";
import { createSupabaseServiceRoleClient } from "../../../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../../../types/auth";
import { SCHEDULE_STATUSES } from "../../../../../../../types/scheduling";

/**
 * Weekly grid cell editor. The Notion-style grid is a view over per-day `shifts`:
 * one cell = one crew member working one shift slot for one week. Saving a cell sets
 * exactly which weekdays that person works that slot — creating/removing the underlying
 * daily shifts in one call. Conflicts (overlap, time off) are returned as advisory,
 * non-blocking warnings: the team lead decides.
 */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const gridCellSchema = z.object({
  employeeId: z.string().uuid(),
  slot: z.object({
    name: z.string().min(1).max(120),
    startTime: z.string().regex(HHMM, "startTime must be HH:MM"),
    endTime: z.string().regex(HHMM, "endTime must be HH:MM")
  }),
  // Any date inside the target week; we derive the Mon–Sun window and clamp to the schedule.
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // 0 = Monday … 6 = Sunday. Empty clears the crew member from this cell for the week.
  weekdays: z.array(z.number().int().min(0).max(6)).max(7)
});

const scheduleRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  department: z.string().nullable(),
  start_date: z.string(),
  end_date: z.string(),
  status: z.enum(SCHEDULE_STATUSES)
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function isoToUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function utcDateToIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Monday (0) … Sunday (6) index for an ISO date. */
function weekdayIndex(iso: string): number {
  const day = isoToUtcDate(iso).getUTCDay(); // 0=Sun..6=Sat
  return (day + 6) % 7;
}

/** Mon–Sun ISO dates of the week containing `iso`. */
function weekDates(iso: string): string[] {
  const base = isoToUtcDate(iso);
  const monday = new Date(base);
  monday.setUTCDate(monday.getUTCDate() - weekdayIndex(iso));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() + i);
    return utcDateToIso(d);
  });
}

/** Build full ISO start/end timestamps for a date + HH:MM slot, rolling end past midnight. */
function toShiftDateTimes(
  shiftDate: string,
  startTime: string,
  endTime: string
): { startTime: string; endTime: string } {
  const start = new Date(`${shiftDate}T${startTime}:00.000Z`);
  const end = new Date(`${shiftDate}T${endTime}:00.000Z`);
  if (end <= start) {
    end.setUTCDate(end.getUTCDate() + 1);
  }
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

function timesMatchSlot(
  rowStart: string,
  rowEnd: string,
  slotStart: string,
  slotEnd: string
): boolean {
  return extractIsoTime(rowStart) === slotStart && extractIsoTime(rowEnd) === slotEnd;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in to edit schedules." },
      meta: buildMeta()
    });
  }

  if (!(await checkApiAccess("/scheduling", session.profile))) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "You do not have access to scheduling." },
      meta: buildMeta()
    });
  }

  if (!isSchedulingManager(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only managers and admins can edit schedules." },
      meta: buildMeta()
    });
  }

  const { id: scheduleId } = await context.params;

  if (!z.string().uuid().safeParse(scheduleId).success) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: "Schedule id must be a valid UUID." },
      meta: buildMeta()
    });
  }

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

  const parsed = gridCellSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid grid cell payload."
      },
      meta: buildMeta()
    });
  }

  const { employeeId, slot, weekStart, weekdays } = parsed.data;
  const orgId = session.profile.org_id;
  const supabase = createSupabaseServiceRoleClient();

  const { data: scheduleRaw, error: scheduleError } = await supabase
    .from("schedules")
    .select("id, org_id, department, start_date, end_date, status")
    .eq("id", scheduleId)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  const schedule = scheduleRaw ? scheduleRowSchema.safeParse(scheduleRaw) : null;
  if (scheduleError || !schedule?.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "SCHEDULE_NOT_FOUND", message: "Schedule was not found." },
      meta: buildMeta()
    });
  }

  if (schedule.data.status === "locked") {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "SCHEDULE_LOCKED", message: "This schedule is locked and cannot be edited." },
      meta: buildMeta()
    });
  }

  // Team leads may only edit schedules in their own department.
  if (isDepartmentOnlyTeamLead(session.profile.roles)) {
    if (!session.profile.department) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "TEAM_LEAD_DEPARTMENT_REQUIRED",
          message: "Team lead scheduling requires a department on your profile."
        },
        meta: buildMeta()
      });
    }
    if (!areDepartmentsEqual(schedule.data.department, session.profile.department)) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "Team lead can only edit schedules in their own department."
        },
        meta: buildMeta()
      });
    }
  }

  // Resolve the target dates: selected weekdays within this week, clamped to the schedule range.
  const allWeekDates = weekDates(weekStart);
  const inRange = (iso: string) =>
    iso >= schedule.data.start_date && iso <= schedule.data.end_date;
  const weekRangeDates = allWeekDates.filter(inRange);
  const targetDates = weekdays
    .map((d) => allWeekDates[d])
    .filter((iso): iso is string => Boolean(iso) && inRange(iso));

  if (weekRangeDates.length === 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "WEEK_OUT_OF_RANGE",
        message: "That week falls outside this schedule's date range."
      },
      meta: buildMeta()
    });
  }

  const now = new Date().toISOString();

  // 1) Clear this crew member's existing shifts for THIS slot across the in-range week,
  //    so the cell ends up reflecting exactly the selected weekdays.
  const { data: existingRows, error: existingError } = await supabase
    .from("shifts")
    .select("id, shift_date, start_time, end_time")
    .eq("org_id", orgId)
    .eq("schedule_id", scheduleId)
    .eq("employee_id", employeeId)
    .in("shift_date", weekRangeDates)
    .is("deleted_at", null)
    .neq("status", "cancelled");

  if (existingError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "GRID_FETCH_FAILED", message: "Unable to load existing shifts for this cell." },
      meta: buildMeta()
    });
  }

  const slotRowIds = (existingRows ?? [])
    .filter(
      (row) =>
        typeof row.start_time === "string" &&
        typeof row.end_time === "string" &&
        timesMatchSlot(row.start_time, row.end_time, slot.startTime, slot.endTime)
    )
    .map((row) => row.id as string);

  if (slotRowIds.length > 0) {
    await supabase
      .from("shift_swaps")
      .update({ deleted_at: now })
      .eq("org_id", orgId)
      .in("shift_id", slotRowIds)
      .is("deleted_at", null);

    const { error: clearError } = await supabase
      .from("shifts")
      .update({ deleted_at: now, status: "cancelled" })
      .eq("org_id", orgId)
      .in("id", slotRowIds);

    if (clearError) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "GRID_CLEAR_FAILED", message: "Unable to update this cell." },
        meta: buildMeta()
      });
    }
  }

  // 2) Insert the selected weekdays.
  let createdCount = 0;
  if (targetDates.length > 0) {
    const rows = targetDates.map((shiftDate) => {
      const times = toShiftDateTimes(shiftDate, slot.startTime, slot.endTime);
      return {
        org_id: orgId,
        schedule_id: scheduleId,
        employee_id: employeeId,
        shift_date: shiftDate,
        start_time: times.startTime,
        end_time: times.endTime,
        break_minutes: 0,
        status: "scheduled" as const,
        notes: slot.name
      };
    });

    const { error: insertError } = await supabase.from("shifts").insert(rows);
    if (insertError) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "GRID_INSERT_FAILED", message: "Unable to save this cell." },
        meta: buildMeta()
      });
    }
    createdCount = rows.length;
  }

  // 3) Advisory, non-blocking warnings.
  const warnings: string[] = [];

  if (targetDates.length > 0) {
    // (a) Time off intersecting any selected day.
    const { data: leaveRows } = await supabase
      .from("leave_requests")
      .select("status, start_date, end_date")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .in("status", ["approved", "pending"])
      .lte("start_date", targetDates[targetDates.length - 1])
      .gte("end_date", targetDates[0])
      .is("deleted_at", null);

    const overlapsLeave = (leaveRows ?? []).some((row) =>
      targetDates.some(
        (d) =>
          typeof row.start_date === "string" &&
          typeof row.end_date === "string" &&
          d >= row.start_date &&
          d <= row.end_date
      )
    );
    if (overlapsLeave) {
      const approved = (leaveRows ?? []).some((row) => row.status === "approved");
      warnings.push(
        approved
          ? "This crew member has approved time off during this week."
          : "This crew member has a pending time-off request during this week."
      );
    }

    // (b) A different slot on the same day at an overlapping time.
    const { data: otherRows } = await supabase
      .from("shifts")
      .select("shift_date, start_time, end_time")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .in("shift_date", targetDates)
      .is("deleted_at", null)
      .neq("status", "cancelled");

    const hasDoubleBooking = (otherRows ?? []).some(
      (row) =>
        typeof row.start_time === "string" &&
        typeof row.end_time === "string" &&
        !timesMatchSlot(row.start_time, row.end_time, slot.startTime, slot.endTime)
    );
    if (hasDoubleBooking) {
      warnings.push("This crew member is already on another shift on one of these days.");
    }
  }

  void logAudit({
    action: "updated",
    tableName: "shifts",
    recordId: scheduleId,
    oldValue: { slot: slot.name, employee_id: employeeId },
    newValue: { weekdays, created: createdCount, removed: slotRowIds.length }
  });

  return jsonResponse<{ created: number; removed: number; warnings: string[] }>(200, {
    data: { created: createdCount, removed: slotRowIds.length, warnings },
    error: null,
    meta: buildMeta()
  });
}
