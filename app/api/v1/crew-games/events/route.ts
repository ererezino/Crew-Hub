import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { hasAnyRole } from "../../../../../lib/auth/roles";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { logAudit } from "../../../../../lib/audit";
import { buildMeta, jsonResponse, CREW_GAMES_ADMIN_ROLES } from "../_helpers";
import type {
  CrewNightEvent,
  CrewGamesEventsResponseData
} from "../../../../../types/crew-games";

/* ── Query schema ── */

const querySchema = z.object({
  type: z.enum(["games_night", "presentation_night"]).optional(),
  status: z.enum(["draft", "upcoming", "completed"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

/* ── Create schema ── */

const createSchema = z.object({
  eventType: z.enum(["games_night", "presentation_night"]),
  title: z.string().trim().min(1).max(200),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["draft", "upcoming", "completed"]).default("draft"),
  description: z.string().trim().max(2000).nullable().optional(),
  meetLink: z.string().url().nullable().optional(),
  kahootLink: z.string().url().nullable().optional(),
  altGameLink: z.string().url().nullable().optional(),
  featuredGame: z.string().trim().max(200).nullable().optional(),
  highlights: z.string().trim().max(5000).nullable().optional()
});

/* ── Helpers ── */

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

/* ── GET /api/v1/crew-games/events ── */

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse(
    Object.fromEntries(url.searchParams.entries())
  );

  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid query."
      },
      meta: buildMeta()
    });
  }

  const { type, status, limit } = parsed.data;
  const isAdmin = hasAnyRole(session.profile, CREW_GAMES_ADMIN_ROLES);
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("crew_night_events")
    .select("*")
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .order("event_date", { ascending: false })
    .limit(limit);

  if (type) {
    query = query.eq("event_type", type);
  }

  if (status) {
    query = query.eq("status", status);
  } else if (!isAdmin) {
    // Non-admins cannot see drafts
    query = query.in("status", ["upcoming", "completed"]);
  }

  const { data: rows, error: fetchError } = await query;

  if (fetchError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "FETCH_FAILED", message: "Unable to load events." },
      meta: buildMeta()
    });
  }

  const events = (rows ?? []).map(mapEventRow);

  return jsonResponse<CrewGamesEventsResponseData>(200, {
    data: { events },
    error: null,
    meta: buildMeta()
  });
}

/* ── POST /api/v1/crew-games/events ── */

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
      error: { code: "FORBIDDEN", message: "You do not have permission to create events." },
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

  const parsed = createSchema.safeParse(body);

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

  const insertData: Record<string, unknown> = {
    org_id: session.profile.org_id,
    event_type: payload.eventType,
    title: payload.title,
    event_date: payload.eventDate,
    status: payload.status,
    description: payload.description ?? null,
    meet_link: payload.meetLink ?? null,
    kahoot_link: payload.kahootLink ?? null,
    alt_game_link: payload.altGameLink ?? null,
    featured_game: payload.featuredGame ?? null,
    highlights: payload.highlights ?? null,
    created_by: session.profile.id
  };

  // If creating directly as "upcoming", set published_at
  if (payload.status === "upcoming") {
    insertData.published_at = new Date().toISOString();
  }

  const { data: row, error: insertError } = await supabase
    .from("crew_night_events")
    .insert(insertData)
    .select("*")
    .single();

  if (insertError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "INSERT_FAILED", message: "Unable to create event." },
      meta: buildMeta()
    });
  }

  const event = mapEventRow(row);

  logAudit({
    action: "created",
    tableName: "crew_night_events",
    recordId: event.id,
    newValue: { title: event.title, eventType: event.eventType, status: event.status }
  }).catch(() => undefined);

  // If published immediately, send announcement
  if (event.status === "upcoming" && event.publishedAt) {
    sendEventAnnouncement(session.profile.org_id, event).catch(() => undefined);
  }

  return jsonResponse<{ event: CrewNightEvent }>(201, {
    data: { event },
    error: null,
    meta: buildMeta()
  });
}

/* ── Announcement helper ── */

async function sendEventAnnouncement(orgId: string, event: CrewNightEvent): Promise<void> {
  const { createBulkNotifications } = await import("../../../../../lib/notifications/service");
  const { createSupabaseServiceRoleClient } = await import(
    "../../../../../lib/supabase/service-role"
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
    ? `${event.eventDate} — ${snippet}`
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
