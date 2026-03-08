import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import type { AnnouncementDismissResponseData } from "../../../../../types/announcements";

const dismissSchema = z.object({
  announcementId: z.string().uuid()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to dismiss announcements."
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

  const parsedBody = dismissSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid dismiss payload."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: announcement, error: announcementError } = await supabase
    .from("announcements")
    .select("id")
    .eq("id", parsedBody.data.announcementId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (announcementError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ANNOUNCEMENT_FETCH_FAILED",
        message: "Unable to verify announcement before dismissing."
      },
      meta: buildMeta()
    });
  }

  if (!announcement) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Announcement not found."
      },
      meta: buildMeta()
    });
  }

  const dismissedAt = new Date().toISOString();

  const { error: upsertError } = await supabase.from("announcement_reads").upsert(
    {
      announcement_id: parsedBody.data.announcementId,
      user_id: session.profile.id,
      read_at: dismissedAt,
      dismissed_at: dismissedAt
    },
    { onConflict: "announcement_id,user_id" }
  );

  if (upsertError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ANNOUNCEMENT_DISMISS_FAILED",
        message: "Unable to dismiss announcement."
      },
      meta: buildMeta()
    });
  }

  return jsonResponse<AnnouncementDismissResponseData>(200, {
    data: {
      announcementId: parsedBody.data.announcementId,
      dismissedAt
    },
    error: null,
    meta: buildMeta()
  });
}
