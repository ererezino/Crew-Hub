import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { hasAnyRole } from "../../../../../../lib/auth/roles";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { logAudit } from "../../../../../../lib/audit";
import { buildMeta, jsonResponse, CREW_GAMES_ADMIN_ROLES } from "../../_helpers";
import type {
  CrewNightEvent,
  CrewNightResult,
  CrewNightPresenter,
  CrewGamesEventDetailResponseData
} from "../../../../../../types/crew-games";

type RouteParams = { params: Promise<{ id: string }> };

/* ── Update schema ── */

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(["draft", "upcoming", "completed"]).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  meetLink: z.string().url().nullable().optional(),
  kahootLink: z.string().url().nullable().optional(),
  altGameLink: z.string().url().nullable().optional(),
  featuredGame: z.string().trim().max(200).nullable().optional(),
  highlights: z.string().trim().max(5000).nullable().optional(),
  eventImagePath: z.string().nullable().optional()
});

/* ── Mappers ── */

function mapEventRow(row: Record<string, unknown>): CrewNightEvent {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    eventType: row.event_type as CrewNightEvent["eventType"],
    title: row.title as string,
    eventDate: row.event_date as string,
    status: row.status as CrewNightEvent["status"],
    description: (row.description as string) ?? null,
    meetLink: (row.meet_link as string) ?? null,
    kahootLink: (row.kahoot_link as string) ?? null,
    altGameLink: (row.alt_game_link as string) ?? null,
    featuredGame: (row.featured_game as string) ?? null,
    eventImagePath: (row.event_image_path as string) ?? null,
    highlights: (row.highlights as string) ?? null,
    publishedAt: (row.published_at as string) ?? null,
    resultsPublishedAt: (row.results_published_at as string) ?? null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  };
}

function mapResultRow(row: Record<string, unknown>): CrewNightResult {
  const profile = row.profiles as Record<string, unknown> | null;
  return {
    id: row.id as string,
    eventId: row.event_id as string,
    nickname: row.nickname as string,
    employeeId: (row.employee_id as string) ?? null,
    employeeName: profile ? (profile.full_name as string) : null,
    score: row.score !== null && row.score !== undefined ? Number(row.score) : null,
    placement: (row.placement as number) ?? null,
    pointsAwarded: (row.points_awarded as number) ?? 0
  };
}

function mapPresenterRow(row: Record<string, unknown>): CrewNightPresenter {
  const profile = row.profiles as Record<string, unknown> | null;
  return {
    id: row.id as string,
    eventId: row.event_id as string,
    employeeId: row.employee_id as string,
    employeeName: profile ? (profile.full_name as string) : "Unknown",
    avatarUrl: profile ? ((profile.avatar_url as string) ?? null) : null,
    talkTitle: (row.talk_title as string) ?? null,
    slidePath: (row.slide_path as string) ?? null,
    slideFilename: (row.slide_filename as string) ?? null,
    voteCount: (row.vote_count as number) ?? 0,
    isWinner: (row.is_winner as boolean) ?? false
  };
}

/* ── GET /api/v1/crew-games/events/[id] ── */

export async function GET(_request: Request, { params }: RouteParams) {
  const session = await getAuthenticatedSession();
  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: eventRow, error: fetchError } = await supabase
    .from("crew_night_events")
    .select("*")
    .eq("id", id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "FETCH_FAILED", message: "Unable to load event." },
      meta: buildMeta()
    });
  }

  if (!eventRow) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Event not found." },
      meta: buildMeta()
    });
  }

  // Draft events are admin-only
  const isAdmin = hasAnyRole(session.profile, CREW_GAMES_ADMIN_ROLES);
  if (eventRow.status === "draft" && !isAdmin) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Event not found." },
      meta: buildMeta()
    });
  }

  const event = mapEventRow(eventRow);

  // Fetch results
  const { data: resultRows } = await supabase
    .from("crew_night_results")
    .select("*, profiles:employee_id(full_name)")
    .eq("event_id", id)
    .order("placement", { ascending: true, nullsFirst: false });

  const results = (resultRows ?? []).map(mapResultRow);

  // Fetch presenters
  const { data: presenterRows } = await supabase
    .from("crew_night_presenters")
    .select("*, profiles:employee_id(full_name, avatar_url)")
    .eq("event_id", id)
    .order("vote_count", { ascending: false });

  const presenters = (presenterRows ?? []).map(mapPresenterRow);

  return jsonResponse<CrewGamesEventDetailResponseData>(200, {
    data: { event, results, presenters },
    error: null,
    meta: buildMeta()
  });
}

