import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { hasAnyRole } from "../../../../../../../lib/auth/roles";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import { logAudit } from "../../../../../../../lib/audit";
import { buildMeta, jsonResponse, CREW_GAMES_ADMIN_ROLES } from "../../../_helpers";

type RouteParams = { params: Promise<{ id: string }> };

const presenterRowSchema = z.object({
  employeeId: z.string().uuid(),
  talkTitle: z.string().trim().max(200).nullable().optional(),
  slidePath: z.string().nullable().optional(),
  slideFilename: z.string().nullable().optional(),
  voteCount: z.number().int().min(0).default(0),
  isWinner: z.boolean().default(false)
});

const payloadSchema = z.object({
  presenters: z.array(presenterRowSchema).min(0).max(20)
});

/* ── PUT /api/v1/crew-games/events/[id]/presenters ── */

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
      error: { code: "FORBIDDEN", message: "You do not have permission to edit presenters." },
      meta: buildMeta()
    });
  }

  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  // Verify event exists and is a presentation_night
  const { data: event, error: eventError } = await supabase
    .from("crew_night_events")
    .select("id, org_id, event_type, status, results_published_at, title")
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

  if (event.event_type !== "presentation_night") {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "WRONG_EVENT_TYPE", message: "Presenters can only be added to Presentation Night events." },
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

  // Enforce single winner rule
  const winners = parsed.data.presenters.filter((p) => p.isWinner);
  if (winners.length > 1) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "MULTIPLE_WINNERS", message: "Only one winner per Presentation Night is allowed." },
      meta: buildMeta()
    });
  }

  // Replace pattern: delete existing, insert new
  const { error: deleteError } = await supabase
    .from("crew_night_presenters")
    .delete()
    .eq("event_id", id);

  if (deleteError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "DELETE_FAILED", message: "Unable to clear existing presenters." },
      meta: buildMeta()
    });
  }

  if (parsed.data.presenters.length > 0) {
    const rows = parsed.data.presenters.map((p) => ({
      org_id: session.profile!.org_id,
      event_id: id,
      employee_id: p.employeeId,
      talk_title: p.talkTitle ?? null,
      slide_path: p.slidePath ?? null,
      slide_filename: p.slideFilename ?? null,
      vote_count: p.voteCount,
      is_winner: p.isWinner
    }));

    const { error: insertError } = await supabase
      .from("crew_night_presenters")
      .insert(rows);

    if (insertError) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "INSERT_FAILED", message: "Unable to save presenters." },
        meta: buildMeta()
      });
    }
  }

  // If event has a winner and is completed and results not yet published, publish results
  let shouldAnnounceResults = false;
  const hasWinner = winners.length === 1;
  if (event.status === "completed" && hasWinner && !event.results_published_at) {
    const { error: publishError } = await supabase
      .from("crew_night_events")
      .update({ results_published_at: new Date().toISOString() })
      .eq("id", id);

    if (!publishError) {
      shouldAnnounceResults = true;
    }
  }

  logAudit({
    action: "updated",
    tableName: "crew_night_presenters",
    recordId: id,
    newValue: { presenterCount: parsed.data.presenters.length }
  }).catch(() => undefined);

  if (shouldAnnounceResults) {
    const winner = winners[0];
    sendPresentationResultsAnnouncement(
      session.profile.org_id,
      event.title,
      winner!.employeeId,
      winner!.talkTitle ?? null
    ).catch(() => undefined);
  }

  return jsonResponse<{ saved: true }>(200, {
    data: { saved: true },
    error: null,
    meta: buildMeta()
  });
}

/* ── Results announcement ── */

async function sendPresentationResultsAnnouncement(
  orgId: string,
  eventTitle: string,
  winnerEmployeeId: string,
  talkTitle: string | null
): Promise<void> {
  const { createBulkNotifications } = await import("../../../../../../../lib/notifications/service");
  const { createSupabaseServiceRoleClient } = await import(
    "../../../../../../../lib/supabase/service-role"
  );

  const serviceClient = createSupabaseServiceRoleClient();

  // Fetch winner name
  const { data: winnerProfile } = await serviceClient
    .from("profiles")
    .select("full_name")
    .eq("id", winnerEmployeeId)
    .single();

  const winnerName = winnerProfile?.full_name ?? "A presenter";

  // Fetch all active users
  const { data: profiles } = await serviceClient
    .from("profiles")
    .select("id")
    .eq("org_id", orgId)
    .eq("status", "active")
    .is("deleted_at", null);

  if (!profiles || profiles.length === 0) return;

  const userIds = profiles.map((p: { id: string }) => p.id);

  const body = talkTitle
    ? `${winnerName}'s talk on "${talkTitle}" was voted the best!`
    : `${winnerName} was voted the best presenter!`;

  await createBulkNotifications({
    orgId,
    userIds,
    type: "crew_games_results",
    title: `Presentation Night winner: ${eventTitle}`,
    body,
    link: "/crew-games"
  });
}
