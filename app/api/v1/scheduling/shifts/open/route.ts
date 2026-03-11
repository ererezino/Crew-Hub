import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { parseInteger } from "../../../../../../lib/scheduling";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../../types/auth";
import {
  SHIFT_STATUSES,
  type SchedulingShiftsResponseData,
  type ShiftRecord
} from "../../../../../../types/scheduling";

const querySchema = z.object({
  startDate: z
    .string()
    .trim()
    .refine((value) => value.length === 0 || /^\d{4}-\d{2}-\d{2}$/.test(value), "startDate must be YYYY-MM-DD.")
    .optional(),
  endDate: z
    .string()
    .trim()
    .refine((value) => value.length === 0 || /^\d{4}-\d{2}-\d{2}$/.test(value), "endDate must be YYYY-MM-DD.")
    .optional(),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
  limit: z.coerce.number().int().min(1).max(300).default(120)
});

const shiftRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  schedule_id: z.string().uuid(),
  template_id: z.string().uuid().nullable(),
  employee_id: z.string().uuid().nullable(),
  shift_date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  break_minutes: z.union([z.number(), z.string()]),
  status: z.enum(SHIFT_STATUSES),
  notes: z.string().nullable(),
  color: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const scheduleRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  department: z.string().nullable()
});

const templateRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string()
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
        message: "You must be logged in to view open shifts."
      },
      meta: buildMeta()
    });
  }

  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid open shifts query."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;
  const supabase = await createSupabaseServerClient();

  let shiftsQuery = supabase
    .from("shifts")
    .select(
      "id, org_id, schedule_id, template_id, employee_id, shift_date, start_time, end_time, break_minutes, status, notes, color, created_at, updated_at"
    )
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .is("employee_id", null)
    .neq("status", "cancelled")
    .order("shift_date", { ascending: query.sortDir === "asc" })
    .order("start_time", { ascending: query.sortDir === "asc" })
    .limit(query.limit);

  if (query.startDate && query.startDate.length > 0) {
    shiftsQuery = shiftsQuery.gte("shift_date", query.startDate);
  }

  if (query.endDate && query.endDate.length > 0) {
    shiftsQuery = shiftsQuery.lte("shift_date", query.endDate);
  }

  const { data: rawRows, error } = await shiftsQuery;

  if (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "OPEN_SHIFTS_FETCH_FAILED",
        message: "Unable to load open shifts."
      },
      meta: buildMeta()
    });
  }

  const parsedRows = z.array(shiftRowSchema).safeParse(rawRows ?? []);

  if (!parsedRows.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "OPEN_SHIFTS_PARSE_FAILED",
        message: "Open shifts data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const scheduleIds = [...new Set(parsedRows.data.map((row) => row.schedule_id))];
  const templateIds = [
    ...new Set(
      parsedRows.data.map((row) => row.template_id).filter((value): value is string => Boolean(value))
    )
  ];

  const [scheduleResult, templateResult] = await Promise.all([
    scheduleIds.length > 0
      ? supabase
          .from("schedules")
          .select("id, name, department")
          .eq("org_id", session.profile.org_id)
          .is("deleted_at", null)
          .in("id", scheduleIds)
      : Promise.resolve({ data: [], error: null }),
    templateIds.length > 0
      ? supabase
          .from("shift_templates")
          .select("id, name")
          .eq("org_id", session.profile.org_id)
          .is("deleted_at", null)
          .in("id", templateIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (scheduleResult.error || templateResult.error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "OPEN_SHIFTS_METADATA_FETCH_FAILED",
        message: "Unable to resolve open shift metadata."
      },
      meta: buildMeta()
    });
  }

  const parsedScheduleRows = z.array(scheduleRowSchema).safeParse(scheduleResult.data ?? []);
  const parsedTemplateRows = z.array(templateRowSchema).safeParse(templateResult.data ?? []);

  if (!parsedScheduleRows.success || !parsedTemplateRows.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "OPEN_SHIFTS_METADATA_PARSE_FAILED",
        message: "Open shift metadata is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const scheduleById = new Map(parsedScheduleRows.data.map((row) => [row.id, row] as const));
  const templateNameById = new Map(parsedTemplateRows.data.map((row) => [row.id, row.name] as const));

  const departmentFilter = session.profile.department?.trim() || null;

  const shifts: ShiftRecord[] = parsedRows.data
    .filter((row) => {
      if (!departmentFilter) {
        return true;
      }

      const schedule = scheduleById.get(row.schedule_id);
      if (!schedule?.department || schedule.department.trim().length === 0) {
        return true;
      }

      return schedule.department.toLowerCase() === departmentFilter.toLowerCase();
    })
    .map((row) => ({
      id: row.id,
      orgId: row.org_id,
      scheduleId: row.schedule_id,
      scheduleName: scheduleById.get(row.schedule_id)?.name ?? null,
      templateId: row.template_id,
      templateName: row.template_id ? templateNameById.get(row.template_id) ?? null : null,
      employeeId: null,
      employeeName: null,
      employeeDepartment: null,
      employeeCountryCode: null,
      shiftDate: row.shift_date,
      startTime: row.start_time,
      endTime: row.end_time,
      breakMinutes: parseInteger(row.break_minutes),
      status: row.status,
      notes: row.notes,
      color: row.color,
      isOpenShift: true,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

  return jsonResponse<SchedulingShiftsResponseData>(200, {
    data: {
      shifts
    },
    error: null,
    meta: buildMeta()
  });
}
