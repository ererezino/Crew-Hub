import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../types/auth";

const HeartbeatBodySchema = z.object({
  isActive: z.boolean().optional(),
}).optional();

const HeartbeatMetaSchema = z.object({
  timestamp: z.string()
});

function buildMeta() {
  return HeartbeatMetaSchema.parse({ timestamp: new Date().toISOString() });
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

/**
 * POST /api/v1/me/heartbeat
 *
 * Called every ~30s by the client.
 * Body: { isActive: boolean } — whether user had mouse/keyboard activity since last heartbeat.
 * Updates `last_seen_at` always, and `last_active_at` only when isActive is true.
 * Also auto-expires AFK/OOO statuses when their duration has passed.
 *
 * Supports both JSON and sendBeacon (Blob with application/json content-type).
 * Old clients sending no body are treated as isActive: true (conservative).
 */
export async function POST(request: NextRequest) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  /* Parse optional body — handle both fetch() and sendBeacon() payloads */
  let isActive = true; // default: assume active (backwards-compatible with old clients)
  try {
    const text = await request.text();
    if (text) {
      const parsed = HeartbeatBodySchema.parse(JSON.parse(text));
      if (parsed?.isActive !== undefined) {
        isActive = parsed.isActive;
      }
    }
  } catch {
    /* Malformed body — treat as active (conservative) */
  }

  const supabase = createSupabaseServiceRoleClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const profileId = session.profile.id;
  const orgId = session.profile.org_id;

  /* ── 1. Check if status should auto-expire ── */
  let statusExpired = false;

  const { data: currentProfile } = await supabase
    .from("profiles")
    .select("availability_status, status_expires_at")
    .eq("id", profileId)
    .eq("org_id", orgId)
    .single();

  if (
    currentProfile?.status_expires_at &&
    currentProfile.availability_status !== "available"
  ) {
    const expiresAt = new Date(currentProfile.status_expires_at);
    if (now >= expiresAt) {
      /* Status has expired — revert to "available" */
      const updateFields: Record<string, string | null> = {
        availability_status: "available",
        status_note: null,
        status_expires_at: null,
        status_updated_at: nowIso,
        last_seen_at: nowIso,
      };
      if (isActive) {
        updateFields.last_active_at = nowIso;
      }
      await supabase
        .from("profiles")
        .update(updateFields)
        .eq("id", profileId)
        .eq("org_id", orgId);

      statusExpired = true;
    }
  }

  /* ── 2. Update timestamps ── */
  if (!statusExpired) {
    const updateFields: Record<string, string> = { last_seen_at: nowIso };
    if (isActive) {
      updateFields.last_active_at = nowIso;
    }
    await supabase
      .from("profiles")
      .update(updateFields)
      .eq("id", profileId)
      .eq("org_id", orgId);
  }

  return jsonResponse<{
    lastSeenAt: string;
    statusExpired: boolean;
    currentStatus: string | null;
  }>(200, {
    data: {
      lastSeenAt: nowIso,
      statusExpired,
      currentStatus: statusExpired ? "available" : (currentProfile?.availability_status ?? null)
    },
    error: null,
    meta: buildMeta()
  });
}
