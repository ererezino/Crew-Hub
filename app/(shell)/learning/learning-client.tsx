"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { StatusBadge } from "../../../components/shared/status-badge";
import { useLearningCourses, useLearningMyAssignments } from "../../../hooks/use-learning";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import type {
  LearningAssignmentRecord,
  LearningAssignmentStatus
} from "../../../types/learning";

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
      <div className="timeoff-table-skeleton">
        <div className="timeoff-table-skeleton-header" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={`learning-row-skeleton-${index}`} className="timeoff-table-skeleton-row" />
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

export function LearningClient() {
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
      <PageHeader
        title="Learning"
        description="Track assigned training, complete courses, and access certificates."
      />

      {isLoading ? learningSkeleton() : null}

      {!isLoading && errorMessage ? (
        <section className="compensation-error-state">
          <EmptyState
            title="Learning data is unavailable"
            description={errorMessage}
            ctaLabel="Back to dashboard"
            ctaHref="/dashboard"
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => {
              assignmentsQuery.refresh();
              coursesQuery.refresh();
            }}
          >
            Retry
          </button>
        </section>
      ) : null}

      {!isLoading && !errorMessage ? (
        <section className="compensation-layout" aria-label="Learning overview">
          <article className="metric-grid">
            <article className="metric-card">
              <p className="metric-label">Assigned courses</p>
              <p className="metric-value numeric">{totalAssigned}</p>
              <p className="metric-description">Total active learning assignments.</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">In progress</p>
              <p className="metric-value numeric">{inProgressCount}</p>
              <p className="metric-description">Courses you started but have not completed.</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Completed</p>
              <p className="metric-value numeric">{completedCount}</p>
              <p className="metric-description">Courses finished with completion tracked.</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Overdue</p>
              <p className="metric-value numeric">{overdueCount}</p>
              <p className="metric-description">Assignments past due date.</p>
            </article>
          </article>

          <article className="compensation-summary-card">
            <div>
              <h2 className="section-title">Completion overview</h2>
              <p className="settings-card-description">
                {completionPercent(sortedAssignments)}% completion rate across your assignments.
              </p>
            </div>
            <div className="documents-row-actions">
              <Link href="/learning/certificates" className="button">
                Certificates
              </Link>
              <Link href="/admin/learning" className="button">
                Learning admin
              </Link>
            </div>
          </article>

          <article className="compensation-section">
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">My assignments</h2>
                <p className="settings-card-description">
                  Due dates include relative labels with the full date on hover.
                </p>
              </div>
            </header>

            {sortedAssignments.length === 0 ? (
              <EmptyState
                title="No assignments yet"
                description="Your assigned training courses will appear here as soon as they are published to you."
                ctaLabel="Browse catalog"
                ctaHref="/learning"
              />
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label="Learning assignments table">
                  <thead>
                    <tr>
                      <th>Course</th>
                      <th>Category</th>
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
                          Due date
                          <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                        </button>
                      </th>
                      <th>Progress</th>
                      <th>Status</th>
                      <th className="table-action-column">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAssignments.map((assignment) => (
                      <tr key={assignment.id} className="data-table-row">
                        <td>{assignment.courseTitle}</td>
                        <td>{assignment.courseCategory ?? "General"}</td>
                        <td>
                          {assignment.dueDate ? (
                            <span title={formatDateTimeTooltip(`${assignment.dueDate}T00:00:00.000Z`)}>
                              {formatRelativeTime(`${assignment.dueDate}T00:00:00.000Z`)}
                            </span>
                          ) : (
                            "No due date"
                          )}
                        </td>
                        <td className="numeric">{assignment.progressPct}%</td>
                        <td>
                          <StatusBadge tone={toneForAssignmentStatus(assignment.status)}>
                            {assignment.status.replace("_", " ")}
                          </StatusBadge>
                        </td>
                        <td className="table-row-action-cell">
                          <div className="timeatt-row-actions">
                            <Link href={`/learning/courses/${assignment.courseId}`} className="table-row-action">
                              Open
                            </Link>
                            {assignment.status === "completed" ? (
                              <Link href="/learning/certificates" className="table-row-action">
                                Certificate
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
                <h2 className="section-title">Course catalog</h2>
                <p className="settings-card-description">
                  Published courses available in your workspace.
                </p>
              </div>
            </header>

            {sortedCourses.length === 0 ? (
              <EmptyState
                title="No published courses"
                description="Course catalog is empty right now. Check back after HR publishes content."
                ctaLabel="Refresh catalog"
                ctaHref="/learning"
              />
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label="Learning catalog table">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Category</th>
                      <th>Type</th>
                      <th>Duration</th>
                      <th>Status</th>
                      <th className="table-action-column">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCourses.map((course) => (
                      <tr key={course.id} className="data-table-row">
                        <td>{course.title}</td>
                        <td>{course.category ?? "General"}</td>
                        <td>
                          <StatusBadge tone="info">{course.contentType.replace("_", " ")}</StatusBadge>
                        </td>
                        <td className="numeric">
                          {course.durationMinutes === null ? "--" : `${course.durationMinutes}m`}
                        </td>
                        <td>
                          <StatusBadge tone={course.isMandatory ? "warning" : "draft"}>
                            {course.isMandatory ? "Mandatory" : "Optional"}
                          </StatusBadge>
                        </td>
                        <td className="table-row-action-cell">
                          <div className="timeatt-row-actions">
                            <Link href={`/learning/courses/${course.id}`} className="table-row-action">
                              Start
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
