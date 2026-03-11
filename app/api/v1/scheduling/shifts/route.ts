import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { logAudit } from "../../../../../lib/audit";
import { areDepartmentsEqual } from "../../../../../lib/department";
import { isDepartmentScopedTeamLead } from "../../../../../lib/roles";
import {
  areTimeRangesOverlapping,
  canViewTeamSchedules,
  combineDateAndTimeRange,
  isIsoDate,
  isIsoTime,
  isSchedulingManager,
  parseInteger
} from "../../../../../lib/scheduling";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import {
  SHIFT_STATUSES,
  type SchedulingShiftMutationResponseData,
  type SchedulingShiftsResponseData,
  type ShiftRecord
} from "../../../../../types/scheduling";

const querySchema = z.object({
  scope: z.enum(["mine", "team", "open"]).default("mine"),
  scheduleId: z.string().uuid().optional(),
  startDate: z
    .string()
    .trim()
    .refine((value) => value.length === 0 || isIsoDate(value), "startDate must be YYYY-MM-DD.")
    .optional(),
  endDate: z
    .string()
    .trim()
    .refine((value) => value.length === 0 || isIsoDate(value), "endDate must be YYYY-MM-DD.")
    .optional(),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
  limit: z.coerce.number().int().min(1).max(2000).default(240)
});

const createShiftSchema = z.object({
  scheduleId: z.string().uuid("scheduleId must be a valid UUID."),
  templateId: z.string().uuid("templateId must be a valid UUID.").optional(),
  employeeId: z.string().uuid("employeeId must be a valid UUID.").optional().nullable(),
  shiftDate: z.string().trim().refine((value) => isIsoDate(value), "shiftDate must be YYYY-MM-DD."),
  startTime: z.string().trim().refine((value) => isIsoTime(value), "startTime must be HH:MM."),
  endTime: z.string().trim().refine((value) => isIsoTime(value), "endTime must be HH:MM."),
  breakMinutes: z.coerce.number().int().min(0).max(240).default(0),
  notes: z.string().trim().max(2000).optional(),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a hex value such as #4A0039.")
    .optional()
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
  name: z.string().nullable()
});

const templateRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string()
});

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  department: z.string().nullable(),
  country_code: z.string().nullable()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function dateWindowForConflictCheck(isoDate: string): string[] {
  const current = new Date(`${isoDate}T00:00:00Z`);

  if (!Number.isFinite(current.getTime())) {
    return [isoDate];
  }

  const prev = new Date(current);
  prev.setUTCDate(prev.getUTCDate() - 1);
  const next = new Date(current);
  next.setUTCDate(next.getUTCDate() + 1);

  return [
    prev.toISOString().slice(0, 10),
    current.toISOString().slice(0, 10),
    next.toISOString().slice(0, 10)
  ];
}