/* ── PUT /api/v1/crew-games/events/[id] ── */

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
      error: { code: "FORBIDDEN", message: "You do not have permission to edit events." },
      meta: buildMeta()
    });
  }

  const { id } = await params;

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

  const parsed = updateSchema.safeParse(body);
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

  // Fetch current state to check publish transitions
  const { data: existing, error: existError } = await supabase
    .from("crew_night_events")
    .select("status, published_at, results_published_at, title, event_type, event_date, description, featured_game")
    .eq("id", id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (existError || !existing) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Event not found." },
      meta: buildMeta()
    });
  }

  const payload = parsed.data;
  const updateData: Record<string, unknown> = {};

  if (payload.title !== undefined) updateData.title = payload.title;
  if (payload.eventDate !== undefined) updateData.event_date = payload.eventDate;
  if (payload.description !== undefined) updateData.description = payload.description;
  if (payload.meetLink !== undefined) updateData.meet_link = payload.meetLink;
  if (payload.kahootLink !== undefined) updateData.kahoot_link = payload.kahootLink;
  if (payload.altGameLink !== undefined) updateData.alt_game_link = payload.altGameLink;
  if (payload.featuredGame !== undefined) updateData.featured_game = payload.featuredGame;
  if (payload.highlights !== undefined) updateData.highlights = payload.highlights;
  if (payload.eventImagePath !== undefined) updateData.event_image_path = payload.eventImagePath;
  if (payload.status !== undefined) updateData.status = payload.status;

  // Draft → upcoming first publish: set published_at and send announcement
  let shouldAnnounceEvent = false;
  if (
    payload.status === "upcoming" &&
    existing.status === "draft" &&
    !existing.published_at
  ) {
    updateData.published_at = new Date().toISOString();
    shouldAnnounceEvent = true;
  }

  if (Object.keys(updateData).length === 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "NO_CHANGES", message: "No fields to update." },
      meta: buildMeta()
    });
  }

  const { data: updatedRow, error: updateError } = await supabase
    .from("crew_night_events")
    .update(updateData)
    .eq("id", id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .select("*")
    .single();

  if (updateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "UPDATE_FAILED", message: "Unable to update event." },
      meta: buildMeta()
    });
  }

  const event = mapEventRow(updatedRow);

  logAudit({
    action: "updated",
    tableName: "crew_night_events",
    recordId: id,
    newValue: updateData
  }).catch(() => undefined);

  if (shouldAnnounceEvent) {
    sendEventAnnouncement(session.profile.org_id, event).catch(() => undefined);
  }

  return jsonResponse<{ event: CrewNightEvent }>(200, {
    data: { event },
    error: null,
    meta: buildMeta()
  });
}

/* ── DELETE /api/v1/crew-games/events/[id] ── */

export async function DELETE(_request: Request, { params }: RouteParams) {
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
      error: { code: "FORBIDDEN", message: "You do not have permission to delete events." },
      meta: buildMeta()
    });
  }

  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { error: deleteError } = await supabase
    .from("crew_night_events")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null);

  if (deleteError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "DELETE_FAILED", message: "Unable to delete event." },
      meta: buildMeta()
    });
  }

  logAudit({
    action: "deleted",
    tableName: "crew_night_events",
    recordId: id
  }).catch(() => undefined);

  return jsonResponse<{ deleted: true }>(200, {
    data: { deleted: true },
    error: null,
    meta: buildMeta()
  });
}

/* ── Announcement helper ── */

async function sendEventAnnouncement(orgId: string, event: CrewNightEvent): Promise<void> {
  const { createBulkNotifications } = await import("../../../../../../lib/notifications/service");
  const { createSupabaseServiceRoleClient } = await import(
    "../../../../../../lib/supabase/service-role"
  );

  const serviceClient = createSupabaseServiceRoleClient();
  const { data: profiles } = await serviceClient
    .from("profiles")
    .select("id")
    .eq("org_id", orgId)
    .eq("status", "active")
    .is("deleted_at", null);

  if (!profiles || profiles.length === 0) return;

  const userIds = profiles.map((p: { id: string }) => p.id);
  const typeLabel = event.eventType === "games_night" ? "Games Night" : "Presentation Night";
  const snippet = event.description
    ? event.description.slice(0, 120)
    : event.featuredGame ?? "";

  const title = `${typeLabel}: ${event.title}`;
  const body = snippet
    ? `${event.eventDate}: ${snippet}`
    : event.eventDate;

  await createBulkNotifications({
    orgId,
    userIds,
    type: "crew_games_event",
    title,
    body,
    link: "/crew-games"
  });
}
