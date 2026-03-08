import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";

/**
 * Presence thresholds (in milliseconds):
 * - Online:  last_seen_at within 2 minutes
 * - Away:    last_seen_at between 2–5 minutes
 * - Offline: last_seen_at > 5 minutes or null
 */
const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;
const AWAY_THRESHOLD_MS = 5 * 60 * 1000;

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

function computePresence(lastSeenAt: string | null, now: Date): PresenceState {
  if (!lastSeenAt) return "offline";
  const diff = now.getTime() - new Date(lastSeenAt).getTime();
  if (diff <= ONLINE_THRESHOLD_MS) return "online";
  if (diff <= AWAY_THRESHOLD_MS) return "away";
  return "offline";
}

/**
 * GET /api/v1/people/presence
 *
 * Returns presence state for all org members.
 * Accessible to any authenticated org member.
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

  const supabase = await createSupabaseServerClient();
  const now = new Date();

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, full_name, department, avatar_url, availability_status, status_note, last_seen_at")
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

  const entries: PresenceEntry[] = (profiles ?? []).map((p) => ({
    id: p.id as string,
    fullName: (p.full_name as string) ?? "Unknown",
    department: (p.department as string) ?? null,
    avatarUrl: (p.avatar_url as string) ?? null,
    availabilityStatus: (p.availability_status as string) ?? "available",
    statusNote: (p.status_note as string) ?? null,
    presence: computePresence(p.last_seen_at as string | null, now),
    lastSeenAt: (p.last_seen_at as string) ?? null
  }));

  /* Sort: online first, then away, then offline, then alphabetical */
  const presenceOrder: Record<PresenceState, number> = { online: 0, away: 1, offline: 2 };
  entries.sort((a, b) => {
    const orderDiff = presenceOrder[a.presence] - presenceOrder[b.presence];
    if (orderDiff !== 0) return orderDiff;
    return a.fullName.localeCompare(b.fullName);
  });

  const counts = {
    online: entries.filter((e) => e.presence === "online").length,
    away: entries.filter((e) => e.presence === "away").length,
    offline: entries.filter((e) => e.presence === "offline").length
  };

  return jsonResponse<{ entries: PresenceEntry[]; counts: typeof counts }>(200, {
    data: { entries, counts },
    error: null,
    meta: buildMeta()
  });
}
