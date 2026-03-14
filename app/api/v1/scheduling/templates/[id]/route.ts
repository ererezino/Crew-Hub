import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import { areDepartmentsEqual } from "../../../../../../lib/department";
import { isDepartmentOnlyTeamLead } from "../../../../../../lib/roles";
import {
  isIsoTime,
  isSchedulingManager,
  parseInteger
} from "../../../../../../lib/scheduling";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../../types/auth";
import type {
  SchedulingTemplateMutationResponseData,
  ShiftTemplateRecord
} from "../../../../../../types/scheduling";

const updateTemplateSchema = z.object({
  name: z.string().trim().min(1, "Template name is required.").max(200).optional(),
  department: z.string().trim().max(100).nullable().optional(),
  startTime: z
    .string()
    .trim()
    .refine((value) => isIsoTime(value), "Start time must be HH:MM.")
    .optional(),
  endTime: z
    .string()
    .trim()
    .refine((value) => isIsoTime(value), "End time must be HH:MM.")
    .optional(),
  breakMinutes: z.coerce.number().int().min(0).max(240).optional(),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a hex value such as #4A0039.")
    .nullable()
    .optional()
});

const templateRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  name: z.string(),
  department: z.string().nullable(),
  start_time: z.string(),
  end_time: z.string(),
  break_minutes: z.union([z.number(), z.string()]),
  color: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function mapTemplateRow(row: z.infer<typeof templateRowSchema>): ShiftTemplateRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    department: row.department,
    startTime: row.start_time.slice(0, 5),
    endTime: row.end_time.slice(0, 5),
    breakMinutes: parseInteger(row.break_minutes),
    color: row.color,
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
        message: "You must be logged in to update shift templates."
      },
      meta: buildMeta()
    });
  }

  if (!isSchedulingManager(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only managers and admins can update shift templates."
      },
      meta: buildMeta()
    });
  }

  const { id: templateId } = await context.params;

  if (!z.string().uuid().safeParse(templateId).success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Template ID must be a valid UUID."
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

  const parsedBody = updateTemplateSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid template update payload."
      },
      meta: buildMeta()
    });
  }

  const updates = parsedBody.data;

  if (Object.keys(updates).length === 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "At least one field must be provided for update."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const isScopedTeamLead = isDepartmentOnlyTeamLead(session.profile.roles);

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

  /* Fetch existing template */
  const { data: rawExisting, error: fetchError } = await supabase
    .from("shift_templates")
    .select(
      "id, org_id, name, department, start_time, end_time, break_minutes, color, created_at, updated_at"
    )
    .eq("id", templateId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .single();

  if (fetchError || !rawExisting) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Shift template not found."
      },
      meta: buildMeta()
    });
  }

  /* Department scoping for team leads */
  if (
    isScopedTeamLead &&
    rawExisting.department &&
    !areDepartmentsEqual(rawExisting.department as string, session.profile.department)
  ) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Team lead can only update templates for their own department."
      },
      meta: buildMeta()
    });
  }

  /* Time validation: use updated times or fall back to existing */
  const effectiveStartTime = updates.startTime ?? (rawExisting.start_time as string).slice(0, 5);
  const effectiveEndTime = updates.endTime ?? (rawExisting.end_time as string).slice(0, 5);

  if (effectiveEndTime === effectiveStartTime) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "End time must be different from start time."
      },
      meta: buildMeta()
    });
  }

  /* Build update payload */
  const updatePayload: Record<string, unknown> = {};

  if (updates.name !== undefined) {
    updatePayload.name = updates.name;
  }
  if (updates.department !== undefined) {
    updatePayload.department = isScopedTeamLead
      ? session.profile.department
      : updates.department?.trim() || null;
  }
  if (updates.startTime !== undefined) {
    updatePayload.start_time = `${updates.startTime}:00`;
  }
  if (updates.endTime !== undefined) {
    updatePayload.end_time = `${updates.endTime}:00`;
  }
  if (updates.breakMinutes !== undefined) {
    updatePayload.break_minutes = updates.breakMinutes;
  }
  if (updates.color !== undefined) {
    updatePayload.color = updates.color;
  }

  const { data: rawUpdated, error: updateError } = await supabase
    .from("shift_templates")
    .update(updatePayload)
    .eq("id", templateId)
    .eq("org_id", session.profile.org_id)
    .select(
      "id, org_id, name, department, start_time, end_time, break_minutes, color, created_at, updated_at"
    )
    .single();

  if (updateError || !rawUpdated) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_TEMPLATE_UPDATE_FAILED",
        message: "Unable to update shift template."
      },
      meta: buildMeta()
    });
  }

  const parsedRow = templateRowSchema.safeParse(rawUpdated);

  if (!parsedRow.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_TEMPLATE_PARSE_FAILED",
        message: "Updated template data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  void logAudit({
    action: "updated",
    tableName: "shift_templates",
    recordId: templateId,
    oldValue: { name: rawExisting.name },
    newValue: { name: parsedRow.data.name }
  });

  return jsonResponse<SchedulingTemplateMutationResponseData>(200, {
    data: {
      template: mapTemplateRow(parsedRow.data)
    },
    error: null,
    meta: buildMeta()
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to delete shift templates."
      },
      meta: buildMeta()
    });
  }

  if (!isSchedulingManager(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only managers and admins can delete shift templates."
      },
      meta: buildMeta()
    });
  }

  const { id: templateId } = await context.params;

  if (!z.string().uuid().safeParse(templateId).success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Template ID must be a valid UUID."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const isScopedTeamLead = isDepartmentOnlyTeamLead(session.profile.roles);

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

  /* Fetch existing template */
  const { data: rawExisting, error: fetchError } = await supabase
    .from("shift_templates")
    .select("id, org_id, name, department")
    .eq("id", templateId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .single();

  if (fetchError || !rawExisting) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Shift template not found."
      },
      meta: buildMeta()
    });
  }

  /* Department scoping for team leads */
  if (
    isScopedTeamLead &&
    rawExisting.department &&
    !areDepartmentsEqual(rawExisting.department as string, session.profile.department)
  ) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Team lead can only delete templates for their own department."
      },
      meta: buildMeta()
    });
  }

  /* Soft-delete */
  const { error: deleteError } = await supabase
    .from("shift_templates")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", templateId)
    .eq("org_id", session.profile.org_id);

  if (deleteError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_TEMPLATE_DELETE_FAILED",
        message: "Unable to delete shift template."
      },
      meta: buildMeta()
    });
  }

  void logAudit({
    action: "deleted",
    tableName: "shift_templates",
    recordId: templateId,
    oldValue: { name: rawExisting.name, department: rawExisting.department },
    newValue: null
  });

  return jsonResponse<{ deleted: true }>(200, {
    data: { deleted: true },
    error: null,
    meta: buildMeta()
  });
}
