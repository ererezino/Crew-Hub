"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useAdminSurveys } from "../../../../hooks/use-surveys";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import { toSentenceCase } from "../../../../lib/format-labels";
import type { SurveyLaunchResponse, SurveyRecord } from "../../../../types/surveys";

type AppLocale = "en" | "fr";
type SortDirection = "asc" | "desc";

function toDateTimeValue(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return `${value}T00:00:00.000Z`;
}

function toneForSurveyStatus(
  status: SurveyRecord["status"]
): "success" | "warning" | "error" | "info" | "pending" | "draft" | "processing" {
  switch (status) {
    case "active":
      return "success";
    case "closed":
      return "draft";
    case "archived":
      return "processing";
    default:
      return "pending";
  }
}

function adminSurveysSkeleton() {
  return (
    <section className="timeoff-skeleton-layout" aria-hidden="true">
      <div className="timeoff-balance-skeleton-grid">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={`admin-surveys-metric-skeleton-${index}`} className="timeoff-balance-skeleton-card" />
        ))}
      </div>
      <div className="table-skeleton">
        <div className="table-skeleton-header" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={`admin-surveys-row-skeleton-${index}`} className="table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

export function AdminSurveysClient() {
  const t = useTranslations('adminSurveys');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;

  const adminQuery = useAdminSurveys();
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [launchingSurveyId, setLaunchingSurveyId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const surveys = useMemo(() => {
    const rows = adminQuery.data?.surveys ?? [];

    return [...rows].sort((leftSurvey, rightSurvey) => {
      const comparison = leftSurvey.title.localeCompare(rightSurvey.title);
      return sortDirection === "asc" ? comparison : comparison * -1;
    });
  }, [adminQuery.data?.surveys, sortDirection]);

  const activeCount = surveys.filter((survey) => survey.status === "active").length;
  const draftCount = surveys.filter((survey) => survey.status === "draft").length;
  const totalResponses = surveys.reduce(
    (sum, survey) => sum + survey.responseCount,
    0
  );

  const launchSurvey = async (surveyId: string) => {
    setLaunchingSurveyId(surveyId);
    setFeedbackMessage(null);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/v1/surveys/${surveyId}/launch`, {
        method: "POST"
      });

      const payload = (await response.json()) as SurveyLaunchResponse;

      if (!response.ok || !payload.data?.survey) {
        setErrorMessage(payload.error?.message ?? t('launchError'));
        return;
      }

      setFeedbackMessage(t('launchSuccess'));
      adminQuery.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('launchError'));
    } finally {
      setLaunchingSurveyId(null);
    }
  };

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <Link href="/admin/surveys/new" className="button button-accent">
              {t('newSurvey')}
            </Link>
            <Link href="/surveys" className="button">
              {t('employeeView')}
            </Link>
          </>
        }
      />

      {adminQuery.isLoading ? adminSurveysSkeleton() : null}

      {!adminQuery.isLoading && (adminQuery.errorMessage || errorMessage) ? (
        <>
          <EmptyState
            title={t('unavailable')}
            description={errorMessage ?? adminQuery.errorMessage ?? t('unableToLoad')}
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => {
              setErrorMessage(null);
              adminQuery.refresh();
            }}
          >
            {tCommon('retry')}
          </button>
        </>
      ) : null}

      {!adminQuery.isLoading && !adminQuery.errorMessage && !errorMessage ? (
        <section className="compensation-layout" aria-label={t('overviewAriaLabel')}>
          <section className="metric-grid">
            <article className="metric-card">
              <p className="metric-label">{t('surveys')}</p>
              <p className="metric-value numeric">{surveys.length}</p>
              <p className="metric-description">{t('surveysDescription')}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t('active')}</p>
              <p className="metric-value numeric">{activeCount}</p>
              <p className="metric-description">{t('activeDescription')}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t('draft')}</p>
              <p className="metric-value numeric">{draftCount}</p>
              <p className="metric-description">{t('draftDescription')}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t('responses')}</p>
              <p className="metric-value numeric">{totalResponses}</p>
              <p className="metric-description">{t('responsesDescription')}</p>
            </article>
          </section>

          {feedbackMessage ? <p className="settings-feedback">{feedbackMessage}</p> : null}

          {surveys.length === 0 ? (
            <EmptyState
              title={t('noSurveys')}
              description={t('noSurveysDescription')}
              ctaLabel={t('createSurvey')}
              ctaHref="/admin/surveys/new"
            />
          ) : (
            <div className="data-table-container">
              <table className="data-table" aria-label={t('tableAriaLabel')}>
                <thead>
                  <tr>
                    <th>
                      <button
                        type="button"
                        className="table-sort-trigger"
                        onClick={() =>
                          setSortDirection((currentValue) =>
                            currentValue === "asc" ? "desc" : "asc"
                          )
                        }
                      >
                        {t('colSurvey')}
                        <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      </button>
                    </th>
                    <th>{t('colStatus')}</th>
                    <th>{t('colType')}</th>
                    <th>{t('colQuestions')}</th>
                    <th>{t('colResponses')}</th>
                    <th>{t('colWindow')}</th>
                    <th>{t('colUpdated')}</th>
                    <th className="table-action-column">{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {surveys.map((survey) => {
                    const startDate = toDateTimeValue(survey.startDate);
                    const endDate = toDateTimeValue(survey.endDate);

                    return (
                      <tr key={survey.id} className="data-table-row">
                        <td>
                          <p>{survey.title}</p>
                          <p className="metric-description">{survey.description ?? t('noDescription')}</p>
                        </td>
                        <td>
                          <StatusBadge tone={toneForSurveyStatus(survey.status)}>{toSentenceCase(survey.status)}</StatusBadge>
                        </td>
                        <td>
                          <StatusBadge tone="info">{toSentenceCase(survey.type)}</StatusBadge>
                        </td>
                        <td className="numeric">{survey.questions.length}</td>
                        <td className="numeric">{survey.responseCount}</td>
                        <td>
                          {startDate ? (
                            <div>
                              <time dateTime={startDate} title={formatDateTimeTooltip(startDate, locale)}>
                                {formatRelativeTime(startDate, locale)}
                              </time>
                              {endDate ? (
                                <>
                                  {" "}→{" "}
                                  <time dateTime={endDate} title={formatDateTimeTooltip(endDate, locale)}>
                                    {formatRelativeTime(endDate, locale)}
                                  </time>
                                </>
                              ) : null}
                            </div>
                          ) : (
                            <span className="metric-description">{t('noWindow')}</span>
                          )}
                        </td>
                        <td>
                          <time dateTime={survey.updatedAt} title={formatDateTimeTooltip(survey.updatedAt, locale)}>
                            {formatRelativeTime(survey.updatedAt, locale)}
                          </time>
                        </td>
                        <td className="table-row-action-cell">
                          <div className="documents-row-actions">
                            <Link href={`/surveys/${survey.id}`} className="table-row-action">
                              {t('preview')}
                            </Link>
                            <Link
                              href={`/admin/surveys/${survey.id}/results`}
                              className="table-row-action"
                            >
                              {t('results')}
                            </Link>
                            {survey.status === "draft" ? (
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => launchSurvey(survey.id)}
                                disabled={launchingSurveyId === survey.id}
                              >
                                {launchingSurveyId === survey.id ? t('launching') : t('launch')}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
