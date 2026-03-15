"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import Link from "next/link";

import { ConfirmDialog } from "../../../../components/shared/confirm-dialog";
import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useAnnouncements } from "../../../../hooks/use-announcements";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import { Archive, ArrowLeft } from "lucide-react";
import type { Announcement } from "../../../../types/announcements";
import type { ApiResponse } from "../../../../types/auth";

type AppLocale = "en" | "fr";

type ArchiveProps = {
  isSuperAdmin: boolean;
};

export function AnnouncementsArchiveClient({ isSuperAdmin }: ArchiveProps) {
  const t = useTranslations('announcements');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;

  const { announcements, isLoading, errorMessage, setAnnouncements } =
    useAnnouncements({ dismissed: true });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Announcement | null>(null);

  const handleDelete = async (announcement: Announcement) => {
    setDeletingId(announcement.id);

    try {
      const response = await fetch(`/api/v1/announcements/${announcement.id}`, {
        method: "DELETE"
      });

      const payload = (await response.json()) as ApiResponse<{ announcementId: string }>;

      if (!response.ok || !payload.data) {
        return;
      }

      setAnnouncements((current) => current.filter((a) => a.id !== announcement.id));
    } finally {
      setDeletingId(null);
      setConfirmDelete(null);
    }
  };

  return (
    <>
      <PageHeader
        title={t('archiveTitle')}
        description={t('archivePageDescription')}
        actions={
          <Link className="button" href="/announcements">
            <ArrowLeft size={14} />
            {t('backToAnnouncements')}
          </Link>
        }
      />

      {isLoading ? (
        <div className="announcements-skeleton-grid" aria-hidden="true">
          <section className="settings-card">
            <div className="announcements-skeleton-row announcements-skeleton-title" />
            <div className="announcements-skeleton-row" />
            <div className="announcements-skeleton-row" />
          </section>
        </div>
      ) : null}

      {!isLoading && errorMessage ? (
        <EmptyState
          title={t('archiveUnavailable')}
          description={errorMessage}
          ctaLabel={tCommon('retry')}
          ctaHref="/announcements/archive"
        />
      ) : null}

      {!isLoading && !errorMessage && announcements.length === 0 ? (
        <EmptyState
          icon={<Archive size={32} />}
          title={t('archiveEmpty')}
          description={t('archiveEmptyDescription')}
        />
      ) : null}

      {!isLoading && !errorMessage && announcements.length > 0 ? (
        <section className="settings-card" aria-label={t('archiveTitle')}>
          <header className="announcements-section-header">
            <div>
              <h2 className="section-title">{t('dismissed')}</h2>
              <p className="settings-card-description">
                {t('dismissedDescription')}
              </p>
            </div>
            <StatusBadge tone="draft">{t('archivedCount', { count: announcements.length })}</StatusBadge>
          </header>

          <ul className="announcement-list">
            {announcements.map((announcement) => (
              <li key={announcement.id} className="announcement-item">
                <article className="announcement-item-card">
                  <header className="announcement-item-header">
                    <div>
                      <h3 className="announcement-item-title">{announcement.title}</h3>
                      <p className="announcement-item-meta">
                        <time
                          dateTime={announcement.createdAt}
                          title={formatDateTimeTooltip(announcement.createdAt, locale)}
                        >
                          {formatRelativeTime(announcement.createdAt, locale)}
                        </time>
                        <span aria-hidden="true">•</span>
                        <span>{announcement.creatorName}</span>
                      </p>
                    </div>
                    <span className="announcement-read-check" title={t('dismissed')}>
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
                      {t('dismissed')}
                    </span>
                  </header>

                  <p className="announcement-item-body">{announcement.body}</p>

                  {isSuperAdmin ? (
                    <div className="announcement-row-actions">
                      <button
                        type="button"
                        className="table-row-action table-row-action-danger"
                        disabled={deletingId === announcement.id}
                        onClick={() => setConfirmDelete(announcement)}
                      >
                        {deletingId === announcement.id ? t('deleting') : tCommon('delete')}
                      </button>
                    </div>
                  ) : null}
                </article>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ConfirmDialog
        isOpen={confirmDelete !== null}
        title={t('deleteAnnouncementTitle')}
        description={t('deleteAnnouncementDescription', { title: confirmDelete?.title ?? "" })}
        confirmLabel={tCommon('delete')}
        tone="danger"
        isConfirming={deletingId !== null}
        onConfirm={() => { if (confirmDelete) void handleDelete(confirmDelete); }}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}
