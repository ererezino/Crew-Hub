import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../types/auth";

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
 * Called every ~60s by the client while the user is active.
 * Updates `last_seen_at` and auto-expires AFK/OOO statuses when their duration has passed.
 */
export async function POST() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  const supabase = createSupabaseServiceRoleClient();
  const now = new Date();
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
      await supabase
        .from("profiles")
        .update({
          availability_status: "available",
          status_note: null,
          status_expires_at: null,
          status_updated_at: now.toISOString(),
          last_seen_at: now.toISOString()
        })
        .eq("id", profileId)
        .eq("org_id", orgId);

      statusExpired = true;
    }
  }

  /* ── 2. Update last_seen_at (heartbeat) ── */
  if (!statusExpired) {
    await supabase
      .from("profiles")
      .update({ last_seen_at: now.toISOString() })
      .eq("id", profileId)
      .eq("org_id", orgId);
  }

  return jsonResponse<{
    lastSeenAt: string;
    statusExpired: boolean;
    currentStatus: string | null;
  }>(200, {
    data: {
      lastSeenAt: now.toISOString(),
      statusExpired,
      currentStatus: statusExpired ? "available" : (currentProfile?.availability_status ?? null)
    },
    error: null,
    meta: buildMeta()
  });
}
