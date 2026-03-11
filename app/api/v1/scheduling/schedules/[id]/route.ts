import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import { areDepartmentsEqual } from "../../../../../../lib/department";
import { isDepartmentScopedTeamLead } from "../../../../../../lib/roles";
import { isSchedulingManager } from "../../../../../../lib/scheduling";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../../types/auth";
import { SCHEDULE_STATUSES } from "../../../../../../types/scheduling";

const scheduleRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  name: z.string().nullable(),
  department: z.string().nullable(),
  start_date: z.string(),
  end_date: z.string(),
  schedule_track: z.string().nullable(),
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

  const supabase = createSupabaseServiceRoleClient();
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
      "id, org_id, name, department, start_date, end_date, schedule_track, status, published_at, published_by, created_at, updated_at"
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

  if (schedule.status === "locked") {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "SCHEDULE_LOCKED",
        message: "Locked schedules cannot be removed."
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

  const deletedAt = new Date().toISOString();

  const { data: existingShiftRows, error: shiftsFetchError } = await supabase
    .from("shifts")
    .select("id")
    .eq("org_id", session.profile.org_id)
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null);

  if (shiftsFetchError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_FETCH_FAILED",
        message: "Unable to load schedule shifts before delete."
      },
      meta: buildMeta()
    });
  }

  const shiftIds = (existingShiftRows ?? [])
    .map((row) => (typeof row.id === "string" ? row.id : null))
    .filter((value): value is string => Boolean(value));

  if (shiftIds.length > 0) {
    const { error: swapsDeleteError } = await supabase
      .from("shift_swaps")
      .update({ deleted_at: deletedAt })
      .eq("org_id", session.profile.org_id)
      .in("shift_id", shiftIds)
      .is("deleted_at", null);

    if (swapsDeleteError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "SWAP_DELETE_FAILED",
          message: "Unable to remove linked shift swaps."
        },
        meta: buildMeta()
      });
    }
  }

  const { error: shiftsDeleteError } = await supabase
    .from("shifts")
    .update({ deleted_at: deletedAt })
    .eq("org_id", session.profile.org_id)
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null);

  if (shiftsDeleteError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_DELETE_FAILED",
        message: "Unable to remove linked shifts."
      },
      meta: buildMeta()
    });
  }

  const { error: rosterDeleteError } = await supabase
    .from("schedule_roster")
    .delete()
    .eq("schedule_id", scheduleId);

  if (rosterDeleteError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ROSTER_DELETE_FAILED",
        message: "Unable to remove linked roster entries."
      },
      meta: buildMeta()
    });
  }

  const { error: notesDeleteError } = await supabase
    .from("schedule_day_notes")
    .delete()
    .eq("schedule_id", scheduleId);

  if (notesDeleteError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "NOTES_DELETE_FAILED",
        message: "Unable to remove linked schedule notes."
      },
      meta: buildMeta()
    });
  }

  /* Soft-delete the schedule using service-role client to bypass RLS.
     Authorization is already enforced above (isSchedulingManager + team-lead scoping). */
  const { error: deleteError } = await supabase
    .from("schedules")
    .update({ deleted_at: deletedAt })
    .eq("id", scheduleId)
    .eq("org_id", session.profile.org_id);

  if (deleteError) {
    console.error("[SCHEDULE_DELETE] Soft-delete failed:", JSON.stringify(deleteError, null, 2));
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SCHEDULE_DELETE_FAILED",
        message: `Unable to delete schedule: ${deleteError.message ?? "Unknown error"}`
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
    newValue: {
      deleted_at: deletedAt,
      removed_shift_count: shiftIds.length
    }
  });

  return jsonResponse<{ deleted: true }>(200, {
    data: { deleted: true },
    error: null,
    meta: buildMeta()
  });
}
