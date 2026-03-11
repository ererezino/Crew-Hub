"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo } from "react";

import { EmptyState } from "../../../components/shared/empty-state";
import { FeatureBanner } from "../../../components/shared/feature-banner";
import { PageHeader } from "../../../components/shared/page-header";
import { StatusBadge } from "../../../components/shared/status-badge";
import { usePendingSurveys } from "../../../hooks/use-surveys";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import { toSentenceCase } from "../../../lib/format-labels";
import { MessageSquare } from "lucide-react";

type AppLocale = "en" | "fr";

function toDateTimeValue(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return `${value}T00:00:00.000Z`;
}

function surveysSkeleton() {
  return (
    <section className="timeoff-skeleton-layout" aria-hidden="true">
      <div className="table-skeleton">
        <div className="table-skeleton-header" />
        {Array.from({ length: 5 }, (_, index) => (
          <div key={`survey-row-skeleton-${index}`} className="table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

export function SurveysClient({
  canManageSurveys,
  embedded = false
}: {
  canManageSurveys: boolean;
  embedded?: boolean;
}) {
  const t = useTranslations('surveys');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const pendingQuery = usePendingSurveys();

  const pendingSurveys = useMemo(
    () =>
      [...(pendingQuery.data?.surveys ?? [])].sort((leftSurvey, rightSurvey) => {
        const leftSortDate = leftSurvey.endDate ?? leftSurvey.startDate ?? leftSurvey.createdAt;
        const rightSortDate = rightSurvey.endDate ?? rightSurvey.startDate ?? rightSurvey.createdAt;
        return leftSortDate.localeCompare(rightSortDate);
      }),
    [pendingQuery.data?.surveys]
  );

  return (
    <>
      {!embedded ? (
        <PageHeader
          title={t('listTitle')}
          description={t('pageDescription')}
          actions={
            canManageSurveys ? (
              <Link href="/admin/surveys" className="button">
                {t('surveyAdmin')}
              </Link>
            ) : null
          }
        />
      ) : null}

      {!embedded ? (
        <FeatureBanner
          moduleId="surveys"
          description={t('banner')}
        />
      ) : null}

      {pendingQuery.isLoading ? surveysSkeleton() : null}

      {!pendingQuery.isLoading && pendingQuery.errorMessage ? (
        <>
          <EmptyState
            title={t('unavailable')}
            description={pendingQuery.errorMessage}
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => pendingQuery.refresh()}
          >
            {tCommon('retry')}
          </button>
        </>
      ) : null}

      {!pendingQuery.isLoading && !pendingQuery.errorMessage ? (
        pendingSurveys.length === 0 ? (
          <EmptyState
            icon={<MessageSquare size={32} />}
            title={t('noPending')}
            description={t('noPendingDescription')}
          />
        ) : (
          <section className="announcements-grid" aria-label={t('noPending')}>
            {pendingSurveys.map((survey) => {
              const dueDateValue = toDateTimeValue(survey.endDate);
              const startDateValue = toDateTimeValue(survey.startDate);

              return (
                <article key={survey.id} className="settings-card">
                  <header className="announcement-item-header">
                    <div>
                      <h2 className="section-title">{survey.title}</h2>
                      <p className="settings-card-description">
                        {survey.description || t('noDescription')}
                      </p>
                    </div>
                    <div className="announcement-item-status">
                      <StatusBadge tone="pending">{tCommon('status.pending')}</StatusBadge>
                      <StatusBadge tone="info">{toSentenceCase(survey.type)}</StatusBadge>
                    </div>
                  </header>

                  <dl className="compensation-timeline-list">
                    <div>
                      <dt className="metric-label">{t('questions')}</dt>
                      <dd className="metric-description numeric">{survey.questions.length}</dd>
                    </div>
                    <div>
                      <dt className="metric-label">{t('started')}</dt>
                      <dd className="metric-description">
                        {startDateValue ? (
                          <time dateTime={startDateValue} title={formatDateTimeTooltip(startDateValue, locale)}>
                            {formatRelativeTime(startDateValue, locale)}
                          </time>
                        ) : (
                          t('startsImmediately')
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="metric-label">{t('due')}</dt>
                      <dd className="metric-description">
                        {dueDateValue ? (
                          <time dateTime={dueDateValue} title={formatDateTimeTooltip(dueDateValue, locale)}>
                            {formatRelativeTime(dueDateValue, locale)}
                          </time>
                        ) : (
                          t('noDeadline')
                        )}
                      </dd>
                    </div>
                  </dl>

                  <div className="documents-row-actions" style={{ opacity: 1, transform: "none", pointerEvents: "auto" }}>
                    <Link href={`/surveys/${survey.id}`} className="button button-accent">
                      {t('takeSurvey')}
                    </Link>
                  </div>
                </article>
              );
            })}
          </section>
        )
      ) : null}
    </>
  );
}
