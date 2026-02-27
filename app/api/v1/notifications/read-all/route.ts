import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import type { ApiResponse } from "../../../../../types/auth";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export async function PATCH() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to update notifications."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const readAt = new Date().toISOString();

  const { error } = await supabase
    .from("notifications")
    .update({
      is_read: true,
      read_at: readAt
    })
    .eq("org_id", session.profile.org_id)
    .eq("user_id", session.profile.id)
    .eq("is_read", false)
    .is("deleted_at", null);

  if (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "NOTIFICATION_READ_ALL_FAILED",
        message: "Unable to mark all notifications as read."
      },
      meta: buildMeta()
    });
  }

  return jsonResponse<{ readAt: string }>(200, {
    data: {
      readAt
    },
    error: null,
    meta: buildMeta()
  });
}
