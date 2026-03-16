import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { hasAnyRole } from "../../../../../../lib/auth/roles";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { logAudit } from "../../../../../../lib/audit";
import { buildMeta, jsonResponse, CREW_GAMES_ADMIN_ROLES } from "../../_helpers";

const payloadSchema = z.object({
  employeeId: z.string().uuid(),
  season: z.string().regex(/^\d{4}$/).default(String(new Date().getFullYear())),
  pointsDelta: z.number().int(),
  reason: z.string().trim().min(1).max(500)
});

/* ── POST /api/v1/crew-games/leaderboard/adjustments ── */

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  if (!hasAnyRole(session.profile, CREW_GAMES_ADMIN_ROLES)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "You do not have permission to post adjustments." },
      meta: buildMeta()
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Request body must be valid JSON." },
      meta: buildMeta()
    });
  }

  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid payload."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const payload = parsed.data;

  // Verify the employee exists in the org
  const { data: employee } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", payload.employeeId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!employee) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Employee not found." },
      meta: buildMeta()
    });
  }

  const { data: row, error: insertError } = await supabase
    .from("crew_night_leaderboard_adjustments")
    .insert({
      org_id: session.profile.org_id,
      employee_id: payload.employeeId,
      season: payload.season,
      points_delta: payload.pointsDelta,
      reason: payload.reason,
      created_by: session.profile.id
    })
    .select("id")
    .single();

  if (insertError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "INSERT_FAILED", message: "Unable to save adjustment." },
      meta: buildMeta()
    });
  }

  logAudit({
    action: "created",
    tableName: "crew_night_leaderboard_adjustments",
    recordId: row.id,
    newValue: {
      employeeId: payload.employeeId,
      pointsDelta: payload.pointsDelta,
      reason: payload.reason
    }
  }).catch(() => undefined);

  return jsonResponse<{ id: string }>(201, {
    data: { id: row.id },
    error: null,
    meta: buildMeta()
  });
}