async function mapShiftRows({
  supabase,
  rows,
  orgId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  rows: z.infer<typeof shiftRowSchema>[];
  orgId: string;
}): Promise<ShiftRecord[]> {
  if (rows.length === 0) {
    return [];
  }

  const scheduleIds = [...new Set(rows.map((row) => row.schedule_id))];
  const templateIds = [
    ...new Set(
      rows.map((row) => row.template_id).filter((value): value is string => Boolean(value))
    )
  ];
  const employeeIds = [
    ...new Set(
      rows.map((row) => row.employee_id).filter((value): value is string => Boolean(value))
    )
  ];

  const [scheduleResult, templateResult, profileResult] = await Promise.all([
    supabase
      .from("schedules")
      .select("id, name")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .in("id", scheduleIds),
    templateIds.length > 0
      ? supabase
          .from("shift_templates")
          .select("id, name")
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .in("id", templateIds)
      : Promise.resolve({ data: [], error: null }),
    employeeIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, full_name, department, country_code")
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .in("id", employeeIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (scheduleResult.error || templateResult.error || profileResult.error) {
    throw new Error("Unable to resolve shift metadata.");
  }

  const parsedScheduleRows = z.array(scheduleRowSchema).safeParse(scheduleResult.data ?? []);
  const parsedTemplateRows = z.array(templateRowSchema).safeParse(templateResult.data ?? []);
  const parsedProfileRows = z.array(profileRowSchema).safeParse(profileResult.data ?? []);

  if (!parsedScheduleRows.success || !parsedTemplateRows.success || !parsedProfileRows.success) {
    throw new Error("Shift metadata is not in the expected shape.");
  }

  const scheduleNameById = new Map(
    parsedScheduleRows.data.map((scheduleRow) => [scheduleRow.id, scheduleRow.name] as const)
  );
  const templateNameById = new Map(
    parsedTemplateRows.data.map((templateRow) => [templateRow.id, templateRow.name] as const)
  );
  const profileById = new Map(parsedProfileRows.data.map((profileRow) => [profileRow.id, profileRow] as const));

  return rows.map((row) => {
    const employeeProfile = row.employee_id ? profileById.get(row.employee_id) ?? null : null;

    return {
      id: row.id,
      orgId: row.org_id,
      scheduleId: row.schedule_id,
      scheduleName: scheduleNameById.get(row.schedule_id) ?? null,
      templateId: row.template_id,
      templateName: row.template_id ? templateNameById.get(row.template_id) ?? null : null,
      employeeId: row.employee_id,
      employeeName: employeeProfile?.full_name ?? null,
      employeeDepartment: employeeProfile?.department ?? null,
      employeeCountryCode: employeeProfile?.country_code ?? null,
      shiftDate: row.shift_date,
      startTime: row.start_time,
      endTime: row.end_time,
      breakMinutes: parseInteger(row.break_minutes),
      status: row.status,
      notes: row.notes,
      color: row.color,
      isOpenShift: row.employee_id === null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  });
}

async function detectShiftConflicts({
  supabase,
  orgId,
  employeeId,
  shiftDate,
  startTime,
  endTime,
  excludeShiftId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
  employeeId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  excludeShiftId?: string;
}): Promise<string | null> {
  let existingShiftsQuery = supabase
    .from("shifts")
    .select("id, start_time, end_time")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .in("shift_date", dateWindowForConflictCheck(shiftDate))
    .is("deleted_at", null)
    .neq("status", "cancelled");

  if (excludeShiftId) {
    existingShiftsQuery = existingShiftsQuery.neq("id", excludeShiftId);
  }

  const { data: rawRows, error } = await existingShiftsQuery;

  if (error) {
    return "Unable to validate shift overlap.";
  }

  for (const row of rawRows ?? []) {
    const existingStart = typeof row.start_time === "string" ? row.start_time : null;
    const existingEnd = typeof row.end_time === "string" ? row.end_time : null;

    if (!existingStart || !existingEnd) {
      continue;
    }

    if (
      areTimeRangesOverlapping({
        startA: startTime,
        endA: endTime,
        startB: existingStart,
        endB: existingEnd
      })
    ) {
      return "This crew member already has an overlapping shift.";
    }
  }

  const { data: leaveRows, error: leaveError } = await supabase
    .from("leave_requests")
    .select("id")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .in("status", ["approved", "pending"])
    .lte("start_date", shiftDate)
    .gte("end_date", shiftDate)
    .is("deleted_at", null)
    .limit(1);

  if (leaveError) {
    return "Unable to validate leave conflicts.";
  }

  if ((leaveRows ?? []).length > 0) {
    return "This crew member has time off on the selected day.";
  }

  return null;
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view shifts."
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
        message: parsedQuery.error.issues[0]?.message ?? "Invalid shifts query."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;
  const canViewTeam = canViewTeamSchedules(session.profile.roles);
  const isScopedTeamLead = isDepartmentScopedTeamLead(session.profile.roles);
  const isManager = isSchedulingManager(session.profile.roles);
  const scope =
    query.scope === "team" && canViewTeam
      ? "team"
      : query.scope === "open"
        ? "open"
        : "mine";
  const supabase = await createSupabaseServerClient();

  if (scope === "team" && isScopedTeamLead && !session.profile.department) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "TEAM_LEAD_DEPARTMENT_REQUIRED",
        message: "Team lead scheduling requires a department on your profile."
      },
      meta: buildMeta()
    });
  }

  let shiftsQuery = supabase
    .from("shifts")
    .select(
      "id, org_id, schedule_id, template_id, employee_id, shift_date, start_time, end_time, break_minutes, status, notes, color, created_at, updated_at"
    )
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .order("shift_date", { ascending: query.sortDir === "asc" })
    .order("start_time", { ascending: query.sortDir === "asc" })
    .limit(query.limit);

  if (scope === "mine") {
    shiftsQuery = shiftsQuery.eq("employee_id", session.profile.id);
  } else if (scope === "open") {
    shiftsQuery = shiftsQuery.is("employee_id", null);
  }

  if (query.scheduleId) {
    shiftsQuery = shiftsQuery.eq("schedule_id", query.scheduleId);
  }

  if (query.startDate && query.startDate.length > 0) {
    shiftsQuery = shiftsQuery.gte("shift_date", query.startDate);
  }

  if (query.endDate && query.endDate.length > 0) {
    shiftsQuery = shiftsQuery.lte("shift_date", query.endDate);
  }

  if (scope === "team" && (isScopedTeamLead || !isManager)) {
    if (!session.profile.department) {
      return jsonResponse<SchedulingShiftsResponseData>(200, {
        data: { shifts: [] },
        error: null,
        meta: buildMeta()
      });
    }

    const { data: scopedSchedules, error: scopedSchedulesError } = await supabase
      .from("schedules")
      .select("id")
      .eq("org_id", session.profile.org_id)
      .ilike("department", session.profile.department)
      .is("deleted_at", null);

    if (scopedSchedulesError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "SHIFT_SCOPE_FETCH_FAILED",
          message: "Unable to resolve team lead schedule scope."
        },
        meta: buildMeta()
      });
    }

    const scopedScheduleIds = (scopedSchedules ?? [])
      .map((row) => row.id)
      .filter((value): value is string => typeof value === "string");

    if (scopedScheduleIds.length === 0) {
      return jsonResponse<SchedulingShiftsResponseData>(200, {
        data: { shifts: [] },
        error: null,
        meta: buildMeta()
      });
    }

    shiftsQuery = shiftsQuery.in("schedule_id", scopedScheduleIds);
  }

  const { data: rawRows, error } = await shiftsQuery;

  if (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFTS_FETCH_FAILED",
        message: "Unable to load shifts."
      },
      meta: buildMeta()
    });
  }

  const parsedRows = z.array(shiftRowSchema).safeParse(rawRows ?? []);

  if (!parsedRows.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFTS_PARSE_FAILED",
        message: "Shift data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  try {
    const shifts = await mapShiftRows({
      supabase,
      rows: parsedRows.data,
      orgId: session.profile.org_id
    });

    return jsonResponse<SchedulingShiftsResponseData>(200, {
      data: { shifts },
      error: null,
      meta: buildMeta()
    });
  } catch {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFTS_METADATA_FAILED",
        message: "Unable to resolve shift metadata."
      },
      meta: buildMeta()
    });
  }
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to create shifts."
      },
      meta: buildMeta()
    });
  }

  if (!isSchedulingManager(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only managers and admins can create shifts."
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

  const parsedBody = createShiftSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid shift payload."
      },
      meta: buildMeta()
    });
  }

  const shiftRange = combineDateAndTimeRange(
    parsedBody.data.shiftDate,
    parsedBody.data.startTime,
    parsedBody.data.endTime
  );

  if (!shiftRange) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Shift end time must be different from start time."
      },
      meta: buildMeta()
    });
  }

  const shiftStart = shiftRange.startTime;
  const shiftEnd = shiftRange.endTime;

  const supabase = await createSupabaseServerClient();
  const isScopedTeamLead = isDepartmentScopedTeamLead(session.profile.roles);

  if (isScopedTeamLead && !session.profile.department) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "TEAM_LEAD_DEPARTMENT_REQUIRED",
        message: "Team lead scheduling requires a department on your profile."
      },
      meta: buildMeta()
    });
  }

  const { data: scheduleRow, error: scheduleError } = await supabase
    .from("schedules")
    .select("id, department")
    .eq("id", parsedBody.data.scheduleId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (scheduleError || !scheduleRow?.id) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "SCHEDULE_NOT_FOUND",
        message: "Schedule was not found."
      },
      meta: buildMeta()
    });
  }

  if (
    isScopedTeamLead &&
    !areDepartmentsEqual(scheduleRow.department, session.profile.department)
  ) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Team lead can only manage shifts for schedules in their department."
      },
      meta: buildMeta()
    });
  }

  if (parsedBody.data.employeeId && isScopedTeamLead) {
    const { data: employeeRow, error: employeeError } = await supabase
      .from("profiles")
      .select("id, department")
      .eq("org_id", session.profile.org_id)
      .eq("id", parsedBody.data.employeeId)
      .is("deleted_at", null)
      .maybeSingle();

    if (employeeError || !employeeRow?.id) {
      return jsonResponse<null>(404, {
        data: null,
        error: {
          code: "EMPLOYEE_NOT_FOUND",
          message: "Crew member for this shift was not found."
        },
        meta: buildMeta()
      });
    }

    if (!areDepartmentsEqual(employeeRow.department, session.profile.department)) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "Team leads can only assign crew members from their own department."
        },
        meta: buildMeta()
      });
    }
  }

  if (parsedBody.data.employeeId) {
    const conflictMessage = await detectShiftConflicts({
      supabase,
      orgId: session.profile.org_id,
      employeeId: parsedBody.data.employeeId,
      shiftDate: parsedBody.data.shiftDate,
      startTime: shiftStart,
      endTime: shiftEnd
    });

    if (conflictMessage) {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "SHIFT_CONFLICT",
          message: conflictMessage
        },
        meta: buildMeta()
      });
    }
  }

  const { data: rawRow, error } = await supabase
    .from("shifts")
    .insert({
      org_id: session.profile.org_id,
      schedule_id: parsedBody.data.scheduleId,
      template_id: parsedBody.data.templateId ?? null,
      employee_id: parsedBody.data.employeeId ?? null,
      shift_date: parsedBody.data.shiftDate,
      start_time: shiftStart,
      end_time: shiftEnd,
      break_minutes: parsedBody.data.breakMinutes,
      status: "scheduled",
      notes: parsedBody.data.notes?.trim() || null,
      color: parsedBody.data.color ?? null
    })
    .select(
      "id, org_id, schedule_id, template_id, employee_id, shift_date, start_time, end_time, break_minutes, status, notes, color, created_at, updated_at"
    )
    .single();

  if (error || !rawRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_CREATE_FAILED",
        message: "Unable to create shift."
      },
      meta: buildMeta()
    });
  }

  const parsedRow = shiftRowSchema.safeParse(rawRow);

  if (!parsedRow.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_PARSE_FAILED",
        message: "Created shift data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const mappedShiftRows = await mapShiftRows({
    supabase,
    rows: [parsedRow.data],
    orgId: session.profile.org_id
  });
  const createdShift = mappedShiftRows[0];

  if (!createdShift) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_METADATA_FAILED",
        message: "Unable to resolve created shift metadata."
      },
      meta: buildMeta()
    });
  }

  void logAudit({
    action: "created",
    tableName: "shifts",
    recordId: createdShift.id,
    oldValue: null,
    newValue: {
      schedule_id: createdShift.scheduleId,
      employee_id: createdShift.employeeId,
      shift_date: createdShift.shiftDate
    }
  });

  return jsonResponse<SchedulingShiftMutationResponseData>(201, {
    data: {
      shift: createdShift
    },
    error: null,
    meta: buildMeta()
  });
}
