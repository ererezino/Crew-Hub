import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createBulkNotifications } from "../../../../../lib/notifications/service";
import type { UserRole } from "../../../../../lib/navigation";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import type { Announcement } from "../../../../../types/announcements";

const paramsSchema = z.object({
  announcementId: z.string().uuid()
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

const readRowSchema = z.object({
  read_at: z.string()
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
  creatorName: string,
  readAt: string | null
): Announcement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    isPinned: row.is_pinned,
    createdBy: row.created_by,
    creatorName,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isRead: Boolean(readAt),
    readAt
  };
}

type RouteContext = {
  params: Promise<{ announcementId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to update announcements."
      },
      meta: buildMeta()
    });
  }

  const profile = session.profile;

  if (!canManageAnnouncements(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin users can update announcements."
      },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Announcement id must be a valid UUID."
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
  const announcementId = parsedParams.data.announcementId;

  const { data: existingAnnouncement, error: existingError } = await supabase
    .from("announcements")
    .select("id")
    .eq("id", announcementId)
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ANNOUNCEMENT_FETCH_FAILED",
        message: "Unable to fetch the announcement before update."
      },
      meta: buildMeta()
    });
  }

  if (!existingAnnouncement) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Announcement not found."
      },
      meta: buildMeta()
    });
  }

  const { data: updatedAnnouncement, error: updateError } = await supabase
    .from("announcements")
    .update({
      title: parsedBody.data.title.trim(),
      body: parsedBody.data.body.trim(),
      is_pinned: parsedBody.data.isPinned
    })
    .eq("id", announcementId)
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .select("id, title, body, is_pinned, created_by, created_at, updated_at")
    .single();

  if (updateError || !updatedAnnouncement) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ANNOUNCEMENT_UPDATE_FAILED",
        message: "Unable to update announcement."
      },
      meta: buildMeta()
    });
  }

  const parsedAnnouncement = announcementRowSchema.safeParse(updatedAnnouncement);

  if (!parsedAnnouncement.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ANNOUNCEMENT_PARSE_FAILED",
        message: "Updated announcement data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const creatorId = parsedAnnouncement.data.created_by;
  let creatorName = "Unknown user";

  if (creatorId === session.profile.id) {
    creatorName = profile.full_name;
  } else {
    const { data: creatorRow } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", creatorId)
      .eq("org_id", profile.org_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (creatorRow?.full_name) {
      creatorName = creatorRow.full_name;
    }
  }

  const { data: readRow } = await supabase
    .from("announcement_reads")
    .select("read_at")
    .eq("announcement_id", announcementId)
    .eq("user_id", profile.id)
    .maybeSingle();

  const parsedReadRow = readRowSchema.safeParse(readRow);
  const readAt = parsedReadRow.success ? parsedReadRow.data.read_at : null;

  const announcement = toAnnouncement(parsedAnnouncement.data, creatorName, readAt);

  const { data: recipientRows, error: recipientError } = await supabase
    .from("profiles")
    .select("id")
    .eq("org_id", profile.org_id)
    .is("deleted_at", null);

  if (recipientError) {
    console.error("Unable to load announcement update recipients.", {
      announcementId,
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
      title: `Announcement updated: ${parsedAnnouncement.data.title}`,
      body: parsedAnnouncement.data.body.slice(0, 220),
      link: "/announcements"
    });
  }

  return jsonResponse<{ announcement: Announcement }>(200, {
    data: {
      announcement
    },
    error: null,
    meta: buildMeta()
  });
}
