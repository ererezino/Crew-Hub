import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../types/auth";
import type { NotificationPreferences } from "../../../../../types/settings";

const notificationsSchema = z.object({
  emailAnnouncements: z.boolean(),
  emailApprovals: z.boolean(),
  inAppReminders: z.boolean()
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
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to update notification settings."
      },
      meta: buildMeta()
    });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Request body must be valid JSON."
      },
      meta: buildMeta()
    });
  }

  const parsed = notificationsSchema.safeParse(body);

  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid notification payload."
      },
      meta: buildMeta()
    });
  }

  const serviceClient = createSupabaseServiceRoleClient();

  const { data, error } = await serviceClient
    .from("profiles")
    .update({
      notification_preferences: parsed.data
    })
    .eq("id", session.profile.id)
    .select("notification_preferences")
    .single();

  if (error || !data) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "NOTIFICATION_UPDATE_FAILED",
        message: "Unable to update notification settings."
      },
      meta: buildMeta()
    });
  }

  return jsonResponse<NotificationPreferences>(200, {
    data: {
      emailAnnouncements: Boolean(data.notification_preferences?.emailAnnouncements),
      emailApprovals: Boolean(data.notification_preferences?.emailApprovals),
      inAppReminders: Boolean(data.notification_preferences?.inAppReminders)
    },
    error: null,
    meta: buildMeta()
  });
}
