import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import {
  areTimeRangesOverlapping,
  combineDateAndTime,
  extractIsoTime,
  isIsoDate,
  isIsoTime,
  isSchedulingManager,
  parseInteger
} from "../../../../../../lib/scheduling";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../../types/auth";
import {
  SHIFT_STATUSES,
  type SchedulingShiftMutationResponseData,
  type ShiftRecord
} from "../../../../../../types/scheduling";

const updateShiftSchema = z.object({
  scheduleId: z.string().uuid("scheduleId must be a valid UUID.").optional(),
  templateId: z.string().uuid("templateId must be a valid UUID.").nullable().optional(),
  employeeId: z.string().uuid("employeeId must be a valid UUID.").nullable().optional(),
  shiftDate: z
    .string()
    .trim()
    .refine((value) => value.length === 0 || isIsoDate(value), "shiftDate must be YYYY-MM-DD.")
    .optional(),
  startTime: z
    .string()
    .trim()
    .refine((value) => value.length === 0 || isIsoTime(value), "startTime must be HH:MM.")
    .optional(),
  endTime: z
    .string()
    .trim()
    .refine((value) => value.length === 0 || isIsoTime(value), "endTime must be HH:MM.")
    .optional(),
  breakMinutes: z.coerce.number().int().min(0).max(240).optional(),
  status: z.enum(SHIFT_STATUSES).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a hex value such as #4A0039.")
    .nullable()
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

async function detectShiftConflicts({
  supabase,
  orgId,
  employeeId,
  shiftDate,
  startTime,
  endTime,
  shiftId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
  employeeId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  shiftId: string;
}): Promise<string | null> {
  const { data: rawRows, error } = await supabase
    .from("shifts")
    .select("id, start_time, end_time")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .eq("shift_date", shiftDate)
    .is("deleted_at", null)
    .neq("status", "cancelled")
    .neq("id", shiftId);

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
      return "This employee already has an overlapping shift.";
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
    return "This employee has time off on the selected day.";
  }

  return null;
}

async function mapShift({
  supabase,
  row,
  orgId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  row: z.infer<typeof shiftRowSchema>;
  orgId: string;
}): Promise<ShiftRecord> {
  const [scheduleResult, templateResult, profileResult] = await Promise.all([
    supabase
      .from("schedules")
      .select("id, name")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .eq("id", row.schedule_id)
      .maybeSingle(),
    row.template_id
      ? supabase
          .from("shift_templates")
          .select("id, name")
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .eq("id", row.template_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    row.employee_id
      ? supabase
          .from("profiles")
          .select("id, full_name, department, country_code")
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .eq("id", row.employee_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ]);

  if (scheduleResult.error || templateResult.error || profileResult.error) {
    throw new Error("Unable to resolve shift metadata.");
  }

  const scheduleRow = scheduleResult.data
    ? scheduleRowSchema.safeParse(scheduleResult.data)
    : null;
  const templateRow = templateResult.data
    ? templateRowSchema.safeParse(templateResult.data)
    : null;
  const profileRow = profileResult.data
    ? profileRowSchema.safeParse(profileResult.data)
    : null;

  if ((scheduleRow && !scheduleRow.success) || (templateRow && !templateRow.success) || (profileRow && !profileRow.success)) {
    throw new Error("Shift metadata is not in the expected shape.");
  }

  return {
    id: row.id,
    orgId: row.org_id,
    scheduleId: row.schedule_id,
    scheduleName: scheduleRow?.success ? scheduleRow.data.name : null,
    templateId: row.template_id,
    templateName: templateRow?.success ? templateRow.data.name : null,
    employeeId: row.employee_id,
    employeeName: profileRow?.success ? profileRow.data.full_name : null,
    employeeDepartment: profileRow?.success ? profileRow.data.department : null,
    employeeCountryCode: profileRow?.success ? profileRow.data.country_code : null,
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
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to update shifts."
      },
      meta: buildMeta()
    });
  }

  if (!isSchedulingManager(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only managers and admins can update shifts."
      },
      meta: buildMeta()
    });
  }

  const params = await context.params;
  const shiftId = params.id;

  if (!z.string().uuid().safeParse(shiftId).success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Shift id must be a valid UUID."
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

  const parsedBody = updateShiftSchema.safeParse(body);

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

  const changes = parsedBody.data;

  if (Object.keys(changes).length === 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Provide at least one field to update."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: rawExistingRow, error: existingError } = await supabase
    .from("shifts")
    .select(
      "id, org_id, schedule_id, template_id, employee_id, shift_date, start_time, end_time, break_minutes, status, notes, color, created_at, updated_at"
    )
    .eq("id", shiftId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_FETCH_FAILED",
        message: "Unable to load shift."
      },
      meta: buildMeta()
    });
  }

  if (!rawExistingRow) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "SHIFT_NOT_FOUND",
        message: "Shift was not found."
      },
      meta: buildMeta()
    });
  }

  const parsedExistingRow = shiftRowSchema.safeParse(rawExistingRow);

  if (!parsedExistingRow.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_PARSE_FAILED",
        message: "Shift data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const existingShift = parsedExistingRow.data;
  const nextScheduleId = changes.scheduleId ?? existingShift.schedule_id;
  const nextTemplateId =
    changes.templateId === undefined ? existingShift.template_id : changes.templateId;
  const nextEmployeeId =
    changes.employeeId === undefined ? existingShift.employee_id : changes.employeeId;
  const nextShiftDate = changes.shiftDate?.trim() || existingShift.shift_date;
  const nextStartTimeValue = changes.startTime?.trim() || extractIsoTime(existingShift.start_time);
  const nextEndTimeValue = changes.endTime?.trim() || extractIsoTime(existingShift.end_time);

  const nextStartTime = combineDateAndTime(nextShiftDate, nextStartTimeValue);
  const nextEndTime = combineDateAndTime(nextShiftDate, nextEndTimeValue);

  if (!nextStartTime || !nextEndTime || nextEndTime <= nextStartTime) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Shift end time must be after start time."
      },
      meta: buildMeta()
    });
  }

  if (changes.scheduleId) {
    const { data: scheduleRow, error: scheduleError } = await supabase
      .from("schedules")
      .select("id")
      .eq("id", changes.scheduleId)
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (scheduleError || !scheduleRow?.id) {
      return jsonResponse<null>(404, {
        data: null,
        error: {
          code: "SCHEDULE_NOT_FOUND",
          message: "Target schedule was not found."
        },
        meta: buildMeta()
      });
    }
  }

  if (nextEmployeeId) {
    const conflictMessage = await detectShiftConflicts({
      supabase,
      orgId: session.profile.org_id,
      employeeId: nextEmployeeId,
      shiftDate: nextShiftDate,
      startTime: nextStartTime,
      endTime: nextEndTime,
      shiftId
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

  const { data: rawUpdatedRow, error: updateError } = await supabase
    .from("shifts")
    .update({
      schedule_id: nextScheduleId,
      template_id: nextTemplateId,
      employee_id: nextEmployeeId,
      shift_date: nextShiftDate,
      start_time: nextStartTime,
      end_time: nextEndTime,
      break_minutes:
        changes.breakMinutes === undefined
          ? parseInteger(existingShift.break_minutes)
          : changes.breakMinutes,
      status: changes.status ?? existingShift.status,
      notes:
        changes.notes === undefined
          ? existingShift.notes
          : changes.notes === null
            ? null
            : changes.notes.trim() || null,
      color:
        changes.color === undefined
          ? existingShift.color
          : changes.color === null
            ? null
            : changes.color
    })
    .eq("id", shiftId)
    .eq("org_id", session.profile.org_id)
    .select(
      "id, org_id, schedule_id, template_id, employee_id, shift_date, start_time, end_time, break_minutes, status, notes, color, created_at, updated_at"
    )
    .single();

  if (updateError || !rawUpdatedRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_UPDATE_FAILED",
        message: "Unable to update shift."
      },
      meta: buildMeta()
    });
  }

  const parsedUpdatedRow = shiftRowSchema.safeParse(rawUpdatedRow);

  if (!parsedUpdatedRow.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_UPDATED_PARSE_FAILED",
        message: "Updated shift data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  let updatedShift: ShiftRecord;

  try {
    updatedShift = await mapShift({
      supabase,
      row: parsedUpdatedRow.data,
      orgId: session.profile.org_id
    });
  } catch {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_METADATA_FAILED",
        message: "Unable to resolve updated shift metadata."
      },
      meta: buildMeta()
    });
  }

  void logAudit({
    action: "updated",
    tableName: "shifts",
    recordId: shiftId,
    oldValue: {
      employee_id: existingShift.employee_id,
      shift_date: existingShift.shift_date,
      status: existingShift.status
    },
    newValue: {
      employee_id: parsedUpdatedRow.data.employee_id,
      shift_date: parsedUpdatedRow.data.shift_date,
      status: parsedUpdatedRow.data.status
    }
  });

  return jsonResponse<SchedulingShiftMutationResponseData>(200, {
    data: { shift: updatedShift },
    error: null,
    meta: buildMeta()
  });
}
