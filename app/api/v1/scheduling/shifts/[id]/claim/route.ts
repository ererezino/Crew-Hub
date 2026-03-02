import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { createNotification } from "../../../../../../../lib/notifications/service";
import { areTimeRangesOverlapping, parseInteger } from "../../../../../../../lib/scheduling";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../../../types/auth";
import {
  SHIFT_STATUSES,
  type SchedulingShiftMutationResponseData,
  type ShiftRecord
} from "../../../../../../../types/scheduling";

const claimPayloadSchema = z.object({
  note: z.string().trim().max(500).optional()
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
  country_code: z.string().nullable(),
  manager_id: z.string().uuid().nullable()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
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

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to claim open shifts."
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

  let body: unknown = {};

  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsedBody = claimPayloadSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid shift claim payload."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: rawShiftRow, error: shiftError } = await supabase
    .from("shifts")
    .select(
      "id, org_id, schedule_id, template_id, employee_id, shift_date, start_time, end_time, break_minutes, status, notes, color, created_at, updated_at"
    )
    .eq("id", shiftId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (shiftError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_FETCH_FAILED",
        message: "Unable to load shift."
      },
      meta: buildMeta()
    });
  }

  if (!rawShiftRow) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "SHIFT_NOT_FOUND",
        message: "Shift was not found."
      },
      meta: buildMeta()
    });
  }

  const parsedShiftRow = shiftRowSchema.safeParse(rawShiftRow);

  if (!parsedShiftRow.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_PARSE_FAILED",
        message: "Shift data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const existingShift = parsedShiftRow.data;

  if (existingShift.employee_id) {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "SHIFT_ALREADY_ASSIGNED",
        message: "This shift is no longer open."
      },
      meta: buildMeta()
    });
  }

  if (existingShift.status === "cancelled") {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "SHIFT_CANCELLED",
        message: "Cancelled shifts cannot be claimed."
      },
      meta: buildMeta()
    });
  }

  const { data: rawConflictRows, error: conflictError } = await supabase
    .from("shifts")
    .select("id, start_time, end_time")
    .eq("org_id", session.profile.org_id)
    .eq("employee_id", session.profile.id)
    .eq("shift_date", existingShift.shift_date)
    .is("deleted_at", null)
    .neq("status", "cancelled");

  if (conflictError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_CONFLICT_CHECK_FAILED",
        message: "Unable to validate shift conflicts."
      },
      meta: buildMeta()
    });
  }

  for (const row of rawConflictRows ?? []) {
    const existingStart = typeof row.start_time === "string" ? row.start_time : null;
    const existingEnd = typeof row.end_time === "string" ? row.end_time : null;

    if (!existingStart || !existingEnd) {
      continue;
    }

    if (
      areTimeRangesOverlapping({
        startA: existingShift.start_time,
        endA: existingShift.end_time,
        startB: existingStart,
        endB: existingEnd
      })
    ) {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "SHIFT_CONFLICT",
          message: "You already have an overlapping shift."
        },
        meta: buildMeta()
      });
    }
  }

  const { data: leaveRows, error: leaveError } = await supabase
    .from("leave_requests")
    .select("id")
    .eq("org_id", session.profile.org_id)
    .eq("employee_id", session.profile.id)
    .in("status", ["approved", "pending"])
    .lte("start_date", existingShift.shift_date)
    .gte("end_date", existingShift.shift_date)
    .is("deleted_at", null)
    .limit(1);

  if (leaveError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_LEAVE_CONFLICT_CHECK_FAILED",
        message: "Unable to validate leave conflicts."
      },
      meta: buildMeta()
    });
  }

  if ((leaveRows ?? []).length > 0) {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "SHIFT_LEAVE_CONFLICT",
        message: "You have time off on this date."
      },
      meta: buildMeta()
    });
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const claimedNotes = parsedBody.data.note?.trim();
  const mergedNotes =
    claimedNotes && claimedNotes.length > 0
      ? [existingShift.notes, `Claim note: ${claimedNotes}`].filter(Boolean).join("\n")
      : existingShift.notes;

  const { data: rawUpdatedShift, error: updateError } = await serviceClient
    .from("shifts")
    .update({
      employee_id: session.profile.id,
      notes: mergedNotes
    })
    .eq("id", shiftId)
    .eq("org_id", session.profile.org_id)
    .is("employee_id", null)
    .select(
      "id, org_id, schedule_id, template_id, employee_id, shift_date, start_time, end_time, break_minutes, status, notes, color, created_at, updated_at"
    )
    .single();

  if (updateError || !rawUpdatedShift) {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "SHIFT_CLAIM_FAILED",
        message: "Unable to claim shift. It may have already been claimed."
      },
      meta: buildMeta()
    });
  }

  const parsedUpdatedShift = shiftRowSchema.safeParse(rawUpdatedShift);

  if (!parsedUpdatedShift.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_CLAIM_PARSE_FAILED",
        message: "Claimed shift data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  let claimedShift: ShiftRecord;

  try {
    claimedShift = await mapShift({
      supabase,
      row: parsedUpdatedShift.data,
      orgId: session.profile.org_id
    });
  } catch {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_CLAIM_METADATA_FAILED",
        message: "Unable to resolve claimed shift metadata."
      },
      meta: buildMeta()
    });
  }

  const { data: claimerProfile } = await supabase
    .from("profiles")
    .select("id, full_name, department, country_code, manager_id")
    .eq("org_id", session.profile.org_id)
    .eq("id", session.profile.id)
    .is("deleted_at", null)
    .maybeSingle();

  const parsedClaimerProfile = claimerProfile ? profileRowSchema.safeParse(claimerProfile) : null;

  if (parsedClaimerProfile?.success && parsedClaimerProfile.data.manager_id) {
    void createNotification({
      orgId: session.profile.org_id,
      userId: parsedClaimerProfile.data.manager_id,
      type: "shift_claimed",
      title: "Open shift claimed",
      body: `${parsedClaimerProfile.data.full_name} claimed an open shift on ${existingShift.shift_date}.`,
      link: "/scheduling/manage"
    });
  }

  void logAudit({
    action: "updated",
    tableName: "shifts",
    recordId: shiftId,
    oldValue: {
      employee_id: null
    },
    newValue: {
      employee_id: session.profile.id
    }
  });

  return jsonResponse<SchedulingShiftMutationResponseData>(200, {
    data: {
      shift: claimedShift
    },
    error: null,
    meta: buildMeta()
  });
}
