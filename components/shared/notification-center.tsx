"use client";

import { useEffect, useRef, useState } from "react";

type NotificationItem = {
  id: string;
  title: string;
  detail: string;
  isUnread: boolean;
};

const STATIC_NOTIFICATIONS: NotificationItem[] = [
  {
    id: "notif-1",
    title: "Payroll checklist queued",
    detail: "Placeholder notification for payroll module setup.",
    isUnread: true
  },
  {
    id: "notif-2",
    title: "Onboarding reminder",
    detail: "3 onboarding tasks are due this week.",
    isUnread: true
  },
  {
    id: "notif-3",
    title: "Compliance window",
    detail: "Country compliance tracker placeholder entry.",
    isUnread: false
  }
];

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const unreadCount = STATIC_NOTIFICATIONS.filter((item) => item.isUnread).length;

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

          <ul className="notification-list">
            {STATIC_NOTIFICATIONS.map((notification) => (
              <li
                key={notification.id}
                className={
                  notification.isUnread
                    ? "notification-item notification-item-unread"
                    : "notification-item"
                }
              >
                <p className="notification-title">{notification.title}</p>
                <p className="notification-detail">{notification.detail}</p>
              </li>
            ))}
          </ul>

          <p className="notification-footer">Placeholder center. Live events arrive in Phase 5.2.</p>
        </section>
      ) : null}
    </div>
  );
}
