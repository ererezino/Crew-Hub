import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import { createBulkNotifications } from "../../../../../lib/notifications/service";
import type { ApiResponse } from "../../../../../types/auth";

const AVAILABILITY_STATUSES = ["available", "afk", "ooo"] as const;

const STATUS_LABELS: Record<(typeof AVAILABILITY_STATUSES)[number], string> = {
  available: "Available",
  afk: "Away From Keyboard",
  ooo: "Out of Office"
};

const updateStatusSchema = z.object({
  status: z.enum(AVAILABILITY_STATUSES),
  note: z.string().trim().max(200).optional().default(""),
  durationMinutes: z.number().int().min(15).max(120).optional(),
  durationDays: z.number().int().min(1).max(10).optional()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export async function PATCH(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
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

  const parsed = updateStatusSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid status." },
      meta: buildMeta()
    });
  }

  /* Calculate status_expires_at when a duration is provided */
  let statusExpiresAt: string | null = null;

  if (parsed.data.status !== "available") {
    const now = new Date();
    if (parsed.data.durationDays) {
      statusExpiresAt = new Date(now.getTime() + parsed.data.durationDays * 24 * 60 * 60 * 1000).toISOString();
    } else if (parsed.data.durationMinutes) {
      statusExpiresAt = new Date(now.getTime() + parsed.data.durationMinutes * 60 * 1000).toISOString();
    }
  }

  const supabase = createSupabaseServiceRoleClient();

  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      availability_status: parsed.data.status,
      status_note: parsed.data.note || null,
      status_updated_at: new Date().toISOString(),
      status_expires_at: statusExpiresAt
    })
    .eq("id", session.profile.id)
    .eq("org_id", session.profile.org_id);

  if (updateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "STATUS_UPDATE_FAILED", message: "Unable to update your status." },
      meta: buildMeta()
    });
  }

  // Send team notification when changing to AFK or OOO
  if (parsed.data.status !== "available") {
    const statusLabel = STATUS_LABELS[parsed.data.status];
    const fullName = session.profile.full_name ?? "A crew member";

    // Build notification title with optional duration
    let notificationTitle = `${fullName} is ${statusLabel}`;
    if (parsed.data.durationDays) {
      const days = parsed.data.durationDays;
      const durationLabel = days === 1 ? "1 day" : `${days} days`;
      notificationTitle = `${fullName} is ${statusLabel} for ${durationLabel}`;
    } else if (parsed.data.durationMinutes) {
      const mins = parsed.data.durationMinutes;
      const durationLabel =
        mins < 60
          ? `${mins} min`
          : mins === 60
            ? "1 hr"
            : mins === 120
              ? "2 hrs"
              : `${Math.floor(mins / 60)} hr ${mins % 60} min`;
      notificationTitle = `${fullName} is ${statusLabel} for ${durationLabel}`;
    }

    // Fetch all org members — company-wide notification
    const { data: orgMembers } = await supabase
      .from("profiles")
      .select("id")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null);

    if (orgMembers && orgMembers.length > 0) {
      void createBulkNotifications({
        orgId: session.profile.org_id,
        userIds: orgMembers.map((m) => m.id),
        type: "status_change",
        title: notificationTitle,
        body: parsed.data.note || "",
        link: "/people",
        skipIfUnreadDuplicate: false
      });
    }
  }

  return jsonResponse<{ status: string; note: string; expiresAt: string | null }>(200, {
    data: { status: parsed.data.status, note: parsed.data.note, expiresAt: statusExpiresAt },
    error: null,
    meta: buildMeta()
  });
}
