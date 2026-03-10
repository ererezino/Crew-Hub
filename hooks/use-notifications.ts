"use client";

import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchWithRetry } from "./use-fetch-with-retry";
import type {
  MarkNotificationReadResponse,
  NotificationsResponse,
  NotificationsResponseData
} from "../types/notifications";

type NotificationsQuery = {
  limit?: number;
  unreadOnly?: boolean;
};

type UseNotificationsResult = {
  data: NotificationsResponseData | null;
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
  markRead: (notificationId: string) => Promise<boolean>;
  markAllRead: () => Promise<boolean>;
  deleteAll: () => Promise<boolean>;
  deleteNotification: (notificationId: string) => Promise<boolean>;
};

function buildNotificationsUrl({
  limit = 50,
  unreadOnly = false
}: NotificationsQuery): string {
  const params = new URLSearchParams();
  params.set("limit", String(limit));

  if (unreadOnly) {
    params.set("unreadOnly", "true");
  }

  return `/api/v1/notifications?${params.toString()}`;
}

async function fetchNotifications(
  endpoint: string,
  signal: AbortSignal
): Promise<NotificationsResponseData> {
  const response = await fetchWithRetry(endpoint, signal);
  const payload = (await response.json()) as NotificationsResponse;

  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "Unable to load notifications.");
  }

  return payload.data;
}

function updateNotificationCache(
  current: NotificationsResponseData | undefined,
  updater: (current: NotificationsResponseData) => NotificationsResponseData
): NotificationsResponseData | undefined {
  if (!current) {
    return current;
  }

  return updater(current);
}

export function useNotifications(query: NotificationsQuery = {}): UseNotificationsResult {
  const queryClient = useQueryClient();
  const endpoint = useMemo(
    () =>
      buildNotificationsUrl({
        limit: query.limit,
        unreadOnly: query.unreadOnly
      }),
    [query.limit, query.unreadOnly]
  );

  const queryKey = useMemo(
    () => ["notifications", query.limit ?? 50, query.unreadOnly === true ? "unread" : "all"] as const,
    [query.limit, query.unreadOnly]
  );

  const queryResult = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchNotifications(endpoint, signal),
    staleTime: 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false
  });

  const refresh = useCallback(() => {
    void queryResult.refetch();
  }, [queryResult]);

  const markRead = useCallback(
    async (notificationId: string) => {
      try {
        const response = await fetch(`/api/v1/notifications/${notificationId}/read`, {
          method: "PATCH"
        });
        const payload = (await response.json()) as MarkNotificationReadResponse;

        if (!response.ok || !payload.data) {
          return false;
        }

        queryClient.setQueriesData<NotificationsResponseData>(
          { queryKey: ["notifications"] },
          (current) =>
            updateNotificationCache(current, (state) => {
              const notifications = state.notifications.map((notification) =>
                notification.id === notificationId
                  ? {
                      ...notification,
                      isRead: true,
                      readAt: payload.data?.readAt ?? notification.readAt
                    }
                  : notification
              );

              return {
                ...state,
                notifications,
                unreadCount: notifications.filter((notification) => !notification.isRead).length
              };
            })
        );

        return true;
      } catch {
        return false;
      }
    },
    [queryClient]
  );

  const markAllRead = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/notifications/read-all", {
        method: "PATCH"
      });
      const payload = (await response.json()) as { data: { readAt: string } | null };

      if (!response.ok || !payload.data) {
        return false;
      }

      const readAt = payload.data.readAt;

      queryClient.setQueriesData<NotificationsResponseData>(
        { queryKey: ["notifications"] },
        (current) =>
          updateNotificationCache(current, (state) => ({
            ...state,
            unreadCount: 0,
            notifications: state.notifications.map((notification) => ({
              ...notification,
              isRead: true,
              readAt: notification.readAt ?? readAt
            }))
          }))
      );

      return true;
    } catch {
      return false;
    }
  }, [queryClient]);

  const deleteAll = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/notifications", {
        method: "DELETE"
      });

      if (!response.ok) {
        return false;
      }

      queryClient.setQueriesData<NotificationsResponseData>(
        { queryKey: ["notifications"] },
        (current) =>
          updateNotificationCache(current, (state) => ({
            ...state,
            notifications: [],
            unreadCount: 0
          }))
      );

      return true;
    } catch {
      return false;
    }
  }, [queryClient]);

  const deleteNotification = useCallback(
    async (notificationId: string) => {
      try {
        const response = await fetch(`/api/v1/notifications/${notificationId}`, {
          method: "DELETE"
        });

        if (!response.ok) {
          return false;
        }

        queryClient.setQueriesData<NotificationsResponseData>(
          { queryKey: ["notifications"] },
          (current) =>
            updateNotificationCache(current, (state) => {
              const notifications = state.notifications.filter(
                (notification) => notification.id !== notificationId
              );

              return {
                ...state,
                notifications,
                unreadCount: notifications.filter((notification) => !notification.isRead).length
              };
            })
        );

        return true;
      } catch {
        return false;
      }
    },
    [queryClient]
  );

  return {
    data: queryResult.data ?? null,
    isLoading: queryResult.isPending && !queryResult.data,
    errorMessage: queryResult.error instanceof Error ? queryResult.error.message : null,
    refresh,
    markRead,
    markAllRead,
    deleteAll,
    deleteNotification
  };
}
