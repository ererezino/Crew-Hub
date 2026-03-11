"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { formatDateTimeTooltip, formatRelativeTime } from "../../lib/datetime";
import { useAnnouncements } from "../../hooks/use-announcements";
import { EmptyState } from "./empty-state";

function AnnouncementSkeleton() {
  return (
    <div className="announcement-widget-skeleton" aria-hidden="true">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={`announcement-widget-skeleton-${index}`} className="announcement-widget-skeleton-row" />
      ))}
    </div>
  );
}

export function DashboardAnnouncementsWidget() {
  const t = useTranslations("dashboard.announcementsWidget");
  const { announcements, isLoading, errorMessage } = useAnnouncements({ limit: 20 });

  const recentAnnouncements = useMemo(
    () =>
      [...announcements]
        .sort(
          (leftAnnouncement, rightAnnouncement) =>
            new Date(rightAnnouncement.createdAt).getTime() -
            new Date(leftAnnouncement.createdAt).getTime()
        )
        .slice(0, 3),
    [announcements]
  );

  return (
    <div className="announcement-widget">
      <header className="announcement-widget-header">
        <h3 className="section-title">{t("title")}</h3>
        <Link href="/announcements" className="announcement-widget-link">
          {t("viewAll")}
        </Link>
      </header>

      {isLoading ? <AnnouncementSkeleton /> : null}

      {!isLoading && errorMessage ? (
        <EmptyState
          title={t("unavailable")}
          description={errorMessage}
          ctaLabel={t("viewAll")}
          ctaHref="/announcements"
        />
      ) : null}

      {!isLoading && !errorMessage && recentAnnouncements.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          ctaLabel={t("viewAll")}
          ctaHref="/announcements"
        />
      ) : null}

      {!isLoading && !errorMessage && recentAnnouncements.length > 0 ? (
        <ul className="announcement-widget-list">
          {recentAnnouncements.map((announcement) => (
            <li
              key={announcement.id}
              className={
                announcement.isRead
                  ? "announcement-widget-item"
                  : "announcement-widget-item announcement-widget-item-unread"
              }
            >
              <div className="announcement-widget-item-copy">
                <p className="announcement-widget-item-title">{announcement.title}</p>
                <p className="announcement-widget-item-meta">
                  <time
                    dateTime={announcement.createdAt}
                    title={formatDateTimeTooltip(announcement.createdAt)}
                  >
                    {formatRelativeTime(announcement.createdAt)}
                  </time>
                </p>
              </div>
              {announcement.isRead ? (
                <span className="announcement-read-check" title={t("read")}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M5 12.5l4.5 4.5L19 7.5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </svg>
                </span>
              ) : (
                <span className="pill">{t("unread")}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
