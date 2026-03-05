"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { EmptyState } from "../../../components/shared/empty-state";
import { ErrorState } from "../../../components/shared/error-state";
import { StatusBadge } from "../../../components/shared/status-badge";
import { useNotifications } from "../../../hooks/use-notifications";
import { formatDateTimeTooltip, formatRelativeTime, formatSingleDateHuman } from "../../../lib/datetime";
import { toSentenceCase } from "../../../lib/format-labels";
import type { NotificationAction } from "../../../types/notifications";

type NotificationFilter = "all" | "unread";
type SortDirection = "desc" | "asc";

type ActionState = {
  status: "idle" | "loading" | "awaiting_reason" | "success" | "error";
  message?: string;
};

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

function NotificationActionButton({
  action,
  onRefresh
}: {
  action: NotificationAction;
  notificationId: string;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({ status: "idle" });
  const [reason, setReason] = useState("");

  const variantClass =
    action.variant === "primary"
      ? "notification-action-primary"
      : action.variant === "destructive"
        ? "notification-action-destructive"
        : "notification-action-outline";

  const handleApiAction = useCallback(
    async (extraBody?: Record<string, unknown>) => {
      if (!action.api_endpoint || !action.api_method) {
        return;
      }

      setState({ status: "loading" });

      try {
        const body = { ...action.api_body, ...extraBody };
        const response = await fetch(action.api_endpoint, {
          method: action.api_method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });

        if (response.ok) {
          setState({ status: "success", message: `${action.label} done` });
          onRefresh();
        } else {
          const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
          const errorMessage = payload?.error?.message ?? "Action failed";
          setState({ status: "error", message: errorMessage });
        }
      } catch {
        setState({ status: "error", message: "Network error" });
      }
    },
    [action, onRefresh]
  );

  const handleClick = useCallback(() => {
    if (action.action_type === "navigate" && action.navigate_url) {
      router.push(action.navigate_url);
      return;
    }

    if (action.action_type === "api") {
      if (action.requires_reason && state.status !== "awaiting_reason") {
        setState({ status: "awaiting_reason" });
        return;
      }

      if (action.requires_reason && state.status === "awaiting_reason") {
        if (!reason.trim()) {
          return;
        }
        void handleApiAction({ rejectionReason: reason.trim() });
        return;
      }

      void handleApiAction();
    }
  }, [action, state.status, reason, handleApiAction, router]);

  if (state.status === "success" || state.status === "error") {
    return (
      <span
        className={`notification-action-status ${state.status === "success" ? "notification-action-status-success" : "notification-action-status-error"}`}
      >
        {state.message}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`notification-action-btn ${variantClass}`}
        disabled={state.status === "loading"}
        onClick={handleClick}
        aria-label={action.label}
      >
        {state.status === "loading" ? (
          <span className="notification-action-spinner" aria-hidden="true" />
        ) : null}
        {state.status === "awaiting_reason" ? "Confirm" : action.label}
      </button>
      {state.status === "awaiting_reason" ? (
        <input
          type="text"
          className="notification-decline-reason"
          placeholder="Reason for declining..."
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && reason.trim()) {
              void handleApiAction({ rejectionReason: reason.trim() });
            }
          }}
          autoFocus
        />
      ) : null}
    </>
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
                            notificationId={notification.id}
                            onRefresh={notificationsQuery.refresh}
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
