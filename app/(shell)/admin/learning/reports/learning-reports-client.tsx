"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../components/shared/page-header";
import { StatusBadge } from "../../../../../components/shared/status-badge";
import { useLearningReports } from "../../../../../hooks/use-learning";
import { countryFlagFromCode, countryNameFromCode } from "../../../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../../lib/datetime";
import { toSentenceCase } from "../../../../../lib/format-labels";
import type { LearningAssignmentStatus } from "../../../../../types/learning";

type AppLocale = "en" | "fr";
type SortDirection = "asc" | "desc";

function toneForAssignmentStatus(status: LearningAssignmentStatus) {
  switch (status) {
    case "assigned":
      return "draft" as const;
    case "in_progress":
      return "processing" as const;
    case "completed":
      return "success" as const;
    case "overdue":
      return "warning" as const;
    case "failed":
      return "error" as const;
    default:
      return "draft" as const;
  }
}

function learningReportsSkeleton() {
  return (
    <section className="timeoff-skeleton-layout" aria-hidden="true">
      <div className="timeoff-balance-skeleton-grid">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={`learning-report-metric-skeleton-${index}`} className="timeoff-balance-skeleton-card" />
        ))}
      </div>
      <div className="table-skeleton">
        <div className="table-skeleton-header" />
        {Array.from({ length: 8 }, (_, index) => (
          <div key={`learning-report-row-skeleton-${index}`} className="table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

export function LearningReportsClient() {
  const t = useTranslations('learningReports');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;

  const reportsQuery = useLearningReports();
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sortedCourses = useMemo(() => {
    const rows = reportsQuery.data?.courses ?? [];

    return [...rows].sort((leftRow, rightRow) => {
      const comparison = leftRow.completionRatePct - rightRow.completionRatePct;
      return sortDirection === "asc" ? comparison : comparison * -1;
    });
  }, [reportsQuery.data?.courses, sortDirection]);

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
      />

      {reportsQuery.isLoading ? learningReportsSkeleton() : null}

      {!reportsQuery.isLoading && reportsQuery.errorMessage ? (
        <>
          <EmptyState
            title={t('unavailable')}
            description={reportsQuery.errorMessage}
            ctaLabel={t('backToAdmin')}
            ctaHref="/admin/learning"
          />
          <button type="button" className="button button-accent" onClick={() => reportsQuery.refresh()}>
            {tCommon('retry')}
          </button>
        </>
      ) : null}

      {!reportsQuery.isLoading && !reportsQuery.errorMessage && reportsQuery.data ? (
        <section className="compensation-layout" aria-label={t('overviewAriaLabel')}>
          <article className="metric-grid">
            <article className="metric-card">
              <p className="metric-label">{t('assigned')}</p>
              <p className="metric-value numeric">{reportsQuery.data.summary.totalAssigned}</p>
              <p className="metric-description">{t('assignedDescription')}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t('inProgress')}</p>
              <p className="metric-value numeric">{reportsQuery.data.summary.totalInProgress}</p>
              <p className="metric-description">{t('inProgressDescription')}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t('completed')}</p>
              <p className="metric-value numeric">{reportsQuery.data.summary.totalCompleted}</p>
              <p className="metric-description">{t('completedDescription')}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t('overdue')}</p>
              <p className="metric-value numeric">{reportsQuery.data.summary.totalOverdue}</p>
              <p className="metric-description">{t('overdueDescription')}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t('completionRate')}</p>
              <p className="metric-value numeric">{reportsQuery.data.summary.completionRatePct}%</p>
              <p className="metric-description">{t('completionRateDescription')}</p>
            </article>
          </article>

          <article className="compensation-section">
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">{t('byCourse')}</h2>
                <p className="settings-card-description">
                  {t('byCourseDescription')}
                </p>
              </div>
            </header>

            {sortedCourses.length === 0 ? (
              <EmptyState
                title={t('noCourseActivity')}
                description={t('noCourseActivityDescription')}
                ctaLabel={t('openLearningAdmin')}
                ctaHref="/admin/learning"
              />
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label={t('courseTableAriaLabel')}>
                  <thead>
                    <tr>
                      <th>{t('colCourse')}</th>
                      <th>{t('colAssigned')}</th>
                      <th>{t('colCompleted')}</th>
                      <th>{t('colOverdue')}</th>
                      <th>{t('colFailed')}</th>
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
                          {t('colCompletionRate')}
                          <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCourses.map((courseRow) => (
                      <tr key={courseRow.courseId} className="data-table-row">
                        <td>{courseRow.courseTitle}</td>
                        <td className="numeric">{courseRow.assignedCount}</td>
                        <td className="numeric">{courseRow.completedCount}</td>
                        <td className="numeric">{courseRow.overdueCount}</td>
                        <td className="numeric">{courseRow.failedCount}</td>
                        <td className="numeric">{courseRow.completionRatePct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <article className="compensation-section">
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">{t('overdueAssignments')}</h2>
                <p className="settings-card-description">
                  {t('overdueAssignmentsDescription')}
                </p>
              </div>
            </header>

            {reportsQuery.data.overdueAssignments.length === 0 ? (
              <EmptyState
                title={t('noOverdue')}
                description={t('noOverdueDescription')}
                ctaLabel={t('openLearningAdmin')}
                ctaHref="/admin/learning"
              />
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label={t('overdueTableAriaLabel')}>
                  <thead>
                    <tr>
                      <th>{t('colEmployee')}</th>
                      <th>{t('colCourse')}</th>
                      <th>{t('colCountry')}</th>
                      <th>{t('colDueDate')}</th>
                      <th>{t('colStatus')}</th>
                      <th className="table-action-column">{t('colActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportsQuery.data.overdueAssignments.map((assignment) => (
                      <tr key={assignment.id} className="data-table-row">
                        <td>{assignment.employeeName}</td>
                        <td>{assignment.courseTitle}</td>
                        <td>
                          {countryFlagFromCode(assignment.employeeCountryCode)} {" "}
                          {countryNameFromCode(assignment.employeeCountryCode, locale)}
                        </td>
                        <td>
                          {assignment.dueDate ? (
                            <span title={formatDateTimeTooltip(`${assignment.dueDate}T00:00:00.000Z`, locale)}>
                              {formatRelativeTime(`${assignment.dueDate}T00:00:00.000Z`, locale)}
                            </span>
                          ) : (
                            t('noDueDate')
                          )}
                        </td>
                        <td>
                          <StatusBadge tone={toneForAssignmentStatus(assignment.status)}>
                            {toSentenceCase(assignment.status)}
                          </StatusBadge>
                        </td>
                        <td className="table-row-action-cell">
                          <div className="timeatt-row-actions">
                            <Link href={`/learning/courses/${assignment.courseId}`} className="table-row-action">
                              {t('open')}
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </section>
      ) : null}
    </>
  );
}
