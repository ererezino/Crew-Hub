"use client";

import Link from "next/link";
import { useMemo } from "react";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { StatusBadge } from "../../../components/shared/status-badge";
import { usePendingSurveys } from "../../../hooks/use-surveys";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import { toSentenceCase } from "../../../lib/format-labels";

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
          title="Surveys"
          description="Respond to active pulse and engagement surveys assigned to you."
          actions={
            canManageSurveys ? (
              <Link href="/admin/surveys" className="button">
                Survey admin
              </Link>
            ) : null
          }
        />
      ) : null}

      {pendingQuery.isLoading ? surveysSkeleton() : null}

      {!pendingQuery.isLoading && pendingQuery.errorMessage ? (
        <section className="error-state">
          <EmptyState
            title="Surveys are unavailable"
            description={pendingQuery.errorMessage}
            ctaLabel="Back to dashboard"
            ctaHref="/dashboard"
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => pendingQuery.refresh()}
          >
            Retry
          </button>
        </section>
      ) : null}

      {!pendingQuery.isLoading && !pendingQuery.errorMessage ? (
        pendingSurveys.length === 0 ? (
          <EmptyState
            title="No pending surveys"
            description="You have responded to all active surveys in your queue."
            ctaLabel="Back to dashboard"
            ctaHref="/dashboard"
          />
        ) : (
          <section className="announcements-grid" aria-label="Pending surveys list">
            {pendingSurveys.map((survey) => {
              const dueDateValue = toDateTimeValue(survey.endDate);
              const startDateValue = toDateTimeValue(survey.startDate);

              return (
                <article key={survey.id} className="settings-card">
                  <header className="announcement-item-header">
                    <div>
                      <h2 className="section-title">{survey.title}</h2>
                      <p className="settings-card-description">
                        {survey.description || "No description provided."}
                      </p>
                    </div>
                    <div className="announcement-item-status">
                      <StatusBadge tone="pending">Pending</StatusBadge>
                      <StatusBadge tone="info">{toSentenceCase(survey.type)}</StatusBadge>
                    </div>
                  </header>

                  <dl className="compensation-timeline-list">
                    <div>
                      <dt className="metric-label">Questions</dt>
                      <dd className="metric-description numeric">{survey.questions.length}</dd>
                    </div>
                    <div>
                      <dt className="metric-label">Started</dt>
                      <dd className="metric-description">
                        {startDateValue ? (
                          <time dateTime={startDateValue} title={formatDateTimeTooltip(startDateValue)}>
                            {formatRelativeTime(startDateValue)}
                          </time>
                        ) : (
                          "Starts immediately"
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="metric-label">Due</dt>
                      <dd className="metric-description">
                        {dueDateValue ? (
                          <time dateTime={dueDateValue} title={formatDateTimeTooltip(dueDateValue)}>
                            {formatRelativeTime(dueDateValue)}
                          </time>
                        ) : (
                          "No deadline"
                        )}
                      </dd>
                    </div>
                  </dl>

                  <div className="documents-row-actions" style={{ opacity: 1, transform: "none", pointerEvents: "auto" }}>
                    <Link href={`/surveys/${survey.id}`} className="button button-accent">
                      Take survey
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
