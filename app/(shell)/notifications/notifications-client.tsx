"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "../../../components/shared/empty-state";
import { ErrorState } from "../../../components/shared/error-state";
import { NotificationActionButton } from "../../../components/shared/notification-action-button";
import { StatusBadge } from "../../../components/shared/status-badge";
import { useNotifications } from "../../../hooks/use-notifications";
import { formatDateTimeTooltip, formatRelativeTime, formatSingleDateHuman } from "../../../lib/datetime";
import { toSentenceCase } from "../../../lib/format-labels";

type NotificationFilter = "all" | "unread";
type SortDirection = "desc" | "asc";

function notificationsSkeleton() {
  return (
    <section className="notifications-skeleton" aria-hidden="true">
      <div className="notifications-skeleton-toolbar" />
      <div className="notifications-skeleton-row" />
      <div className="notifications-skeleton-row" />
      <div className="notifications-skeleton-row" />
    </section>
  );
}

export function NotificationsClient() {
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const notificationsQuery = useNotifications({
    limit: 200,
    unreadOnly: filter === "unread"
  });

  const sortedNotifications = useMemo(() => {
    const rows = notificationsQuery.data?.notifications ?? [];

    return [...rows].sort((left, right) => {
      const comparison = left.createdAt.localeCompare(right.createdAt);
      return sortDirection === "desc" ? comparison * -1 : comparison;
    });
  }, [notificationsQuery.data?.notifications, sortDirection]);

  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;

  if (notificationsQuery.isLoading) {
    return notificationsSkeleton();
  }

  if (notificationsQuery.errorMessage) {
    return (
      <ErrorState
        title="Notifications unavailable"
        message={notificationsQuery.errorMessage}
        onRetry={notificationsQuery.refresh}
      />
    );
  }

  return (
    <section className="settings-layout">
      <section className="notifications-toolbar" aria-label="Notifications toolbar">
        <div className="page-header-actions">
          <button
            type="button"
            className={filter === "all" ? "button button-accent" : "button button-subtle"}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          <button
            type="button"
            className={filter === "unread" ? "button button-accent" : "button button-subtle"}
            onClick={() => setFilter("unread")}
          >
            Unread
          </button>
        </div>

        <div className="page-header-actions">
          <button
            type="button"
            className="button button-subtle"
            disabled={unreadCount === 0}
            onClick={() => void notificationsQuery.markAllRead()}
          >
            Mark all read
          </button>
          <button
            type="button"
            className="button button-subtle"
            onClick={notificationsQuery.refresh}
          >
            Refresh
          </button>
        </div>
      </section>

      {sortedNotifications.length === 0 ? (
        <EmptyState
          title="No notifications yet"
          description="New activity from workflows and approvals will appear here."
          ctaLabel="Open dashboard"
          ctaHref="/dashboard"
        />
      ) : null}

      {sortedNotifications.length > 0 ? (
        <section className="data-table-container" aria-label="Notifications table">
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <button
                    type="button"
                    className="table-sort-trigger"
                    onClick={() =>
                      setSortDirection((current) => (current === "desc" ? "asc" : "desc"))
                    }
                  >
                    Date
                    <span className="numeric">{sortDirection === "desc" ? "↓" : "↑"}</span>
                  </button>
                </th>
                <th>Title</th>
                <th>Type</th>
                <th>Status</th>
                <th className="table-action-column">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedNotifications.map((notification) => (
                <tr key={notification.id} className="data-table-row">
                  <td>
                    <p className="numeric" title={formatDateTimeTooltip(notification.createdAt)}>
                      {formatRelativeTime(notification.createdAt)}
                    </p>
                    <p className="settings-card-description">{formatSingleDateHuman(notification.createdAt)}</p>
                  </td>
                  <td>
                    <p>{notification.title}</p>
                    <p className="settings-card-description">{notification.body}</p>
                    {notification.actions && notification.actions.length > 0 ? (
                      <div className="notification-actions">
                        {notification.actions.map((action) => (
                          <NotificationActionButton
                            key={`${notification.id}-${action.label}`}
                            action={action}
                            onComplete={notificationsQuery.refresh}
                          />
                        ))}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <code>{toSentenceCase(notification.type)}</code>
                  </td>
                  <td>
                    <StatusBadge tone={notification.isRead ? "success" : "pending"}>
                      {notification.isRead ? "Read" : "Unread"}
                    </StatusBadge>
                  </td>
                  <td className="table-row-action-cell">
                    <div className="notifications-row-actions">
                      {notification.link ? (
                        <Link className="table-row-action" href={notification.link}>
                          Open
                        </Link>
                      ) : null}
                      {!notification.isRead ? (
                        <button
                          type="button"
                          className="table-row-action"
                          onClick={() => void notificationsQuery.markRead(notification.id)}
                        >
                          Mark read
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </section>
  );
}
