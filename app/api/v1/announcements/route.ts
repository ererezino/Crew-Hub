import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { logAudit } from "../../../../lib/audit";
import { logger } from "../../../../lib/logger";
import { createBulkNotifications } from "../../../../lib/notifications/service";
import type { UserRole } from "../../../../lib/navigation";
import { hasRole } from "../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../types/auth";
import type { Announcement, AnnouncementsResponseData } from "../../../../types/announcements";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  dismissed: z.enum(["true", "false"]).optional()
});

const announcementWriteSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title is too long"),
  body: z.string().trim().min(1, "Body is required").max(5000, "Body is too long"),
  isPinned: z.boolean().default(false)
});

const announcementRowSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  is_pinned: z.boolean(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string()
});

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string()
});

const readRowSchema = z.object({
  announcement_id: z.string().uuid(),
  read_at: z.string(),
  dismissed_at: z.string().nullable()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function canManageAnnouncements(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "HR_ADMIN") || hasRole(roles, "SUPER_ADMIN");
}

function toAnnouncement(
  row: z.infer<typeof announcementRowSchema>,
  creatorNameById: ReadonlyMap<string, string>,
  readAtByAnnouncementId: ReadonlyMap<string, string>,
  dismissedAtByAnnouncementId: ReadonlyMap<string, string>
): Announcement {
  const readAt = readAtByAnnouncementId.get(row.id) ?? null;
  const dismissedAt = dismissedAtByAnnouncementId.get(row.id) ?? null;

  return {
    id: row.id,
    title: row.title,
    body: row.body,
    isPinned: row.is_pinned,
    createdBy: row.created_by,
    creatorName: creatorNameById.get(row.created_by) ?? "Unknown user",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isRead: Boolean(readAt),
    readAt,
    isDismissed: Boolean(dismissedAt),
    dismissedAt
  };
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view announcements."
      },
      meta: buildMeta()
    });
  }

  const profile = session.profile;

  const requestUrl = new URL(request.url);
  const parsedQuery = listQuerySchema.safeParse(
    Object.fromEntries(requestUrl.searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid announcements query."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  let announcementsQuery = supabase
    .from("announcements")
    .select("id, title, body, is_pinned, created_by, created_at, updated_at")
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false });

  if (parsedQuery.data.limit) {
    announcementsQuery = announcementsQuery.limit(parsedQuery.data.limit);
  }

  const { data: rawAnnouncements, error: announcementsError } = await announcementsQuery;

  if (announcementsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ANNOUNCEMENTS_FETCH_FAILED",
        message: "Unable to load announcements."
      },
      meta: buildMeta()
    });
  }

  const parsedAnnouncements = z.array(announcementRowSchema).safeParse(rawAnnouncements ?? []);

  if (!parsedAnnouncements.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ANNOUNCEMENTS_PARSE_FAILED",
        message: "Announcement data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const announcementsRows = parsedAnnouncements.data;
  const announcementIds = announcementsRows.map((row) => row.id);
  const creatorIds = [...new Set(announcementsRows.map((row) => row.created_by))];

  let creatorNameById = new Map<string, string>();

  if (creatorIds.length > 0) {
    const { data: rawCreators, error: creatorsError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", profile.org_id)
      .is("deleted_at", null)
      .in("id", creatorIds);

    if (creatorsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "ANNOUNCEMENT_CREATORS_FETCH_FAILED",
          message: "Unable to load announcement creators."
        },
        meta: buildMeta()
      });
    }

    const parsedCreators = z.array(profileRowSchema).safeParse(rawCreators ?? []);

    if (!parsedCreators.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "ANNOUNCEMENT_CREATORS_PARSE_FAILED",
          message: "Announcement creator data is not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    creatorNameById = new Map(parsedCreators.data.map((row) => [row.id, row.full_name]));
  }

  let readAtByAnnouncementId = new Map<string, string>();
  let dismissedAtByAnnouncementId = new Map<string, string>();

  if (announcementIds.length > 0) {
    const { data: rawReadRows, error: readRowsError } = await supabase
      .from("announcement_reads")
      .select("announcement_id, read_at, dismissed_at")
      .eq("user_id", profile.id)
      .in("announcement_id", announcementIds);

    if (readRowsError) {
      // Non-fatal: if read state fails, treat all announcements as unread/undismissed
      logger.error("Unable to load announcement read state.", {
        userId: profile.id,
        message: readRowsError.message
      });
    } else {
      const parsedReadRows = z.array(readRowSchema).safeParse(rawReadRows ?? []);

      if (parsedReadRows.success) {
        readAtByAnnouncementId = new Map(
          parsedReadRows.data.map((row) => [row.announcement_id, row.read_at])
        );

        dismissedAtByAnnouncementId = new Map(
          parsedReadRows.data
            .filter((row) => row.dismissed_at !== null)
            .map((row) => [row.announcement_id, row.dismissed_at!])
        );
      } else {
        logger.error("Announcement read state is not in the expected shape.", {
          userId: profile.id
        });
      }
    }
  }

  const showDismissed = parsedQuery.data.dismissed === "true";

  const allAnnouncements = announcementsRows.map((row) =>
    toAnnouncement(row, creatorNameById, readAtByAnnouncementId, dismissedAtByAnnouncementId)
  );

  const announcements = showDismissed
    ? allAnnouncements.filter((a) => a.isDismissed)
    : allAnnouncements.filter((a) => !a.isDismissed);

  const responseData: AnnouncementsResponseData = {
    announcements
  };

  return jsonResponse<AnnouncementsResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to create announcements."
      },
      meta: buildMeta()
    });
  }

  const profile = session.profile;

  if (!canManageAnnouncements(profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin users can create announcements."
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

  const parsedBody = announcementWriteSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid announcement payload."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: insertedAnnouncement, error: insertError } = await supabase
    .from("announcements")
    .insert({
      org_id: profile.org_id,
      title: parsedBody.data.title.trim(),
      body: parsedBody.data.body.trim(),
      is_pinned: parsedBody.data.isPinned,
      created_by: profile.id
    })
    .select("id, title, body, is_pinned, created_by, created_at, updated_at")
    .single();

  if (insertError || !insertedAnnouncement) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ANNOUNCEMENT_CREATE_FAILED",
        message: "Unable to create announcement."
      },
      meta: buildMeta()
    });
  }

  const parsedAnnouncement = announcementRowSchema.safeParse(insertedAnnouncement);

  if (!parsedAnnouncement.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ANNOUNCEMENT_PARSE_FAILED",
        message: "Created announcement data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "created",
    tableName: "announcements",
    recordId: parsedAnnouncement.data.id,
    newValue: {
      title: parsedAnnouncement.data.title,
      isPinned: parsedAnnouncement.data.is_pinned
    }
  }).catch(() => undefined);

  const createdReadAt = new Date().toISOString();

  const { error: readUpsertError } = await supabase.from("announcement_reads").upsert(
    {
      announcement_id: parsedAnnouncement.data.id,
      user_id: profile.id,
      read_at: createdReadAt
    },
    { onConflict: "announcement_id,user_id" }
  );

  if (readUpsertError) {
    logger.error("Unable to mark newly created announcement as read.", {
      announcementId: parsedAnnouncement.data.id,
      message: readUpsertError.message
    });
  }

  const announcement = toAnnouncement(
    parsedAnnouncement.data,
    new Map([[profile.id, profile.full_name]]),
    new Map([[parsedAnnouncement.data.id, createdReadAt]]),
    new Map()
  );

  const { data: recipientRows, error: recipientError } = await supabase
    .from("profiles")
    .select("id")
    .eq("org_id", profile.org_id)
    .is("deleted_at", null);

  if (recipientError) {
    logger.error("Unable to load announcement recipients.", {
      announcementId: parsedAnnouncement.data.id,
      message: recipientError.message
    });
  } else {
    const recipientUserIds = (recipientRows ?? [])
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string" && id !== profile.id);

    await createBulkNotifications({
      orgId: profile.org_id,
      userIds: recipientUserIds,
      type: "announcement",
      title: `New announcement: ${parsedAnnouncement.data.title}`,
      body: parsedAnnouncement.data.body.slice(0, 220),
      link: "/announcements"
    });
  }

  return jsonResponse<{ announcement: Announcement }>(201, {
    data: {
      announcement
    },
    error: null,
    meta: buildMeta()
  });
}
