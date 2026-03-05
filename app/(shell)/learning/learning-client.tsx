"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { DataTable, type DataTableColumn, type DataTableAction } from "../../../components/shared/data-table";
import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { StatusBadge } from "../../../components/shared/status-badge";
import { useLearningCourses, useLearningMyAssignments } from "../../../hooks/use-learning";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import { toSentenceCase } from "../../../lib/format-labels";
import type {
  LearningAssignmentRecord,
  LearningAssignmentStatus,
  LearningCourseRecord
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

  const assignmentColumns: DataTableColumn<LearningAssignmentRecord>[] = [
    { key: "course", label: "Course", render: (row) => row.courseTitle },
    { key: "category", label: "Category", render: (row) => row.courseCategory ?? "General" },
    {
      key: "dueDate",
      label: "Due date",
      sortable: true,
      render: (row) =>
        row.dueDate ? (
          <span title={formatDateTimeTooltip(`${row.dueDate}T00:00:00.000Z`)}>
            {formatRelativeTime(`${row.dueDate}T00:00:00.000Z`)}
          </span>
        ) : (
          "No due date"
        )
    },
    { key: "progress", label: "Progress", className: "numeric", render: (row) => `${row.progressPct}%` },
    {
      key: "status",
      label: "Status",
      render: (row) => (
        <StatusBadge tone={toneForAssignmentStatus(row.status)}>
          {toSentenceCase(row.status)}
        </StatusBadge>
      )
    }
  ];

  const assignmentActions: DataTableAction<LearningAssignmentRecord>[] = [
    { label: "Open", href: (row) => `/learning/courses/${row.courseId}` },
    {
      label: "Certificate",
      href: "/learning?tab=certificates",
      hidden: (row) => row.status !== "completed"
    }
  ];

  const catalogColumns: DataTableColumn<LearningCourseRecord>[] = [
    { key: "title", label: "Title", render: (row) => row.title },
    { key: "category", label: "Category", render: (row) => row.category ?? "General" },
    {
      key: "type",
      label: "Type",
      render: (row) => <StatusBadge tone="info">{toSentenceCase(row.contentType)}</StatusBadge>
    },
    {
      key: "duration",
      label: "Duration",
      className: "numeric",
      render: (row) => (row.durationMinutes === null ? "--" : `${row.durationMinutes}m`)
    },
    {
      key: "status",
      label: "Status",
      render: (row) => (
        <StatusBadge tone={row.isMandatory ? "warning" : "draft"}>
          {row.isMandatory ? "Mandatory" : "Optional"}
        </StatusBadge>
      )
    }
  ];

  const catalogActions: DataTableAction<LearningCourseRecord>[] = [
    { label: "Start", href: (row) => `/learning/courses/${row.id}` }
  ];

  return (
    <>
      {!embedded ? (
        <PageHeader
          title="Learning"
          description="Track assigned training, complete courses, and access certificates."
        />
      ) : null}

      {isLoading ? learningSkeleton() : null}

      {!isLoading && errorMessage ? (
        <section className="error-state">
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

          <article className="metric-card">
            <div>
              <h2 className="section-title">Completion overview</h2>
              <p className="settings-card-description">
                {completionPercent(sortedAssignments)}% completion rate across your assignments.
              </p>
            </div>
            <div className="documents-row-actions">
              <Link href="/learning?tab=certificates" className="button">
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

            <DataTable<LearningAssignmentRecord>
              rows={sortedAssignments}
              columns={assignmentColumns}
              rowKey={(row) => row.id}
              ariaLabel="Learning assignments table"
              actions={assignmentActions}
              sort={{ key: "dueDate", direction: sortDirection }}
              onSort={() =>
                setSortDirection((currentValue) =>
                  currentValue === "asc" ? "desc" : "asc"
                )
              }
              emptyState={{
                title: "No assignments yet",
                description: "Your assigned training courses will appear here as soon as they are published to you.",
                ctaLabel: "Browse catalog",
                ctaHref: "/learning"
              }}
            />
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

            <DataTable<LearningCourseRecord>
              rows={sortedCourses}
              columns={catalogColumns}
              rowKey={(row) => row.id}
              ariaLabel="Learning catalog table"
              actions={catalogActions}
              emptyState={{
                title: "No published courses",
                description: "Course catalog is empty right now. Check back after HR publishes content.",
                ctaLabel: "Refresh catalog",
                ctaHref: "/learning"
              }}
            />
          </article>
        </section>
      ) : null}
    </>
  );
}
