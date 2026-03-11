"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { StatusBadge } from "../../../components/shared/status-badge";
import { useLearningCourses, useLearningMyAssignments } from "../../../hooks/use-learning";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import { toSentenceCase } from "../../../lib/format-labels";
import { GraduationCap } from "lucide-react";
import type {
  LearningAssignmentRecord,
  LearningAssignmentStatus
} from "../../../types/learning";

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

function learningSkeleton() {
  return (
    <section className="timeoff-skeleton-layout" aria-hidden="true">
      <div className="timeoff-balance-skeleton-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={`learning-metric-skeleton-${index}`} className="timeoff-balance-skeleton-card" />
        ))}
      </div>
      <div className="table-skeleton">
        <div className="table-skeleton-header" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={`learning-row-skeleton-${index}`} className="table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

function completionPercent(rows: readonly LearningAssignmentRecord[]): number {
  if (rows.length === 0) {
    return 0;
  }

  const completedCount = rows.filter((row) => row.status === "completed").length;
  return Number(((completedCount / rows.length) * 100).toFixed(1));
}

export function LearningClient({ embedded = false }: { embedded?: boolean }) {
  const t = useTranslations('learning');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;

  const assignmentsQuery = useLearningMyAssignments();
  const coursesQuery = useLearningCourses();

  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const sortedAssignments = useMemo(() => {
    const rows = assignmentsQuery.data?.assignments ?? [];

    return [...rows].sort((leftRow, rightRow) => {
      const leftValue = leftRow.dueDate ? Date.parse(`${leftRow.dueDate}T00:00:00.000Z`) : Number.MAX_SAFE_INTEGER;
      const rightValue = rightRow.dueDate ? Date.parse(`${rightRow.dueDate}T00:00:00.000Z`) : Number.MAX_SAFE_INTEGER;

      return sortDirection === "asc" ? leftValue - rightValue : rightValue - leftValue;
    });
  }, [assignmentsQuery.data?.assignments, sortDirection]);

  const sortedCourses = useMemo(() => {
    const rows = coursesQuery.data?.courses ?? [];
    return [...rows].sort((leftRow, rightRow) => leftRow.title.localeCompare(rightRow.title));
  }, [coursesQuery.data?.courses]);

  const totalAssigned = sortedAssignments.length;
  const inProgressCount = sortedAssignments.filter((row) => row.status === "in_progress").length;
  const completedCount = sortedAssignments.filter((row) => row.status === "completed").length;
  const overdueCount = sortedAssignments.filter((row) => row.status === "overdue").length;

  const isLoading = assignmentsQuery.isLoading || coursesQuery.isLoading;
  const errorMessage = assignmentsQuery.errorMessage ?? coursesQuery.errorMessage;

  return (
    <>
      {!embedded ? (
        <PageHeader
          title={t('title')}
          description={t('description')}
        />
      ) : null}

      {isLoading ? learningSkeleton() : null}

      {!isLoading && errorMessage ? (
        <>
          <EmptyState
            title={t('unavailable')}
            description={errorMessage}
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => {
              assignmentsQuery.refresh();
              coursesQuery.refresh();
            }}
          >
            {tCommon('retry')}
          </button>
        </>
      ) : null}

      {!isLoading && !errorMessage ? (
        <section className="compensation-layout" aria-label={t('overviewAriaLabel')}>
          <article className="metric-grid">
            <article className="metric-card">
              <p className="metric-label">{t('assignedCourses')}</p>
              <p className="metric-value numeric">{totalAssigned}</p>
              <p className="metric-description">{t('assignedCoursesDescription')}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t('inProgress')}</p>
              <p className="metric-value numeric">{inProgressCount}</p>
              <p className="metric-description">{t('inProgressDescription')}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t('completed')}</p>
              <p className="metric-value numeric">{completedCount}</p>
              <p className="metric-description">{t('completedDescription')}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t('overdue')}</p>
              <p className="metric-value numeric">{overdueCount}</p>
              <p className="metric-description">{t('overdueDescription')}</p>
            </article>
          </article>

          <article className="metric-card">
            <div>
              <h2 className="section-title">{t('completionOverview')}</h2>
              <p className="settings-card-description">
                {t('completionRate', { pct: completionPercent(sortedAssignments) })}
              </p>
            </div>
            <div className="documents-row-actions">
              <Link href="/learning?tab=certificates" className="button">
                {t('certificatesLink')}
              </Link>
              <Link href="/admin/learning" className="button">
                {t('learningAdmin')}
              </Link>
            </div>
          </article>

          <article className="compensation-section">
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">{t('myAssignments')}</h2>
                <p className="settings-card-description">
                  {t('myAssignmentsDescription')}
                </p>
              </div>
            </header>

            {sortedAssignments.length === 0 ? (
              <EmptyState
                icon={<GraduationCap size={32} />}
                title={t('noCoursesAssigned')}
                description={t('noCoursesAssignedDescription')}
                ctaLabel={t('browseCatalog')}
                ctaHref="/learning"
              />
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label={t('assignmentsTableAriaLabel')}>
                  <thead>
                    <tr>
                      <th>{t('colCourse')}</th>
                      <th>{t('colCategory')}</th>
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
                          {t('colDueDate')}
                          <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                        </button>
                      </th>
                      <th>{t('colProgress')}</th>
                      <th>{t('colStatus')}</th>
                      <th className="table-action-column">{t('colActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAssignments.map((assignment) => (
                      <tr key={assignment.id} className="data-table-row">
                        <td>{assignment.courseTitle}</td>
                        <td>{assignment.courseCategory ?? t('general')}</td>
                        <td>
                          {assignment.dueDate ? (
                            <span title={formatDateTimeTooltip(`${assignment.dueDate}T00:00:00.000Z`, locale)}>
                              {formatRelativeTime(`${assignment.dueDate}T00:00:00.000Z`, locale)}
                            </span>
                          ) : (
                            t('noDueDate')
                          )}
                        </td>
                        <td className="numeric">{assignment.progressPct}%</td>
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
                            {assignment.status === "completed" ? (
                              <Link href="/learning?tab=certificates" className="table-row-action">
                                {t('certificate')}
                              </Link>
                            ) : null}
                          </div>
                        </td>
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
                <h2 className="section-title">{t('courseCatalog')}</h2>
                <p className="settings-card-description">
                  {t('courseCatalogDescription')}
                </p>
              </div>
            </header>

            {sortedCourses.length === 0 ? (
              <EmptyState
                icon={<GraduationCap size={32} />}
                title={t('noPublishedCourses')}
                description={t('noPublishedCoursesDescription')}
                ctaLabel={t('refreshCatalog')}
                ctaHref="/learning"
              />
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label={t('catalogTableAriaLabel')}>
                  <thead>
                    <tr>
                      <th>{t('colTitle')}</th>
                      <th>{t('colCategory')}</th>
                      <th>{t('colType')}</th>
                      <th>{t('colDuration')}</th>
                      <th>{t('colStatus')}</th>
                      <th className="table-action-column">{t('colActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCourses.map((course) => (
                      <tr key={course.id} className="data-table-row">
                        <td>{course.title}</td>
                        <td>{course.category ?? t('general')}</td>
                        <td>
                          <StatusBadge tone="info">{toSentenceCase(course.contentType)}</StatusBadge>
                        </td>
                        <td className="numeric">
                          {course.durationMinutes === null ? "--" : `${course.durationMinutes}m`}
                        </td>
                        <td>
                          <StatusBadge tone={course.isMandatory ? "warning" : "draft"}>
                            {course.isMandatory ? t('mandatory') : t('optional')}
                          </StatusBadge>
                        </td>
                        <td className="table-row-action-cell">
                          <div className="timeatt-row-actions">
                            <Link href={`/learning/courses/${course.id}`} className="table-row-action">
                              {t('start')}
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
