"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useLearningMyAssignments } from "../../../../hooks/use-learning";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import type { LearningCertificateResponse } from "../../../../types/learning";

type SortDirection = "asc" | "desc";

function certificatesSkeleton() {
  return (
    <div className="table-skeleton" aria-hidden="true">
      <div className="table-skeleton-header" />
      {Array.from({ length: 6 }, (_, index) => (
        <div key={`learning-certificate-skeleton-${index}`} className="table-skeleton-row" />
      ))}
    </div>
  );
}

export function LearningCertificatesClient({ embedded = false }: { embedded?: boolean }) {
  const assignmentsQuery = useLearningMyAssignments({
    status: "completed"
  });

  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sortedAssignments = useMemo(() => {
    const rows = assignmentsQuery.data?.assignments ?? [];

    return [...rows].sort((leftRow, rightRow) => {
      const leftValue = leftRow.completedAt ? Date.parse(leftRow.completedAt) : 0;
      const rightValue = rightRow.completedAt ? Date.parse(rightRow.completedAt) : 0;

      return sortDirection === "asc" ? leftValue - rightValue : rightValue - leftValue;
    });
  }, [assignmentsQuery.data?.assignments, sortDirection]);

  async function openCertificate({ assignmentId, usage }: { assignmentId: string; usage: "view" | "download" }) {
    setPendingActionId(assignmentId);
    setErrorMessage(null);

    try {
      const response = await fetch(
        `/api/v1/learning/certificates/${assignmentId}?usage=${usage}&expiresIn=300`,
        {
          method: "GET"
        }
      );

      const payload = (await response.json()) as LearningCertificateResponse;

      if (!response.ok || !payload.data?.url) {
        setErrorMessage(payload.error?.message ?? "Unable to load certificate URL.");
        return;
      }

      window.open(payload.data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load certificate URL.");
    } finally {
      setPendingActionId(null);
    }
  }

  return (
    <>
      {!embedded ? (
        <PageHeader
          title="Certificates"
          description="View and download completion certificates for your finished courses."
        />
      ) : null}

      {assignmentsQuery.isLoading ? certificatesSkeleton() : null}

      {!assignmentsQuery.isLoading && assignmentsQuery.errorMessage ? (
        <>
          <EmptyState
            title="Certificate data is unavailable"
            description={assignmentsQuery.errorMessage}
            ctaLabel="Back to learning"
            ctaHref="/learning"
          />
          <button type="button" className="button button-accent" onClick={() => assignmentsQuery.refresh()}>
            Retry
          </button>
        </>
      ) : null}

      {!assignmentsQuery.isLoading && !assignmentsQuery.errorMessage ? (
        <section className="compensation-layout" aria-label="Learning certificates overview">
          <article className="metric-grid">
            <article className="metric-card">
              <p className="metric-label">Certificates earned</p>
              <p className="metric-value numeric">{sortedAssignments.length}</p>
              <p className="metric-description">Completed courses with tracked certificates.</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Last completion</p>
              <p className="metric-value">
                {sortedAssignments[0]?.completedAt
                  ? formatRelativeTime(sortedAssignments[0].completedAt)
                  : "--"}
              </p>
              <p className="metric-description">Most recent completion date.</p>
            </article>
          </article>

          {errorMessage ? <p className="form-field-error">{errorMessage}</p> : null}

          {sortedAssignments.length === 0 ? (
            <EmptyState
              title="No certificates yet"
              description="Complete your assigned courses to generate learning certificates."
              ctaLabel="Open learning"
              ctaHref="/learning"
            />
          ) : (
            <div className="data-table-container">
              <table className="data-table" aria-label="Learning certificates table">
                <thead>
                  <tr>
                    <th>Course</th>
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
                        Completed
                        <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      </button>
                    </th>
                    <th>Status</th>
                    <th className="table-action-column">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAssignments.map((assignment) => (
                    <tr key={assignment.id} className="data-table-row">
                      <td>{assignment.courseTitle}</td>
                      <td>
                        {assignment.completedAt ? (
                          <span title={formatDateTimeTooltip(assignment.completedAt)}>
                            {formatRelativeTime(assignment.completedAt)}
                          </span>
                        ) : (
                          "--"
                        )}
                      </td>
                      <td>
                        <StatusBadge tone="success">completed</StatusBadge>
                      </td>
                      <td className="table-row-action-cell">
                        <div className="timeatt-row-actions">
                          {assignment.certificateUrl ? (
                            <>
                              <button
                                type="button"
                                className="table-row-action"
                                disabled={pendingActionId === assignment.id}
                                onClick={() => void openCertificate({ assignmentId: assignment.id, usage: "view" })}
                              >
                                View
                              </button>
                              <button
                                type="button"
                                className="table-row-action"
                                disabled={pendingActionId === assignment.id}
                                onClick={() => void openCertificate({ assignmentId: assignment.id, usage: "download" })}
                              >
                                Download
                              </button>
                            </>
                          ) : (
                            <span className="table-row-action">Pending</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
