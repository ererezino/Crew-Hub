import { NextResponse } from "next/server";
import { z } from "zod";

import { checkApiAccess } from "../../../../../../../lib/auth/check-api-access";
import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { areDepartmentsEqual } from "../../../../../../../lib/department";
import { isDepartmentOnlyTeamLead } from "../../../../../../../lib/roles";
import { isSchedulingManager } from "../../../../../../../lib/scheduling";
import { createSupabaseServiceRoleClient } from "../../../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../../../types/auth";

/** Per-week free-text notes for a schedule (the grid's "Notes" column). */

const putSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "weekStart must be YYYY-MM-DD"),
  note: z.string().max(2000)
});

const noteRowSchema = z.object({
  week_start: z.string(),
  note: z.string()
});

export type ScheduleWeekNote = { weekStart: string; note: string };

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

async function authorize(scheduleId: string) {
  const session = await getAuthenticatedSession();
  if (!session?.profile) {
    return { error: jsonResponse<null>(401, { data: null, error: { code: "UNAUTHORIZED", message: "You must be logged in." }, meta: buildMeta() }) };
  }
  if (!(await checkApiAccess("/scheduling", session.profile))) {
    return { error: jsonResponse<null>(403, { data: null, error: { code: "FORBIDDEN", message: "You do not have access to scheduling." }, meta: buildMeta() }) };
  }
  if (!isSchedulingManager(session.profile.roles)) {
    return { error: jsonResponse<null>(403, { data: null, error: { code: "FORBIDDEN", message: "Only managers and admins can edit schedules." }, meta: buildMeta() }) };
  }
  if (!z.string().uuid().safeParse(scheduleId).success) {
    return { error: jsonResponse<null>(422, { data: null, error: { code: "VALIDATION_ERROR", message: "Schedule id must be a valid UUID." }, meta: buildMeta() }) };
  }

  const supabase = createSupabaseServiceRoleClient();
  const { data: schedule, error } = await supabase
    .from("schedules")
    .select("id, department")
    .eq("id", scheduleId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !schedule?.id) {
    return { error: jsonResponse<null>(404, { data: null, error: { code: "SCHEDULE_NOT_FOUND", message: "Schedule was not found." }, meta: buildMeta() }) };
  }

  if (isDepartmentOnlyTeamLead(session.profile.roles)) {
    if (!session.profile.department) {
      return { error: jsonResponse<null>(422, { data: null, error: { code: "TEAM_LEAD_DEPARTMENT_REQUIRED", message: "Team lead scheduling requires a department on your profile." }, meta: buildMeta() }) };
    }
    if (!areDepartmentsEqual(schedule.department, session.profile.department)) {
      return { error: jsonResponse<null>(403, { data: null, error: { code: "FORBIDDEN", message: "Team lead can only edit schedules in their own department." }, meta: buildMeta() }) };
    }
  }

  return { session, supabase, orgId: session.profile.org_id };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: scheduleId } = await context.params;
  const auth = await authorize(scheduleId);
  if ("error" in auth) return auth.error;

  const { data, error } = await auth.supabase
    .from("schedule_week_notes")
    .select("week_start, note")
    .eq("org_id", auth.orgId)
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null);

  if (error) {
    return jsonResponse<null>(500, { data: null, error: { code: "NOTES_FETCH_FAILED", message: "Unable to load week notes." }, meta: buildMeta() });
  }

  const notes: ScheduleWeekNote[] = (data ?? [])
    .map((row) => noteRowSchema.safeParse(row))
    .filter((r): r is { success: true; data: z.infer<typeof noteRowSchema> } => r.success)
    .map((r) => ({ weekStart: r.data.week_start, note: r.data.note }));

  return jsonResponse<{ notes: ScheduleWeekNote[] }>(200, { data: { notes }, error: null, meta: buildMeta() });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: scheduleId } = await context.params;
  const auth = await authorize(scheduleId);
  if ("error" in auth) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, { data: null, error: { code: "BAD_REQUEST", message: "Request body must be valid JSON." }, meta: buildMeta() });
  }

  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse<null>(422, { data: null, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid note payload." }, meta: buildMeta() });
  }

  const { weekStart, note } = parsed.data;

  const { error } = await auth.supabase
    .from("schedule_week_notes")
    .upsert(
      {
        org_id: auth.orgId,
        schedule_id: scheduleId,
        week_start: weekStart,
        note: note.trim(),
        deleted_at: null
      },
      { onConflict: "schedule_id,week_start" }
    );

  if (error) {
    return jsonResponse<null>(500, { data: null, error: { code: "NOTE_SAVE_FAILED", message: "Unable to save the note." }, meta: buildMeta() });
  }

  return jsonResponse<ScheduleWeekNote>(200, { data: { weekStart, note: note.trim() }, error: null, meta: buildMeta() });
}
