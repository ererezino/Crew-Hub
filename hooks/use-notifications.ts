"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

export function useNotifications(query: NotificationsQuery = {}): UseNotificationsResult {
  const [data, setData] = useState<NotificationsResponseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const endpoint = useMemo(
    () =>
      buildNotificationsUrl({
        limit: query.limit,
        unreadOnly: query.unreadOnly
      }),
    [query.limit, query.unreadOnly]
  );

  useEffect(() => {
    const abortController = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchWithRetry(endpoint, abortController.signal);

        const payload = (await response.json()) as NotificationsResponse;

        if (!response.ok || !payload.data) {
          setData(null);
          setErrorMessage(payload.error?.message ?? "Unable to load notifications.");
          return;
        }

        setData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setData(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load notifications.");
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      abortController.abort();
    };
  }, [endpoint, reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

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

        setData((current) => {
          if (!current) {
            return current;
          }

          const notifications = current.notifications.map((notification) =>
            notification.id === notificationId
              ? {
                  ...notification,
                  isRead: true,
                  readAt: payload.data?.readAt ?? notification.readAt
                }
              : notification
          );
          const unreadCount = notifications.filter((notification) => !notification.isRead).length;

          return {
            ...current,
            notifications,
            unreadCount
          };
        });

        return true;
      } catch {
        return false;
      }
    },
    []
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

      setData((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          unreadCount: 0,
          notifications: current.notifications.map((notification) => ({
            ...notification,
            isRead: true,
            readAt: notification.readAt ?? readAt
          }))
        };
      });

      return true;
    } catch {
      return false;
    }
  }, []);

  const deleteAll = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/notifications", {
        method: "DELETE"
      });

      if (!response.ok) {
        return false;
      }

      setData((current) => {
        if (!current) return current;
        return {
          ...current,
          notifications: [],
          unreadCount: 0
        };
      });

      return true;
    } catch {
      return false;
    }
  }, []);

  const deleteNotification = useCallback(
    async (notificationId: string) => {
      try {
        const response = await fetch(`/api/v1/notifications/${notificationId}`, {
          method: "DELETE"
        });

        if (!response.ok) {
          return false;
        }

        setData((current) => {
          if (!current) return current;
          const notifications = current.notifications.filter(
            (n) => n.id !== notificationId
          );
          return {
            ...current,
            notifications,
            unreadCount: notifications.filter((n) => !n.isRead).length
          };
        });

        return true;
      } catch {
        return false;
      }
    },
    []
  );

  return {
    data,
    isLoading,
    errorMessage,
    refresh,
    markRead,
    markAllRead,
    deleteAll,
    deleteNotification
  };
}
