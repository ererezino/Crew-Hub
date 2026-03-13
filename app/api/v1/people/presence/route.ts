import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import { hasRole } from "../../../../../lib/roles";
import type { ApiResponse } from "../../../../../types/auth";

/**
 * Presence thresholds:
 * - Online:  last_seen_at within 90s AND last_active_at within 5 minutes
 * - Away:    last_seen_at within 90s BUT last_active_at > 5 minutes (or null)
 * - Offline: last_seen_at > 90s or null
 */
const HEARTBEAT_THRESHOLD_MS = 90 * 1000;
const ACTIVITY_THRESHOLD_MS = 5 * 60 * 1000;

type PresenceState = "online" | "away" | "offline";

type PresenceEntry = {
  id: string;
  fullName: string;
  department: string | null;
  avatarUrl: string | null;
  availabilityStatus: string;
  statusNote: string | null;
  presence: PresenceState;
  lastSeenAt: string | null;
  awaySince: string | null;
};

const PresenceMetaSchema = z.object({
  timestamp: z.string()
});

function buildMeta() {
  return PresenceMetaSchema.parse({ timestamp: new Date().toISOString() });
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function computePresence(
  lastSeenAt: string | null,
  lastActiveAt: string | null,
  now: Date
): { state: PresenceState; awaySince: string | null } {
  if (!lastSeenAt || now.getTime() - new Date(lastSeenAt).getTime() > HEARTBEAT_THRESHOLD_MS) {
    return { state: "offline", awaySince: null };
  }

  if (lastActiveAt && now.getTime() - new Date(lastActiveAt).getTime() <= ACTIVITY_THRESHOLD_MS) {
    return { state: "online", awaySince: null };
  }

  /* Away: heartbeat recent but activity stale */
  return { state: "away", awaySince: lastActiveAt ?? lastSeenAt };
}

/**
 * GET /api/v1/people/presence
 *
 * Returns presence state for all org members.
 * Accessible only to super admins (returns 403 for other roles).
 */
export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  /* Super-admin gate — hard block, no data returned */
  if (!hasRole(session.profile.roles, "SUPER_ADMIN")) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Presence data is restricted to super admins." },
      meta: buildMeta()
    });
  }

  const supabase = createSupabaseServiceRoleClient();
  const now = new Date();

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, full_name, department, avatar_url, availability_status, status_note, last_seen_at, last_active_at")
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .order("full_name");

  if (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Failed to load team presence." },
      meta: buildMeta()
    });
  }

  const entries: PresenceEntry[] = (profiles ?? []).map((p) => {
    const { state, awaySince } = computePresence(
      p.last_seen_at as string | null,
      p.last_active_at as string | null,
      now
    );
    return {
      id: p.id as string,
      fullName: (p.full_name as string) ?? "Unknown",
      department: (p.department as string) ?? null,
      avatarUrl: (p.avatar_url as string) ?? null,
      availabilityStatus: (p.availability_status as string) ?? "available",
      statusNote: (p.status_note as string) ?? null,
      presence: state,
      lastSeenAt: (p.last_seen_at as string) ?? null,
      awaySince,
    };
  });

  /* Sort: online first, then away, then offline (most recently seen first), then alphabetical */
  const presenceOrder: Record<PresenceState, number> = { online: 0, away: 1, offline: 2 };
  entries.sort((a, b) => {
    const orderDiff = presenceOrder[a.presence] - presenceOrder[b.presence];
    if (orderDiff !== 0) return orderDiff;
    /* Within offline, sort by most recently seen first */
    if (a.presence === "offline" && b.presence === "offline") {
      const aTime = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
      const bTime = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
      if (aTime !== bTime) return bTime - aTime; // descending — most recent first
    }
    return a.fullName.localeCompare(b.fullName);
  });

  const counts = {
    online: entries.filter((e) => e.presence === "online").length,
    away: entries.filter((e) => e.presence === "away").length,
    offline: entries.filter((e) => e.presence === "offline").length,
  };

  return jsonResponse<{ entries: PresenceEntry[]; counts: typeof counts; serverTime: string }>(200, {
    data: { entries, counts, serverTime: now.toISOString() },
    error: null,
    meta: buildMeta()
  });
}
