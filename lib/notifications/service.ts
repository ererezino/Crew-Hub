import "server-only";

import { createSupabaseServiceRoleClient } from "../supabase/service-role";
import type { NotificationAction, NotificationType } from "../../types/notifications";

type CreateNotificationParams = {
  orgId: string;
  userId: string;
  type: NotificationType | string;
  title: string;
  body: string;
  link?: string | null;
  actions?: NotificationAction[];
  skipIfUnreadDuplicate?: boolean;
};

type CreateBulkNotificationsParams = {
  orgId: string;
  userIds: string[];
  type: NotificationType | string;
  title: string;
  body: string;
  link?: string | null;
  actions?: NotificationAction[];
  skipIfUnreadDuplicate?: boolean;
};

function normalizeLink(link: string | null | undefined): string | null {
  if (!link) {
    return null;
  }

  const trimmed = link.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export async function createNotification({
  orgId,
  userId,
  type,
  title,
  body,
  link,
  actions,
  skipIfUnreadDuplicate = true
}: CreateNotificationParams): Promise<void> {
  try {
    const notificationTitle = title.trim();
    const notificationBody = body.trim();
    const notificationLink = normalizeLink(link);

    if (!notificationTitle || !notificationBody) {
      return;
    }

    const serviceClient = createSupabaseServiceRoleClient();

    if (skipIfUnreadDuplicate) {
      let duplicateQuery = serviceClient
        .from("notifications")
        .select("id")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .eq("type", type)
        .eq("title", notificationTitle)
        .eq("body", notificationBody)
        .eq("is_read", false)
        .is("deleted_at", null)
        .limit(1);

      duplicateQuery = notificationLink
        ? duplicateQuery.eq("link", notificationLink)
        : duplicateQuery.is("link", null);

      const { data: duplicateRows, error: duplicateError } = await duplicateQuery;

      if (duplicateError) {
        console.error("Unable to check notification duplicates.", {
          orgId,
          userId,
          type,
          message: duplicateError.message
        });
      } else if ((duplicateRows ?? []).length > 0) {
        return;
      }
    }

    const { error: insertError } = await serviceClient.from("notifications").insert({
      org_id: orgId,
      user_id: userId,
      type,
      title: notificationTitle,
      body: notificationBody,
      link: notificationLink,
      ...(actions && actions.length > 0 ? { actions } : {})
    });

    if (insertError) {
      console.error("Unable to create notification.", {
        orgId,
        userId,
        type,
        message: insertError.message
      });
    }
  } catch (error) {
    console.error("Unexpected notification creation failure.", {
      orgId,
      userId,
      type,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function createBulkNotifications({
  orgId,
  userIds,
  type,
  title,
  body,
  link,
  actions,
  skipIfUnreadDuplicate = true
}: CreateBulkNotificationsParams): Promise<void> {
  const uniqueUserIds = [...new Set(userIds.filter((value) => value.trim().length > 0))];

  if (uniqueUserIds.length === 0) {
    return;
  }

  await Promise.all(
    uniqueUserIds.map((userId) =>
      createNotification({
        orgId,
        userId,
        type,
        title,
        body,
        link,
        actions,
        skipIfUnreadDuplicate
      })
    )
  );
}
