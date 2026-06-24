import { NextResponse } from "next/server";
import { z } from "zod";

import { checkApiAccess } from "../../../../../../../lib/auth/check-api-access";
import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { areDepartmentsEqual } from "../../../../../../../lib/department";
import { isDepartmentOnlyTeamLead } from "../../../../../../../lib/roles";
import {
  extractIsoTime,
  isIsoDate,
  isScheduleWithinMaxLength,
  isSchedulingManager,
  MAX_SCHEDULE_LENGTH_DAYS
} from "../../../../../../../lib/scheduling";
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
    endDate: z.string().refine(isIsoDate, "endDate must be YYYY-MM-DD."),
    // SCHED-06: optional stable key so a retried duplication is idempotent
    // (a second call with the same key returns the schedule already created).
    operationKey: z.string().trim().min(1).max(100).optional()
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

  // SCHED-05/06: the duplicate's target range must respect the product max length.
  if (!isScheduleWithinMaxLength(parsed.data.startDate, parsed.data.endDate)) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "SCHEDULE_TOO_LONG",
        message: `A schedule cannot be longer than ${MAX_SCHEDULE_LENGTH_DAYS} days.`
      },
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

  // Load the source's shifts (the pattern to clone). SCHED-06: include
  // template_id and color so duplication preserves them.
  const { data: rawShifts, error: shiftsError } = await supabase
    .from("shifts")
    .select("employee_id, template_id, shift_date, start_time, end_time, break_minutes, notes, color")
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
    templateId: string | null;
    startHHMM: string;
    endHHMM: string;
    breakMinutes: number;
    notes: string | null;
    color: string | null;
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
      templateId: typeof row.template_id === "string" ? row.template_id : null,
      startHHMM: extractIsoTime(row.start_time),
      endHHMM: extractIsoTime(row.end_time),
      breakMinutes: typeof row.break_minutes === "number" ? row.break_minutes : Number(row.break_minutes) || 0,
      notes: typeof row.notes === "string" ? row.notes : null,
      color: typeof row.color === "string" ? row.color : null
    });
    patternByWeek.set(weekIndex, list);
  }

  const newName = parsed.data.name?.trim() || `${source.data.name ?? "Schedule"} (copy)`;

  // Copy the source roster so the new schedule's crew list matches.
  const { data: rosterRows } = await supabase
    .from("schedule_roster")
    .select("employee_id, weekend_hours")
    .eq("schedule_id", sourceId);

  const rosterPayload = (rosterRows ?? [])
    .filter((r) => typeof r.employee_id === "string")
    .map((r) => ({
      employee_id: r.employee_id as string,
      weekend_hours: typeof r.weekend_hours === "string" ? r.weekend_hours : null
    }));

  // Remap the pattern onto the new weeks (source week i → target week i, cycling).
  const targetWeeks = buildWeeks(parsed.data.startDate, parsed.data.endDate);
  const shiftPayload: Array<Record<string, unknown>> = [];

  if (sourceWeeks.length > 0) {
    for (const targetWeek of targetWeeks) {
      const sourceEntries = patternByWeek.get(targetWeek.index % sourceWeeks.length) ?? [];
      for (const entry of sourceEntries) {
        const shiftDate = addDaysIso(targetWeek.weekStart, entry.weekday);
        if (shiftDate < parsed.data.startDate || shiftDate > parsed.data.endDate) continue;
        const times = toShiftDateTimes(shiftDate, entry.startHHMM, entry.endHHMM);
        shiftPayload.push({
          employee_id: entry.employeeId,
          template_id: entry.templateId,
          shift_date: shiftDate,
          start_time: times.startTime,
          end_time: times.endTime,
          break_minutes: entry.breakMinutes,
          notes: entry.notes,
          color: entry.color
        });
      }
    }
  }

  // SCHED-06: create schedule + roster + shifts in ONE transaction. Any failure
  // rolls everything back (no orphan/partial draft). Cross-org employee ids are
  // rejected inside the RPC. An optional operation key makes retries idempotent.
  const { data: rpcResult, error: rpcError } = await supabase.rpc("duplicate_schedule", {
    p_org_id: orgId,
    p_name: newName,
    p_department: source.data.department,
    p_start_date: parsed.data.startDate,
    p_end_date: parsed.data.endDate,
    p_schedule_track: source.data.schedule_track ?? "weekday",
    p_roster: rosterPayload,
    p_shifts: shiftPayload,
    p_op_key: parsed.data.operationKey ?? null
  });

  if (rpcError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "SCHEDULE_DUPLICATE_FAILED", message: "Unable to duplicate the schedule." },
      meta: buildMeta()
    });
  }

  const rpcData = (rpcResult ?? {}) as Record<string, unknown>;

  if (rpcData.error === "CROSS_ORG_EMPLOYEE") {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "CROSS_ORG_EMPLOYEE",
        message: "The source schedule references crew members outside this organization."
      },
      meta: buildMeta()
    });
  }

  const createdSchedule = rpcData.schedule as Record<string, unknown> | undefined;
  if (!createdSchedule?.id) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "SCHEDULE_DUPLICATE_FAILED", message: "Unable to duplicate the schedule." },
      meta: buildMeta()
    });
  }

  const newScheduleId = createdSchedule.id as string;
  const copiedShifts = shiftPayload.length;

  void logAudit({
    action: "created",
    tableName: "schedules",
    recordId: newScheduleId,
    oldValue: { duplicated_from: sourceId },
    newValue: {
      name: newName,
      start_date: parsed.data.startDate,
      end_date: parsed.data.endDate,
      copied_shifts: copiedShifts,
      idempotent: rpcData.idempotent === true
    }
  });

  return jsonResponse<SchedulingScheduleMutationResponseData>(201, {
    data: {
      schedule: {
        id: newScheduleId,
        orgId,
        name: (createdSchedule.name as string | null) ?? null,
        department: (createdSchedule.department as string | null) ?? null,
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
