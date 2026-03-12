"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { useAnnouncements } from "../../hooks/use-announcements";
import { useNotifications } from "../../hooks/use-notifications";
import { formatDateTimeTooltip, formatRelativeTime } from "../../lib/datetime";
import type { NotificationAction } from "../../types/notifications";
import { NotificationActionButton } from "./notification-action-button";

const POLL_INTERVAL_MS = 60_000;
const PREVIEW_LIMIT = 8;
const BROWSER_PUSH_PREF_KEY = "crewhub-browser-push-enabled";

type ImageAttachmentRef = {
  announcementId: string;
  attachmentId: string;
  fileName: string;
};

type FeedItem = {
  id: string;
  source: "notification" | "announcement";
  title: string;
  body: string;
  link: string;
  createdAt: string;
  isRead: boolean;
  actions: NotificationAction[];
  /** First image attachment for thumbnail display (announcements only) */
  imageAttachment?: ImageAttachmentRef;
  /** Total image count (for "+N" badge) */
  imageCount?: number;
};

/** Lazy-loading image thumbnail for announcement notification items. */
function NotificationThumbnail({
  announcementId,
  attachmentId,
  fileName,
  extraCount
}: {
  announcementId: string;
  attachmentId: string;
  fileName: string;
  extraCount: number;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(
          `/api/v1/announcements/${announcementId}/attachments/${attachmentId}`
        );
        if (!res.ok) { setError(true); return; }
        const json = await res.json() as { data?: { url?: string } };
        if (!cancelled && json.data?.url) {
          setSrc(json.data.url);
        } else {
          setError(true);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [announcementId, attachmentId]);

  if (error) return null;

  return (
    <div className="notification-thumbnail-wrap">
      {src ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt={fileName}
          className="notification-thumbnail-img"
          loading="lazy"
        />
      ) : (
        <div className="notification-thumbnail-skeleton" />
      )}
      {extraCount > 0 ? (
        <span className="notification-thumbnail-badge">+{extraCount}</span>
      ) : null}
    </div>
  );
}

