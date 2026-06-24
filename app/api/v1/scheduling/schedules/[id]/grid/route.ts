import { NextResponse } from "next/server";
import { z } from "zod";

import { checkApiAccess } from "../../../../../../../lib/auth/check-api-access";
import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { areDepartmentsEqual } from "../../../../../../../lib/department";
import { isDepartmentOnlyTeamLead } from "../../../../../../../lib/roles";
import { areTimeRangesOverlapping, extractIsoTime, isSchedulingManager } from "../../../../../../../lib/scheduling";
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
  // SCHED-03: deduplicate weekdays so a repeated index can't produce duplicate
  // shifts for the same day.
  weekdays: z
    .array(z.number().int().min(0).max(6))
    .max(7)
    .transform((days) => [...new Set(days)]),
  // SCHED-03/04: optional optimistic-concurrency guard. The IDs the client
  // believes currently fill this cell; a mismatch means a concurrent edit won.
  expectedShiftIds: z.array(z.string().uuid()).max(7).optional()
});

/** Employee eligibility for a service-role grid write (SCHED-03). */
const eligibleEmployeeSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  status: z.string().nullable()
});
const SCHEDULING_ELIGIBLE_STATUSES = new Set(["active", "onboarding"]);

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

/**
 * Returns approved time off overlapping this schedule's date range, so the grid can flag
 * who's away that week. Scoped to the org and the schedule's range — independent of the
 * viewer's own department (which is what made team-availability the wrong source here).
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedSession();
  if (!session?.profile) {
    return jsonResponse<null>(401, { data: null, error: { code: "UNAUTHORIZED", message: "You must be logged in." }, meta: buildMeta() });
  }
  if (!(await checkApiAccess("/scheduling", session.profile)) || !isSchedulingManager(session.profile.roles)) {
    return jsonResponse<null>(403, { data: null, error: { code: "FORBIDDEN", message: "You do not have access to scheduling." }, meta: buildMeta() });
  }

  const { id: scheduleId } = await context.params;
  if (!z.string().uuid().safeParse(scheduleId).success) {
    return jsonResponse<null>(422, { data: null, error: { code: "VALIDATION_ERROR", message: "Schedule id must be a valid UUID." }, meta: buildMeta() });
  }

  const supabase = createSupabaseServiceRoleClient();
  const { data: scheduleRaw } = await supabase
    .from("schedules")
    .select("id, start_date, end_date")
    .eq("id", scheduleId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!scheduleRaw?.start_date || !scheduleRaw?.end_date) {
    return jsonResponse<null>(404, { data: null, error: { code: "SCHEDULE_NOT_FOUND", message: "Schedule was not found." }, meta: buildMeta() });
  }

  const { data: leaveRows } = await supabase
    .from("leave_requests")
    .select("employee_id, start_date, end_date")
    .eq("org_id", session.profile.org_id)
    .eq("status", "approved")
    .lte("start_date", scheduleRaw.end_date)
    .gte("end_date", scheduleRaw.start_date)
    .is("deleted_at", null);

  const leave = (leaveRows ?? [])
    .filter((r) => typeof r.employee_id === "string" && typeof r.start_date === "string" && typeof r.end_date === "string")
    .map((r) => ({ employeeId: r.employee_id as string, start: r.start_date as string, end: r.end_date as string }));

  return jsonResponse<{ leave: Array<{ employeeId: string; start: string; end: string }> }>(200, {
    data: { leave },
    error: null,
    meta: buildMeta()
  });
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

  // SCHED-03: prove the target employee is an eligible member of THIS schedule's
  // org before any service-role write — never trust the client-supplied UUID.
  const { data: employeeRaw, error: employeeError } = await supabase
    .from("profiles")
    .select("id, org_id, status")
    .eq("id", employeeId)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  const employee = employeeRaw ? eligibleEmployeeSchema.safeParse(employeeRaw) : null;

  if (employeeError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "EMPLOYEE_LOOKUP_FAILED", message: "Unable to verify the crew member." },
      meta: buildMeta()
    });
  }

  if (!employee?.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "EMPLOYEE_NOT_FOUND", message: "Crew member is not part of this organization." },
      meta: buildMeta()
    });
  }

  if (!SCHEDULING_ELIGIBLE_STATUSES.has(employee.data.status ?? "")) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "EMPLOYEE_NOT_ELIGIBLE",
        message: "Only active or onboarding crew members can be scheduled."
      },
      meta: buildMeta()
    });
  }

  // Team leads may only schedule crew members from their own department.
  if (isDepartmentOnlyTeamLead(session.profile.roles)) {
    const { data: employeeDeptRow } = await supabase
      .from("profiles")
      .select("department")
      .eq("id", employeeId)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!areDepartmentsEqual(employeeDeptRow?.department ?? null, session.profile.department)) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "Team leads can only schedule crew members from their own department."
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

  // SCHED-03: clear-old + insert-new + swap cleanup happen in ONE atomic RPC, so
  // an insert failure can never lose the old cell, and concurrent saves to the
  // same cell are serialized (FOR UPDATE). An optional expected-id guard returns
  // a stale-cell conflict when a competing edit changed the cell first.
  const { data: rpcResult, error: rpcError } = await supabase.rpc("replace_schedule_grid_cell", {
    p_org_id: orgId,
    p_schedule_id: scheduleId,
    p_employee_id: employeeId,
    p_slot_start: slot.startTime,
    p_slot_end: slot.endTime,
    p_slot_name: slot.name,
    p_week_dates: weekRangeDates,
    p_target_dates: targetDates,
    p_expected_shift_ids: parsed.data.expectedShiftIds ?? null
  });

  if (rpcError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "GRID_SAVE_FAILED", message: "Unable to save this cell." },
      meta: buildMeta()
    });
  }

  const rpcData = (rpcResult ?? {}) as Record<string, unknown>;

  if (typeof rpcData.error === "string") {
    if (rpcData.error === "STALE_CELL") {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "GRID_CELL_CONFLICT",
          message: "This cell changed since you loaded it. Refresh and try again."
        },
        meta: buildMeta()
      });
    }
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "GRID_SAVE_REJECTED", message: rpcData.error },
      meta: buildMeta()
    });
  }

  const createdCount = typeof rpcData.created === "number" ? rpcData.created : 0;
  const removedCount = typeof rpcData.removed === "number" ? rpcData.removed : 0;

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

    // (b) Another shift on the same day whose actual time interval OVERLAPS the
    //     new shift. SCHED-03: a different, non-overlapping slot is NOT a double
    //     booking; use real interval overlap (handles overnight, where the end
    //     rolls past midnight). Same-slot rows (what we just wrote) are skipped.
    const { data: otherRows } = await supabase
      .from("shifts")
      .select("shift_date, start_time, end_time")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .in("shift_date", targetDates)
      .is("deleted_at", null)
      .neq("status", "cancelled");

    const hasDoubleBooking = (otherRows ?? []).some((row) => {
      if (typeof row.start_time !== "string" || typeof row.end_time !== "string") {
        return false;
      }
      if (timesMatchSlot(row.start_time, row.end_time, slot.startTime, slot.endTime)) {
        return false; // same slot — not a conflict
      }
      const shiftDate = typeof row.shift_date === "string" ? row.shift_date : null;
      if (!shiftDate) return false;
      const newTimes = toShiftDateTimes(shiftDate, slot.startTime, slot.endTime);
      return areTimeRangesOverlapping({
        startA: newTimes.startTime,
        endA: newTimes.endTime,
        startB: row.start_time,
        endB: row.end_time
      });
    });
    if (hasDoubleBooking) {
      warnings.push("This crew member is already on another shift on one of these days.");
    }
  }

  void logAudit({
    action: "updated",
    tableName: "shifts",
    recordId: scheduleId,
    oldValue: { slot: slot.name, employee_id: employeeId },
    newValue: { weekdays, created: createdCount, removed: removedCount }
  });

  return jsonResponse<{ created: number; removed: number; warnings: string[] }>(200, {
    data: { created: createdCount, removed: removedCount, warnings },
    error: null,
    meta: buildMeta()
  });
}
