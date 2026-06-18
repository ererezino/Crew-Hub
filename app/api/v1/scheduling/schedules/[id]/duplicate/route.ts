import { NextResponse } from "next/server";
import { z } from "zod";

import { checkApiAccess } from "../../../../../../../lib/auth/check-api-access";
import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { areDepartmentsEqual } from "../../../../../../../lib/department";
import { isDepartmentOnlyTeamLead } from "../../../../../../../lib/roles";
import { extractIsoTime, isIsoDate, isSchedulingManager } from "../../../../../../../lib/scheduling";
import { buildWeeks, gridWeekdayIndex } from "../../../../../../../lib/scheduling/week-grid";
import { createSupabaseServiceRoleClient } from "../../../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../../../types/auth";
import { SCHEDULE_STATUSES, type SchedulingScheduleMutationResponseData } from "../../../../../../../types/scheduling";

/**
 * Duplicate a schedule onto a NEW date range — "use an existing schedule as a template".
 * Clones the source's shift pattern (who works which slot on which weekday) week-by-week:
 * source week i maps to target week i (cycling the source if the target is longer). The new
 * schedule is created as a draft so the team lead can tweak it in the grid before publishing.
 */

const bodySchema = z
  .object({
    name: z.string().trim().max(200).optional(),
    startDate: z.string().refine(isIsoDate, "startDate must be YYYY-MM-DD."),
    endDate: z.string().refine(isIsoDate, "endDate must be YYYY-MM-DD.")
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "endDate must be on or after startDate.",
    path: ["endDate"]
  });

const scheduleRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  name: z.string().nullable(),
  department: z.string().nullable(),
  start_date: z.string(),
  end_date: z.string(),
  schedule_track: z.string().nullable(),
  status: z.enum(SCHEDULE_STATUSES)
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}
function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}
function isoToUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
function addDaysIso(iso: string, n: number): string {
  const d = isoToUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Full ISO start/end timestamps for a date + HH:MM, rolling end past midnight. */
function toShiftDateTimes(shiftDate: string, startHHMM: string, endHHMM: string) {
  const start = new Date(`${shiftDate}T${startHHMM}:00.000Z`);
  const end = new Date(`${shiftDate}T${endHHMM}:00.000Z`);
  if (end <= start) end.setUTCDate(end.getUTCDate() + 1);
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedSession();
  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in to duplicate schedules." },
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
      error: { code: "FORBIDDEN", message: "Only managers and admins can duplicate schedules." },
      meta: buildMeta()
    });
  }

  const { id: sourceId } = await context.params;
  if (!z.string().uuid().safeParse(sourceId).success) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: "Schedule id must be a valid UUID." },
      meta: buildMeta()
    });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Request body must be valid JSON." },
      meta: buildMeta()
    });
  }
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid payload." },
      meta: buildMeta()
    });
  }

  const orgId = session.profile.org_id;
  const supabase = createSupabaseServiceRoleClient();

  // Load source schedule.
  const { data: rawSource, error: sourceError } = await supabase
    .from("schedules")
    .select("id, org_id, name, department, start_date, end_date, schedule_track, status")
    .eq("id", sourceId)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  const source = rawSource ? scheduleRowSchema.safeParse(rawSource) : null;
  if (sourceError || !source?.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "SCHEDULE_NOT_FOUND", message: "Source schedule was not found." },
      meta: buildMeta()
    });
  }

  // Team leads may only duplicate within their own department.
  if (isDepartmentOnlyTeamLead(session.profile.roles)) {
    if (!session.profile.department) {
      return jsonResponse<null>(422, {
        data: null,
        error: { code: "TEAM_LEAD_DEPARTMENT_REQUIRED", message: "Team lead scheduling requires a department on your profile." },
        meta: buildMeta()
      });
    }
    if (!areDepartmentsEqual(source.data.department, session.profile.department)) {
      return jsonResponse<null>(403, {
        data: null,
        error: { code: "FORBIDDEN", message: "Team lead can only duplicate schedules in their own department." },
        meta: buildMeta()
      });
    }
  }

  // Load the source's shifts (the pattern to clone).
  const { data: rawShifts, error: shiftsError } = await supabase
    .from("shifts")
    .select("employee_id, shift_date, start_time, end_time, break_minutes, notes")
    .eq("org_id", orgId)
    .eq("schedule_id", sourceId)
    .is("deleted_at", null)
    .neq("status", "cancelled");

  if (shiftsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "SOURCE_SHIFTS_FETCH_FAILED", message: "Unable to load the source schedule's shifts." },
      meta: buildMeta()
    });
  }

  // Group source shifts by their week index (within the source range) and weekday.
  const sourceWeeks = buildWeeks(source.data.start_date, source.data.end_date);
  const sourceWeekStartToIndex = new Map(sourceWeeks.map((w) => [w.weekStart, w.index] as const));
  const mondayOfIso = (iso: string) => addDaysIso(iso, -gridWeekdayIndex(iso));

  type PatternEntry = {
    weekday: number;
    employeeId: string | null;
    startHHMM: string;
    endHHMM: string;
    breakMinutes: number;
    notes: string | null;
  };
  const patternByWeek = new Map<number, PatternEntry[]>();

  for (const row of rawShifts ?? []) {
    if (typeof row.shift_date !== "string" || typeof row.start_time !== "string" || typeof row.end_time !== "string") {
      continue;
    }
    const weekIndex = sourceWeekStartToIndex.get(mondayOfIso(row.shift_date));
    if (weekIndex === undefined) continue;
    const list = patternByWeek.get(weekIndex) ?? [];
    list.push({
      weekday: gridWeekdayIndex(row.shift_date),
      employeeId: typeof row.employee_id === "string" ? row.employee_id : null,
      startHHMM: extractIsoTime(row.start_time),
      endHHMM: extractIsoTime(row.end_time),
      breakMinutes: typeof row.break_minutes === "number" ? row.break_minutes : Number(row.break_minutes) || 0,
      notes: typeof row.notes === "string" ? row.notes : null
    });
    patternByWeek.set(weekIndex, list);
  }

  // Create the new draft schedule.
  const newName = parsed.data.name?.trim() || `${source.data.name ?? "Schedule"} (copy)`;
  const { data: createdSchedule, error: createError } = await supabase
    .from("schedules")
    .insert({
      org_id: orgId,
      name: newName,
      department: source.data.department,
      start_date: parsed.data.startDate,
      end_date: parsed.data.endDate,
      schedule_track: source.data.schedule_track,
      status: "draft"
    })
    .select("id, org_id, name, department, start_date, end_date, schedule_track, status, published_at, published_by, created_at, updated_at")
    .single();

  if (createError || !createdSchedule) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "SCHEDULE_CREATE_FAILED", message: "Unable to create the new schedule." },
      meta: buildMeta()
    });
  }

  const newScheduleId = createdSchedule.id as string;

  // Copy the roster (so the new schedule's crew list matches the source).
  const { data: rosterRows } = await supabase
    .from("schedule_roster")
    .select("employee_id, weekend_hours")
    .eq("schedule_id", sourceId);

  if ((rosterRows ?? []).length > 0) {
    await supabase.from("schedule_roster").insert(
      (rosterRows ?? []).map((r) => ({
        schedule_id: newScheduleId,
        employee_id: r.employee_id,
        weekend_hours: r.weekend_hours
      }))
    );
  }

  // Remap the pattern onto the new weeks (source week i → target week i, cycling).
  const targetWeeks = buildWeeks(parsed.data.startDate, parsed.data.endDate);
  const newShiftRows: Array<Record<string, unknown>> = [];

  if (sourceWeeks.length > 0) {
    for (const targetWeek of targetWeeks) {
      const sourceEntries = patternByWeek.get(targetWeek.index % sourceWeeks.length) ?? [];
      for (const entry of sourceEntries) {
        const shiftDate = addDaysIso(targetWeek.weekStart, entry.weekday);
        if (shiftDate < parsed.data.startDate || shiftDate > parsed.data.endDate) continue;
        const times = toShiftDateTimes(shiftDate, entry.startHHMM, entry.endHHMM);
        newShiftRows.push({
          org_id: orgId,
          schedule_id: newScheduleId,
          employee_id: entry.employeeId,
          shift_date: shiftDate,
          start_time: times.startTime,
          end_time: times.endTime,
          break_minutes: entry.breakMinutes,
          status: "scheduled",
          notes: entry.notes
        });
      }
    }
  }

  let copiedShifts = 0;
  if (newShiftRows.length > 0) {
    const { error: insertError } = await supabase.from("shifts").insert(newShiftRows);
    if (insertError) {
      // The schedule was created; surface the partial failure clearly.
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "SHIFT_COPY_FAILED", message: "The new schedule was created but its shifts could not be copied." },
        meta: buildMeta()
      });
    }
    copiedShifts = newShiftRows.length;
  }

  void logAudit({
    action: "created",
    tableName: "schedules",
    recordId: newScheduleId,
    oldValue: { duplicated_from: sourceId },
    newValue: { name: newName, start_date: parsed.data.startDate, end_date: parsed.data.endDate, copied_shifts: copiedShifts }
  });

  return jsonResponse<SchedulingScheduleMutationResponseData>(201, {
    data: {
      schedule: {
        id: newScheduleId,
        orgId,
        name: createdSchedule.name as string | null,
        department: createdSchedule.department as string | null,
        startDate: createdSchedule.start_date as string,
        endDate: createdSchedule.end_date as string,
        scheduleTrack: (createdSchedule.schedule_track as "weekday" | "weekend") ?? "weekday",
        status: "draft",
        publishedAt: null,
        publishedBy: null,
        publishedByName: null,
        createdAt: createdSchedule.created_at as string,
        updatedAt: createdSchedule.updated_at as string,
        shiftCount: copiedShifts
      }
    },
    error: null,
    meta: buildMeta()
  });
}
