"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../components/shared/page-header";
import { StatusBadge } from "../../../../../components/shared/status-badge";
import { useLearningReports } from "../../../../../hooks/use-learning";
import { countryFlagFromCode, countryNameFromCode } from "../../../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../../lib/datetime";
import type { LearningAssignmentStatus } from "../../../../../types/learning";

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
      <div className="timeoff-table-skeleton">
        <div className="timeoff-table-skeleton-header" />
        {Array.from({ length: 8 }, (_, index) => (
          <div key={`learning-report-row-skeleton-${index}`} className="timeoff-table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

export function LearningReportsClient() {
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
        title="Learning Reports"
        description="Track completion rates and overdue learning assignments across Crew Hub."
      />

      {reportsQuery.isLoading ? learningReportsSkeleton() : null}

      {!reportsQuery.isLoading && reportsQuery.errorMessage ? (
        <section className="compensation-error-state">
          <EmptyState
            title="Learning reports are unavailable"
            description={reportsQuery.errorMessage}
            ctaLabel="Back to learning admin"
            ctaHref="/admin/learning"
          />
          <button type="button" className="button button-accent" onClick={() => reportsQuery.refresh()}>
            Retry
          </button>
        </section>
      ) : null}

      {!reportsQuery.isLoading && !reportsQuery.errorMessage && reportsQuery.data ? (
        <section className="compensation-layout" aria-label="Learning reports overview">
          <article className="metric-grid">
            <article className="metric-card">
              <p className="metric-label">Assigned</p>
              <p className="metric-value numeric">{reportsQuery.data.summary.totalAssigned}</p>
              <p className="metric-description">Assignments not yet started.</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">In progress</p>
              <p className="metric-value numeric">{reportsQuery.data.summary.totalInProgress}</p>
              <p className="metric-description">Assignments currently in progress.</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Completed</p>
              <p className="metric-value numeric">{reportsQuery.data.summary.totalCompleted}</p>
              <p className="metric-description">Assignments completed successfully.</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Overdue</p>
              <p className="metric-value numeric">{reportsQuery.data.summary.totalOverdue}</p>
              <p className="metric-description">Assignments beyond due date.</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Completion rate</p>
              <p className="metric-value numeric">{reportsQuery.data.summary.completionRatePct}%</p>
              <p className="metric-description">Completion across all tracked assignments.</p>
            </article>
          </article>

          <article className="compensation-section">
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">By course</h2>
                <p className="settings-card-description">
                  Completion and risk by course.
                </p>
              </div>
            </header>

            {sortedCourses.length === 0 ? (
              <EmptyState
                title="No course activity"
                description="Assign courses to employees to start seeing report data."
                ctaLabel="Open learning admin"
                ctaHref="/admin/learning"
              />
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label="Learning reports by course table">
                  <thead>
                    <tr>
                      <th>Course</th>
                      <th>Assigned</th>
                      <th>Completed</th>
                      <th>Overdue</th>
                      <th>Failed</th>
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
                          Completion rate
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
                <h2 className="section-title">Overdue assignments</h2>
                <p className="settings-card-description">
                  Oldest outstanding due dates first.
                </p>
              </div>
            </header>

            {reportsQuery.data.overdueAssignments.length === 0 ? (
              <EmptyState
                title="No overdue assignments"
                description="All learning assignments are currently on track."
                ctaLabel="Open learning admin"
                ctaHref="/admin/learning"
              />
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label="Overdue learning assignments table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Course</th>
                      <th>Country</th>
                      <th>Due date</th>
                      <th>Status</th>
                      <th className="table-action-column">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportsQuery.data.overdueAssignments.map((assignment) => (
                      <tr key={assignment.id} className="data-table-row">
                        <td>{assignment.employeeName}</td>
                        <td>{assignment.courseTitle}</td>
                        <td>
                          {countryFlagFromCode(assignment.employeeCountryCode)} {" "}
                          {countryNameFromCode(assignment.employeeCountryCode)}
                        </td>
                        <td>
                          {assignment.dueDate ? (
                            <span title={formatDateTimeTooltip(`${assignment.dueDate}T00:00:00.000Z`)}>
                              {formatRelativeTime(`${assignment.dueDate}T00:00:00.000Z`)}
                            </span>
                          ) : (
                            "No due date"
                          )}
                        </td>
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
