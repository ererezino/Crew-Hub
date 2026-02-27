"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { useNotifications } from "../../hooks/use-notifications";
import { formatDateTimeTooltip, formatRelativeTime } from "../../lib/datetime";

const POLL_INTERVAL_MS = 60_000;

function useNotificationsPreviewLimit(): number {
  return 8;
}

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previewLimit = useNotificationsPreviewLimit();

  const notifications = useNotifications({ limit: previewLimit });
  const unreadCount = notifications.data?.unreadCount ?? 0;
  const refreshNotifications = notifications.refresh;

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current) {
        return;
      }

      if (!containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      refreshNotifications();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [refreshNotifications]);

  const previewNotifications = useMemo(
    () => notifications.data?.notifications.slice(0, previewLimit) ?? [],
    [notifications.data?.notifications, previewLimit]
  );

  const handleNotificationClick = async (notificationId: string, isRead: boolean) => {
    if (isRead) {
      return;
    }

    await notifications.markRead(notificationId);
  };

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
        {unreadCount > 0 ? (
          <span className="notification-badge numeric" aria-hidden="true">
            {unreadCount}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <section className="notification-dropdown" role="menu" aria-label="Notifications">
          <div className="notification-dropdown-header">
            <p className="section-title">Notifications</p>
            <span className="pill numeric">{unreadCount} unread</span>
          </div>

          <div className="notification-dropdown-actions">
            <button
              type="button"
              className="table-row-action"
              disabled={unreadCount === 0}
              onClick={() => void notifications.markAllRead()}
            >
              Mark all read
            </button>
            <Link className="table-row-action" href="/notifications" onClick={() => setIsOpen(false)}>
              View all
            </Link>
          </div>

          {notifications.isLoading ? (
            <div className="notification-list">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={`notification-skeleton-${index}`} className="notification-item notification-item-skeleton" />
              ))}
            </div>
          ) : null}

          {!notifications.isLoading && notifications.errorMessage ? (
            <p className="notification-footer">{notifications.errorMessage}</p>
          ) : null}

          {!notifications.isLoading && !notifications.errorMessage ? (
            <>
              {previewNotifications.length > 0 ? (
                <ul className="notification-list">
                  {previewNotifications.map((notification) => (
                    <li
                      key={notification.id}
                      className={
                        notification.isRead
                          ? "notification-item"
                          : "notification-item notification-item-unread"
                      }
                    >
                      <Link
                        href={notification.link ?? "/notifications"}
                        className="notification-link"
                        onClick={() => {
                          void handleNotificationClick(notification.id, notification.isRead);
                          setIsOpen(false);
                        }}
                      >
                        <p className="notification-title">{notification.title}</p>
                        <p className="notification-detail">{notification.body}</p>
                        <p
                          className="notification-time numeric"
                          title={formatDateTimeTooltip(notification.createdAt)}
                        >
                          {formatRelativeTime(notification.createdAt)}
                        </p>
                      </Link>
                      {!notification.isRead ? (
                        <button
                          type="button"
                          className="table-row-action"
                          onClick={() => void notifications.markRead(notification.id)}
                        >
                          Mark read
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="notification-footer">No notifications yet.</p>
              )}
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
