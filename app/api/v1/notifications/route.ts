import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../lib/auth/session";
import type { ApiResponse } from "../../../../types/auth";
import type {
  NotificationAction,
  NotificationRecord,
  NotificationsResponseData
} from "../../../../types/notifications";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  unreadOnly: z
    .string()
    .optional()
    .transform((value) => value === "true")
});

const notificationActionSchema = z.object({
  label: z.string(),
  variant: z.enum(["primary", "destructive", "outline"]),
  action_type: z.enum(["api", "navigate"]),
  api_endpoint: z.string().optional(),
  api_method: z.enum(["POST", "PUT", "PATCH"]).optional(),
  api_body: z.record(z.string(), z.unknown()).optional(),
  navigate_url: z.string().optional(),
  requires_reason: z.boolean().optional()
});

const notificationRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  user_id: z.string().uuid(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  is_read: z.boolean(),
  read_at: z.string().nullable(),
  created_at: z.string(),
  actions: z.array(notificationActionSchema).nullable().default(null)
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function toNotificationRecord(row: z.infer<typeof notificationRowSchema>): NotificationRecord {
  const record: NotificationRecord = {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    isRead: row.is_read,
    readAt: row.read_at,
    createdAt: row.created_at
  };

  if (row.actions && row.actions.length > 0) {
    record.actions = row.actions as NotificationAction[];
  }

  return record;
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view notifications."
      },
      meta: buildMeta()
    });
  }

  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid notifications query."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  let notificationsQuery = supabase
    .from("notifications")
    .select("id, org_id, user_id, type, title, body, link, is_read, read_at, created_at, actions")
    .eq("org_id", session.profile.org_id)
    .eq("user_id", session.profile.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(parsedQuery.data.limit);

  if (parsedQuery.data.unreadOnly) {
    notificationsQuery = notificationsQuery.eq("is_read", false);
  }

  const [
    { data: notificationRows, error: notificationsError },
    { count: unreadCount, error: unreadCountError }
  ] = await Promise.all([
    notificationsQuery,
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("org_id", session.profile.org_id)
      .eq("user_id", session.profile.id)
      .eq("is_read", false)
      .is("deleted_at", null)
  ]);

  if (notificationsError || unreadCountError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "NOTIFICATIONS_FETCH_FAILED",
        message: "Unable to load notifications."
      },
      meta: buildMeta()
    });
  }

  const parsedRows = z.array(notificationRowSchema).safeParse(notificationRows ?? []);

  if (!parsedRows.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "NOTIFICATIONS_PARSE_FAILED",
        message: "Notification data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const responseData: NotificationsResponseData = {
    notifications: parsedRows.data.map(toNotificationRecord),
    unreadCount: unreadCount ?? 0
  };

  return jsonResponse<NotificationsResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
