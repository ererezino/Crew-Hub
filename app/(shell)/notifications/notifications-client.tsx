"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { ConfirmDialog } from "../../../components/shared/confirm-dialog";
import { EmptyState } from "../../../components/shared/empty-state";
import { ErrorState } from "../../../components/shared/error-state";
import { NotificationActionButton } from "../../../components/shared/notification-action-button";
import { StatusBadge } from "../../../components/shared/status-badge";
import { useNotifications } from "../../../hooks/use-notifications";
import { formatDateTimeTooltip, formatRelativeTime, formatSingleDateHuman } from "../../../lib/datetime";
import { toSentenceCase } from "../../../lib/format-labels";

type AppLocale = "en" | "fr";
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

type NotificationsClientProps = {
  isSuperAdmin?: boolean;
};

export function NotificationsClient({ isSuperAdmin = false }: NotificationsClientProps) {
  const t = useTranslations('notificationsPage');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;

  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const notificationsQuery = useNotifications({
    limit: 200,
    unreadOnly: filter === "unread"
  });

  /* Auto-mark all as read when the page loads so the bell badge clears */
  const hasAutoMarkedRef = useRef(false);
  useEffect(() => {
    if (
      !hasAutoMarkedRef.current &&
      !notificationsQuery.isLoading &&
      (notificationsQuery.data?.unreadCount ?? 0) > 0
    ) {
      hasAutoMarkedRef.current = true;
      void notificationsQuery.markAllRead();
    }
  }, [notificationsQuery]);

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
        title={t('unavailable')}
        message={notificationsQuery.errorMessage}
        onRetry={notificationsQuery.refresh}
      />
    );
  }

  return (
    <section className="settings-layout">
      <section className="notifications-toolbar" aria-label={t('toolbarAriaLabel')}>
        <div className="page-header-actions">
          <button
            type="button"
            className={filter === "all" ? "page-tab page-tab-active" : "page-tab"}
            onClick={() => setFilter("all")}
          >
            {t('filterAll')}
          </button>
          <button
            type="button"
            className={filter === "unread" ? "page-tab page-tab-active" : "page-tab"}
            onClick={() => setFilter("unread")}
          >
            {t('filterUnread')}
          </button>
        </div>

        <div className="page-header-actions">
          <button
            type="button"
            className="button button-subtle"
            disabled={unreadCount === 0}
            onClick={() => void notificationsQuery.markAllRead()}
          >
            {t('markAllRead')}
          </button>
          <button
            type="button"
            className="button button-subtle"
            onClick={notificationsQuery.refresh}
          >
            {t('refresh')}
          </button>
        </div>
      </section>

      {sortedNotifications.length === 0 ? (
        <EmptyState
          title={t('noNotifications')}
          description={t('noNotificationsDescription')}
        />
      ) : null}

      {sortedNotifications.length > 0 ? (
        <section className="data-table-container" aria-label={t('tableAriaLabel')}>
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
                    {t('colDate')}
                    <span className="numeric">{sortDirection === "desc" ? "↓" : "↑"}</span>
                  </button>
                </th>
                <th>{t('colTitle')}</th>
                <th>{t('colType')}</th>
                <th>{t('colStatus')}</th>
                <th className="table-action-column">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {sortedNotifications.map((notification) => (
                <tr key={notification.id} className="data-table-row">
                  <td>
                    <p className="numeric" title={formatDateTimeTooltip(notification.createdAt, locale)}>
                      {formatRelativeTime(notification.createdAt, locale)}
                    </p>
                    <p className="settings-card-description">{formatSingleDateHuman(notification.createdAt, locale)}</p>
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
                      {notification.isRead ? t('statusRead') : t('statusUnread')}
                    </StatusBadge>
                  </td>
                  <td className="table-row-action-cell">
                    <div className="notifications-row-actions">
                      {notification.link ? (
                        <Link className="table-row-action" href={notification.link}>
                          {t('open')}
                        </Link>
                      ) : null}
                      {!notification.isRead ? (
                        <button
                          type="button"
                          className="table-row-action"
                          onClick={() => void notificationsQuery.markRead(notification.id)}
                        >
                          {t('markRead')}
                        </button>
                      ) : null}
                      {isSuperAdmin ? (
                        <button
                          type="button"
                          className="table-row-action table-row-action-danger"
                          onClick={() => {
                            setConfirmDeleteId(notification.id);
                          }}
                        >
                          {tCommon('delete')}
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

      <ConfirmDialog
        isOpen={confirmDeleteId !== null}
        title={t('deleteConfirmTitle')}
        description={t('deleteConfirmDescription')}
        confirmLabel={t('deleteConfirmLabel')}
        tone="danger"
        isConfirming={isDeleting}
        onConfirm={async () => {
          if (!confirmDeleteId) return;
          setIsDeleting(true);
          await notificationsQuery.deleteNotification(confirmDeleteId);
          window.dispatchEvent(new CustomEvent("crew-hub:badge-refresh"));
          setConfirmDeleteId(null);
          setIsDeleting(false);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </section>
  );
}
