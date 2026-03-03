"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAnnouncements } from "../../hooks/use-announcements";
import { useNotifications } from "../../hooks/use-notifications";
import { formatDateTimeTooltip, formatRelativeTime } from "../../lib/datetime";

const POLL_INTERVAL_MS = 60_000;
const PREVIEW_LIMIT = 8;
const DISMISSED_KEY = "crew-hub-dismissed-bell-items";

type FeedItem = {
  id: string;
  source: "notification" | "announcement";
  title: string;
  body: string;
  link: string;
  createdAt: string;
  isRead: boolean;
};

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveDismissed(dismissed: Set<string>): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed]));
  } catch {
    /* storage full or unavailable */
  }
}

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed());

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

  /* Poll every 60s */
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      notifications.refresh();
      refreshAnnouncements();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [notifications, refreshAnnouncements]);

  /* Build unified feed */
  const feedItems: FeedItem[] = useMemo(() => {
    const items: FeedItem[] = [];

    /* Notifications: only unread */
    for (const n of notifications.data?.notifications ?? []) {
      if (n.isRead) continue;
      const key = `notification-${n.id}`;
      if (dismissed.has(key)) continue;
      items.push({
        id: n.id,
        source: "notification",
        title: n.title,
        body: n.body,
        link: n.link ?? "/notifications",
        createdAt: n.createdAt,
        isRead: n.isRead
      });
    }

    /* Announcements: show all recent, hide only dismissed */
    for (const a of announcements) {
      const key = `announcement-${a.id}`;
      if (dismissed.has(key)) continue;
      items.push({
        id: a.id,
        source: "announcement",
        title: a.title,
        body:
          a.body.length > 120 ? `${a.body.slice(0, 120)}…` : a.body,
        link: "/announcements",
        createdAt: a.createdAt,
        isRead: a.isRead
      });
    }

    items.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return items.slice(0, PREVIEW_LIMIT);
  }, [notifications.data?.notifications, announcements, dismissed]);

  const totalCount = feedItems.length;
  const isLoading = notifications.isLoading || announcementsLoading;
  const errorMessage = notifications.errorMessage;

  /* Dismiss a single item */
  const handleDismiss = useCallback(
    async (item: FeedItem) => {
      const key = `${item.source}-${item.id}`;

      /* Optimistic: immediately hide from UI */
      setDismissed((current) => {
        const next = new Set(current);
        next.add(key);
        saveDismissed(next);
        return next;
      });

      /* Also mark as read on the server */
      if (item.source === "notification") {
        await notifications.markRead(item.id);
      } else {
        try {
          await fetch("/api/v1/announcements/read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ announcementId: item.id })
          });
        } catch {
          /* silent */
        }
      }
    },
    [notifications]
  );

  /* Dismiss all visible items */
  const handleDismissAll = useCallback(async () => {
    setDismissed((current) => {
      const next = new Set(current);
      for (const item of feedItems) {
        next.add(`${item.source}-${item.id}`);
      }
      saveDismissed(next);
      return next;
    });

    /* Mark notifications as read */
    await notifications.markAllRead();

    /* Mark announcements as read */
    const announcementItems = feedItems.filter((i) => i.source === "announcement");
    await Promise.all(
      announcementItems.map(async (item) => {
        try {
          await fetch("/api/v1/announcements/read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ announcementId: item.id })
          });
        } catch {
          /* silent */
        }
      })
    );
  }, [feedItems, notifications]);

  return (
    <div className="notification-center" ref={containerRef}>
      <button
        className="icon-button notification-trigger"
        type="button"
        aria-label="Open notifications"
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
            <p className="section-title">Notifications</p>
            {totalCount > 0 ? (
              <span className="pill numeric">{totalCount} new</span>
            ) : null}
          </div>

          <div className="notification-dropdown-actions">
            <button
              type="button"
              className="table-row-action"
              disabled={totalCount === 0}
              onClick={() => void handleDismissAll()}
            >
              Dismiss all
            </button>
            <Link
              className="table-row-action"
              href="/notifications"
              onClick={() => setIsOpen(false)}
            >
              View all
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
              {feedItems.length > 0 ? (
                <ul className="notification-list">
                  {feedItems.map((item) => (
                    <li
                      key={`${item.source}-${item.id}`}
                      className="notification-item notification-item-unread"
                    >
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
                            Announcement
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
                      <button
                        type="button"
                        className="table-row-action"
                        onClick={() => void handleDismiss(item)}
                      >
                        Dismiss
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="notification-footer">
                  All caught up — no new notifications.
                </p>
              )}
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