export function NotificationCenter() {
  const t = useTranslations("notifications");
  const [isOpen, setIsOpen] = useState(false);
  const [browserPushEnabled, setBrowserPushEnabled] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bootstrappedBrowserAlerts = useRef(false);
  const browserAlertedNotificationIds = useRef<Set<string>>(new Set());

  /* Ephemeral optimistic set — never persisted, resets on mount */
  const [optimisticDismissals, setOptimisticDismissals] = useState<Set<string>>(new Set());

  const notifications = useNotifications({ limit: 50 });
  const { announcements, isLoading: announcementsLoading, refresh: refreshAnnouncements } =
    useAnnouncements({ limit: 10 });

  /* Close on outside click */
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncBrowserPushPreference = () => {
      setBrowserPushEnabled(window.localStorage.getItem(BROWSER_PUSH_PREF_KEY) === "true");
    };

    syncBrowserPushPreference();
    window.addEventListener("storage", syncBrowserPushPreference);
    window.addEventListener("crewhub:browser-push-pref-updated", syncBrowserPushPreference);

    return () => {
      window.removeEventListener("storage", syncBrowserPushPreference);
      window.removeEventListener("crewhub:browser-push-pref-updated", syncBrowserPushPreference);
    };
  }, []);

  /* Poll every 60s */
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      notifications.refresh();
      refreshAnnouncements();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [notifications, refreshAnnouncements]);

  useEffect(() => {
    const currentNotifications = notifications.data?.notifications ?? [];

    if (!bootstrappedBrowserAlerts.current) {
      for (const notification of currentNotifications) {
        browserAlertedNotificationIds.current.add(notification.id);
      }
      bootstrappedBrowserAlerts.current = true;
      return;
    }

    if (
      !browserPushEnabled ||
      typeof window === "undefined" ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    ) {
      return;
    }

    for (const notification of currentNotifications) {
      if (notification.isRead || browserAlertedNotificationIds.current.has(notification.id)) {
        continue;
      }

      const browserNotification = new Notification(notification.title, {
        body: notification.body
      });

      browserNotification.onclick = () => {
        window.focus();
        window.location.href = notification.link ?? "/notifications";
        browserNotification.close();
      };

      browserAlertedNotificationIds.current.add(notification.id);
    }
  }, [browserPushEnabled, notifications.data?.notifications]);

  /* Build unified feed — only unread, filtered by optimistic dismissals */
  const feedItems: FeedItem[] = useMemo(() => {
    const items: FeedItem[] = [];

    for (const n of notifications.data?.notifications ?? []) {
      if (n.isRead) continue;
      if (optimisticDismissals.has(`notification-${n.id}`)) continue;
      items.push({
        id: n.id,
        source: "notification",
        title: n.title,
        body: n.body,
        link: n.link ?? "/notifications",
        createdAt: n.createdAt,
        isRead: n.isRead,
        actions: n.actions ?? []
      });
    }

    for (const a of announcements) {
      if (a.isRead) continue;
      if (optimisticDismissals.has(`announcement-${a.id}`)) continue;
      const truncatedBody = a.body.length > 120 ? `${a.body.slice(0, 120)}…` : a.body;
      const imageAtts = a.attachments.filter((att) => att.mimeType.startsWith("image/"));
      const nonImageCount = a.attachments.length - imageAtts.length;
      const attachmentHint = nonImageCount > 0
        ? ` · ${nonImageCount} ${nonImageCount === 1 ? "file" : "files"} attached`
        : "";
      items.push({
        id: a.id,
        source: "announcement",
        title: a.title,
        body: `${truncatedBody}${attachmentHint}`,
        link: "/announcements",
        createdAt: a.createdAt,
        isRead: a.isRead,
        actions: [],
        imageAttachment: imageAtts.length > 0
          ? { announcementId: a.id, attachmentId: imageAtts[0].id, fileName: imageAtts[0].fileName }
          : undefined,
        imageCount: imageAtts.length
      });
    }

    items.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return items;
  }, [notifications.data?.notifications, announcements, optimisticDismissals]);

  const totalCount = feedItems.length;
  const visibleItems = feedItems.slice(0, PREVIEW_LIMIT);
  const isLoading = notifications.isLoading || announcementsLoading;
  const errorMessage = notifications.errorMessage;

  /* Dismiss a single item — optimistic hide, server confirm, revert on fail */
  const handleDismiss = useCallback(
    async (item: FeedItem) => {
      const key = `${item.source}-${item.id}`;

      setOptimisticDismissals((prev) => new Set([...prev, key]));

      try {
        if (item.source === "notification") {
          await notifications.markRead(item.id);
        } else {
          const response = await fetch("/api/v1/announcements/read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ announcementId: item.id })
          });

          if (!response.ok) {
            throw new Error("Server rejected read mark");
          }
        }

        window.dispatchEvent(new CustomEvent("crew-hub:badge-refresh"));
      } catch {
        setOptimisticDismissals((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [notifications]
  );

  /* Dismiss all visible items */
  const handleDismissAll = useCallback(async () => {
    const allKeys = feedItems.map((item) => `${item.source}-${item.id}`);

    setOptimisticDismissals((prev) => {
      const next = new Set(prev);
      for (const key of allKeys) {
        next.add(key);
      }
      return next;
    });

    try {
      await notifications.markAllRead();
    } catch {
      const notificationKeys = feedItems
        .filter((i) => i.source === "notification")
        .map((i) => `notification-${i.id}`);
      setOptimisticDismissals((prev) => {
        const next = new Set(prev);
        for (const key of notificationKeys) {
          next.delete(key);
        }
        return next;
      });
    }

    const announcementItems = feedItems.filter((i) => i.source === "announcement");
    await Promise.all(
      announcementItems.map(async (item) => {
        try {
          const response = await fetch("/api/v1/announcements/read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ announcementId: item.id })
          });

          if (!response.ok) throw new Error("Failed");
        } catch {
          const key = `announcement-${item.id}`;
          setOptimisticDismissals((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
        }
      })
    );

    window.dispatchEvent(new CustomEvent("crew-hub:badge-refresh"));
  }, [feedItems, notifications]);

  return (
    <div className="notification-center" ref={containerRef}>
      <button
        className="icon-button notification-trigger"
        type="button"
        aria-label={t("openLabel")}
        onClick={() => setIsOpen((currentValue) => !currentValue)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 3a5 5 0 0 0-5 5v3.5l-1.7 2.9a1 1 0 0 0 .9 1.6h11.6a1 1 0 0 0 .9-1.6L17 11.5V8a5 5 0 0 0-5-5Z"
            fill="currentColor"
          />
          <path
            d="M10 18a2 2 0 0 0 4 0"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        {totalCount > 0 ? (
          <span className="notification-badge numeric" aria-hidden="true">
            {totalCount}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <section
          className="notification-dropdown"
          role="menu"
          aria-label="Notifications"
        >
          <div className="notification-dropdown-header">
            <p className="section-title">{t("title")}</p>
            {totalCount > 0 ? (
              <span className="pill numeric">{t("newBadge", { count: totalCount })}</span>
            ) : null}
          </div>

          <div className="notification-dropdown-actions">
            <button
              type="button"
              className="table-row-action"
              disabled={totalCount === 0}
              onClick={() => void handleDismissAll()}
            >
              {t("dismissAll")}
            </button>
            <Link
              className="table-row-action"
              href="/announcements"
              onClick={() => setIsOpen(false)}
            >
              {t("viewAll")}
            </Link>
          </div>

          {isLoading ? (
            <div className="notification-list">
              {Array.from({ length: 3 }, (_, index) => (
                <div
                  key={`notification-skeleton-${index}`}
                  className="notification-item notification-item-skeleton"
                />
              ))}
            </div>
          ) : null}

          {!isLoading && errorMessage ? (
            <p className="notification-footer">{errorMessage}</p>
          ) : null}

          {!isLoading && !errorMessage ? (
            <>
              {visibleItems.length > 0 ? (
                <ul className="notification-list">
                  {visibleItems.map((item) => (
                    <li
                      key={`${item.source}-${item.id}`}
                      className="notification-item notification-item-unread"
                    >
                      <div className="notification-item-content">
                        <Link
                          href={item.link}
                          className="notification-link"
                          onClick={() => {
                            void handleDismiss(item);
                            setIsOpen(false);
                          }}
                        >
                          {item.source === "announcement" ? (
                            <span className="notification-source-label">
                              {t("sourceAnnouncement")}
                            </span>
                          ) : null}
                          <p className="notification-title">{item.title}</p>
                          <p className="notification-detail">{item.body}</p>
                          <p
                            className="notification-time numeric"
                            title={formatDateTimeTooltip(item.createdAt)}
                          >
                            {formatRelativeTime(item.createdAt)}
                          </p>
                        </Link>
                        {item.source === "notification" && item.actions.length > 0 ? (
                          <div className="notification-dropdown-inline-actions">
                            {item.actions.map((action) => (
                              <NotificationActionButton
                                key={`${item.id}-${action.label}`}
                                action={action}
                                onComplete={() => {
                                  void handleDismiss(item);
                                  notifications.refresh();
                                }}
                              />
                            ))}
                          </div>
                        ) : null}
                      </div>
                      {item.imageAttachment ? (
                        <NotificationThumbnail
                          announcementId={item.imageAttachment.announcementId}
                          attachmentId={item.imageAttachment.attachmentId}
                          fileName={item.imageAttachment.fileName}
                          extraCount={(item.imageCount ?? 1) - 1}
                        />
                      ) : null}
                      <button
                        type="button"
                        className="table-row-action"
                        onClick={() => void handleDismiss(item)}
                      >
                        {t("dismiss")}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="notification-footer">
                  {t("emptyMessage")}
                </p>
              )}
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
