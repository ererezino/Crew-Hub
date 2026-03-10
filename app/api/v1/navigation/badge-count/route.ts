import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";

const querySchema = z.object({});

type BadgeCountResponseData = {
  unreadAnnouncements: number;
  unreadNotifications: number;
  total: number;
};

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export async function GET(request: Request) {
  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid badge count query."
      },
      meta: buildMeta()
    });
  }

  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view badge counts."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const { profile } = session;

  const [
    announcementIdsResult,
    unreadNotificationsResult
  ] = await Promise.all([
    supabase
      .from("announcements")
      .select("id")
      .eq("org_id", profile.org_id)
      .is("deleted_at", null),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .is("read_at", null)
      .is("deleted_at", null)
  ]);

  const announcementIds = (announcementIdsResult.data ?? [])
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string");

  let unreadAnnouncements = 0;
  if (announcementIds.length > 0 && !announcementIdsResult.error) {
    const { data: readRows, error: readRowsError } = await supabase
      .from("announcement_reads")
      .select("announcement_id, read_at, dismissed_at")
      .eq("user_id", profile.id)
      .in("announcement_id", announcementIds);

    if (!readRowsError) {
      const hiddenAnnouncementIds = new Set(
        (readRows ?? [])
          .filter((row) => Boolean(row.read_at) || Boolean(row.dismissed_at))
          .map((row) => row.announcement_id)
      );

      unreadAnnouncements = announcementIds.reduce((count, announcementId) => {
        return hiddenAnnouncementIds.has(announcementId) ? count : count + 1;
      }, 0);
    }
  }

  const unreadNotifications =
    typeof unreadNotificationsResult.count === "number"
      ? unreadNotificationsResult.count
      : 0;

  return jsonResponse<BadgeCountResponseData>(200, {
    data: {
      unreadAnnouncements,
      unreadNotifications,
      total: unreadAnnouncements + unreadNotifications
    },
    error: null,
    meta: buildMeta()
  });
}
