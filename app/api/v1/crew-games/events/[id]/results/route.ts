import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { hasAnyRole } from "../../../../../../../lib/auth/roles";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import { logAudit } from "../../../../../../../lib/audit";
import { buildMeta, jsonResponse, CREW_GAMES_ADMIN_ROLES } from "../../../_helpers";

type RouteParams = { params: Promise<{ id: string }> };

const resultRowSchema = z.object({
  nickname: z.string().trim().min(1).max(100),
  employeeId: z.string().uuid().nullable().optional(),
  score: z.number().nullable().optional(),
  placement: z.number().int().min(1).nullable().optional(),
  pointsAwarded: z.number().int().min(0).default(0)
});

const payloadSchema = z.object({
  results: z.array(resultRowSchema).min(1).max(100)
});

/* ── PUT /api/v1/crew-games/events/[id]/results ── */

export async function PUT(request: Request, { params }: RouteParams) {
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
      error: { code: "FORBIDDEN", message: "You do not have permission to post results." },
      meta: buildMeta()
    });
  }

  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  // Verify event exists, belongs to org, and is a games_night
  const { data: event, error: eventError } = await supabase
    .from("crew_night_events")
    .select("id, org_id, event_type, status, results_published_at")
    .eq("id", id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (eventError || !event) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Event not found." },
      meta: buildMeta()
    });
  }

  if (event.event_type !== "games_night") {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "WRONG_EVENT_TYPE", message: "Results can only be posted to Games Night events." },
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

  // Delete existing results for this event, then insert new ones (replace pattern)
  const { error: deleteError } = await supabase
    .from("crew_night_results")
    .delete()
    .eq("event_id", id);

  if (deleteError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "DELETE_FAILED", message: "Unable to clear existing results." },
      meta: buildMeta()
    });
  }

  const rows = parsed.data.results.map((r) => ({
    org_id: session.profile!.org_id,
    event_id: id,
    nickname: r.nickname,
    employee_id: r.employeeId ?? null,
    score: r.score ?? null,
    placement: r.placement ?? null,
    points_awarded: r.pointsAwarded
  }));

  const { error: insertError } = await supabase
    .from("crew_night_results")
    .insert(rows);

  if (insertError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "INSERT_FAILED", message: "Unable to save results." },
      meta: buildMeta()
    });
  }

  // First results publish on a completed event: set results_published_at + announce
  let shouldAnnounceResults = false;
  if (event.status === "completed" && !event.results_published_at) {
    const { error: publishError } = await supabase
      .from("crew_night_events")
      .update({ results_published_at: new Date().toISOString() })
      .eq("id", id);

    if (!publishError) {
      shouldAnnounceResults = true;
    }
  }

  // If event is not yet completed, mark it as completed
  if (event.status !== "completed") {
    const updateData: Record<string, unknown> = { status: "completed" };
    if (!event.results_published_at) {
      updateData.results_published_at = new Date().toISOString();
      shouldAnnounceResults = true;
    }
    await supabase
      .from("crew_night_events")
      .update(updateData)
      .eq("id", id);
  }

  logAudit({
    action: "updated",
    tableName: "crew_night_results",
    recordId: id,
    newValue: { resultCount: rows.length }
  }).catch(() => undefined);

  if (shouldAnnounceResults) {
    sendResultsAnnouncement(session.profile.org_id, id).catch(() => undefined);
  }

  return jsonResponse<{ saved: true }>(200, {
    data: { saved: true },
    error: null,
    meta: buildMeta()
  });
}

/* ── Results announcement ── */

async function sendResultsAnnouncement(orgId: string, eventId: string): Promise<void> {
  const { createBulkNotifications } = await import("../../../../../../../lib/notifications/service");
  const { createSupabaseServiceRoleClient } = await import(
    "../../../../../../../lib/supabase/service-role"
  );

  const serviceClient = createSupabaseServiceRoleClient();

  // Fetch event details
  const { data: event } = await serviceClient
    .from("crew_night_events")
    .select("title, event_type")
    .eq("id", eventId)
    .single();

  if (!event) return;

  // Fetch winner
  const { data: winnerResult } = await serviceClient
    .from("crew_night_results")
    .select("nickname, score, profiles:employee_id(full_name)")
    .eq("event_id", eventId)
    .eq("placement", 1)
    .maybeSingle();

  // Fetch all active users
  const { data: profiles } = await serviceClient
    .from("profiles")
    .select("id")
    .eq("org_id", orgId)
    .eq("status", "active")
    .is("deleted_at", null);

  if (!profiles || profiles.length === 0) return;

  const userIds = profiles.map((p: { id: string }) => p.id);

  let body: string;
  if (winnerResult) {
    const profile = winnerResult.profiles as unknown as { full_name: string } | null;
    const winnerName = profile?.full_name ?? winnerResult.nickname;
    const scoreText = winnerResult.score !== null ? ` with ${winnerResult.score} points` : "";
    body = `${winnerName} takes first place${scoreText}!`;
  } else {
    body = "Results are in! Check the leaderboard.";
  }

  await createBulkNotifications({
    orgId,
    userIds,
    type: "crew_games_results",
    title: `Games Night results: ${event.title}`,
    body,
    link: "/crew-games"
  });
}
