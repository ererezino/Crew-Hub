import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import { areDepartmentsEqual } from "../../../../../../lib/department";
import { isDepartmentScopedTeamLead } from "../../../../../../lib/roles";
import { isSchedulingManager } from "../../../../../../lib/scheduling";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../../types/auth";
import { SCHEDULE_STATUSES } from "../../../../../../types/scheduling";

const scheduleRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  name: z.string().nullable(),
  department: z.string().nullable(),
  week_start: z.string(),
  week_end: z.string(),
  status: z.enum(SCHEDULE_STATUSES),
  published_at: z.string().nullable(),
  published_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
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
        message: "You must be logged in to delete schedules."
      },
      meta: buildMeta()
    });
  }

  if (!isSchedulingManager(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only managers and admins can delete schedules."
      },
      meta: buildMeta()
    });
  }

  const { id: scheduleId } = await context.params;

  if (!z.string().uuid().safeParse(scheduleId).success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Schedule ID must be a valid UUID."
      },
      meta: buildMeta()
    });
  }

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

  /* Fetch the schedule to validate ownership and status */
  const { data: rawSchedule, error: fetchError } = await supabase
    .from("schedules")
    .select(
      "id, org_id, name, department, week_start, week_end, status, published_at, published_by, created_at, updated_at"
    )
    .eq("id", scheduleId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .single();

  if (fetchError || !rawSchedule) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Schedule not found."
      },
      meta: buildMeta()
    });
  }

  const parsedSchedule = scheduleRowSchema.safeParse(rawSchedule);

  if (!parsedSchedule.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SCHEDULE_PARSE_FAILED",
        message: "Schedule data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const schedule = parsedSchedule.data;

  /* Only draft schedules can be deleted */
  if (schedule.status !== "draft") {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "SCHEDULE_NOT_DRAFT",
        message: "Only draft schedules can be deleted. Published or locked schedules cannot be removed."
      },
      meta: buildMeta()
    });
  }

  /* Department scoping for team leads */
  if (
    isScopedTeamLead &&
    schedule.department &&
    !areDepartmentsEqual(schedule.department, session.profile.department)
  ) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Team lead can only delete schedules for their own department."
      },
      meta: buildMeta()
    });
  }

  /* Soft-delete the schedule — cascade deletes shifts via DB constraint */
  const { error: deleteError } = await supabase
    .from("schedules")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", scheduleId)
    .eq("org_id", session.profile.org_id);

  if (deleteError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SCHEDULE_DELETE_FAILED",
        message: "Unable to delete schedule."
      },
      meta: buildMeta()
    });
  }

  void logAudit({
    action: "deleted",
    tableName: "schedules",
    recordId: scheduleId,
    oldValue: {
      name: schedule.name,
      department: schedule.department,
      status: schedule.status
    },
    newValue: null
  });

  return jsonResponse<{ deleted: true }>(200, {
    data: { deleted: true },
    error: null,
    meta: buildMeta()
  });
}
