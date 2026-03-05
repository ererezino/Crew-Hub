"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useTimeAttendanceApprovals } from "../../../../hooks/use-time-attendance";
import { countryFlagFromCode, countryNameFromCode } from "../../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import { formatHoursFromMinutes } from "../../../../lib/time-attendance";
import { toSentenceCase } from "../../../../lib/format-labels";
import type { TimeAttendanceApprovalMutationResponse } from "../../../../types/time-attendance";

type SortDirection = "asc" | "desc";

function approvalsSkeleton() {
  return (
    <div className="table-skeleton" aria-hidden="true">
      <div className="table-skeleton-header" />
      {Array.from({ length: 6 }, (_, index) => (
        <div key={`time-attendance-approval-skeleton-${index}`} className="table-skeleton-row" />
      ))}
    </div>
  );
}

function toneForStatus(status: "pending" | "submitted" | "approved" | "rejected" | "locked") {
  switch (status) {
    case "pending":
      return "pending" as const;
    case "submitted":
      return "processing" as const;
    case "approved":
      return "success" as const;
    case "rejected":
      return "error" as const;
    case "locked":
      return "draft" as const;
    default:
      return "draft" as const;
  }
}

export function TimeAttendanceApprovalsClient({ embedded = false }: { embedded?: boolean }) {
  const approvalsQuery = useTimeAttendanceApprovals({
    status: "submitted"
  });
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [activeActionTimesheetId, setActiveActionTimesheetId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const sortedTimesheets = useMemo(() => {
    const rows = approvalsQuery.data?.timesheets ?? [];

    return [...rows].sort((leftTimesheet, rightTimesheet) => {
      const leftValue = new Date(`${leftTimesheet.weekStart}T00:00:00.000Z`).getTime();
      const rightValue = new Date(`${rightTimesheet.weekStart}T00:00:00.000Z`).getTime();

      return sortDirection === "asc" ? leftValue - rightValue : rightValue - leftValue;
    });
  }, [approvalsQuery.data?.timesheets, sortDirection]);

  const handleTimesheetAction = async (
    timesheetId: string,
    action: "approve" | "reject"
  ) => {
    setActionMessage(null);

    const rejectionReason =
      action === "reject"
        ? window.prompt("Provide a rejection reason for this timesheet:")?.trim() ?? ""
        : undefined;

    if (action === "reject" && (!rejectionReason || rejectionReason.length === 0)) {
      setActionMessage("Rejection reason is required.");
      return;
    }

    setActiveActionTimesheetId(timesheetId);

    try {
      const response = await fetch("/api/v1/time-attendance/approvals", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          timesheetId,
          action,
          rejectionReason
        })
      });

      const payload = (await response.json()) as TimeAttendanceApprovalMutationResponse;

      if (!response.ok || !payload.data) {
        setActionMessage(payload.error?.message ?? "Unable to update timesheet approval.");
        return;
      }

      setActionMessage(
        action === "approve"
          ? "Timesheet approved."
          : "Timesheet rejected."
      );
      approvalsQuery.refresh();
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Unable to update timesheet approval."
      );
    } finally {
      setActiveActionTimesheetId(null);
    }
  };

  return (
    <>
      {!embedded ? (
        <PageHeader
          title="Hours Approvals"
          description="Review submitted weekly timesheets from your reports before payroll processing."
        />
      ) : null}

      {approvalsQuery.isLoading ? approvalsSkeleton() : null}

      {!approvalsQuery.isLoading && approvalsQuery.errorMessage ? (
        <section className="error-state">
          <EmptyState
            title="Approvals are unavailable"
            description={approvalsQuery.errorMessage}
            ctaLabel="Back to dashboard"
            ctaHref={embedded ? "/approvals?tab=timesheets" : "/dashboard"}
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => approvalsQuery.refresh()}
          >
            Retry
          </button>
        </section>
      ) : null}

      {!approvalsQuery.isLoading && !approvalsQuery.errorMessage && sortedTimesheets.length === 0 ? (
        <EmptyState
          title="No submitted timesheets"
          description="Submitted timesheets from your team will appear here for review."
          ctaLabel="Open attendance"
          ctaHref="/time-attendance"
        />
      ) : null}

      {!approvalsQuery.isLoading && !approvalsQuery.errorMessage && sortedTimesheets.length > 0 ? (
        <section className="compensation-layout" aria-label="Timesheet approvals table">
          <article className="metric-card">
            <div>
              <h2 className="section-title">Pending review</h2>
              <p className="settings-card-description">
                {sortedTimesheets.length} submitted timesheets require approval.
              </p>
            </div>
            <StatusBadge tone="pending">Submitted</StatusBadge>
          </article>

          {actionMessage ? (
            <p className="settings-feedback" role="status">
              {actionMessage}
            </p>
          ) : null}

          <div className="data-table-container">
            <table className="data-table" aria-label="Submitted timesheets">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Country</th>
                  <th>
                    <button
                      type="button"
                      className="table-sort-trigger"
                      onClick={() =>
                        setSortDirection((currentDirection) =>
                          currentDirection === "asc" ? "desc" : "asc"
                        )
                      }
                    >
                      Week
                      <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                    </button>
                  </th>
                  <th>Worked</th>
                  <th>Overtime</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th className="table-action-column">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedTimesheets.map((timesheet) => (
                  <tr key={timesheet.id} className="data-table-row">
                    <td>
                      <div className="documents-cell-copy">
                        <p className="documents-cell-title">{timesheet.employeeName}</p>
                        <p className="documents-cell-description">
                          {timesheet.employeeDepartment ?? "No department"}
                        </p>
                      </div>
                    </td>
                    <td>
                      <span className="country-chip">
                        <span>{countryFlagFromCode(timesheet.employeeCountryCode)}</span>
                        <span>{countryNameFromCode(timesheet.employeeCountryCode)}</span>
                      </span>
                    </td>
                    <td className="numeric">
                      {timesheet.weekStart} to {timesheet.weekEnd}
                    </td>
                    <td className="numeric">{formatHoursFromMinutes(timesheet.totalWorkedMinutes)}h</td>
                    <td className="numeric">{formatHoursFromMinutes(timesheet.totalOvertimeMinutes)}h</td>
                    <td>
                      <StatusBadge tone={toneForStatus(timesheet.status)}>{toSentenceCase(timesheet.status)}</StatusBadge>
                    </td>
                    <td>
                      {timesheet.submittedAt ? (
                        <span title={formatDateTimeTooltip(timesheet.submittedAt)}>
                          {formatRelativeTime(timesheet.submittedAt)}
                        </span>
                      ) : (
                        "--"
                      )}
                    </td>
                    <td className="table-row-action-cell">
                      <div className="timeatt-row-actions">
                        <button
                          type="button"
                          className="table-row-action"
                          disabled={activeActionTimesheetId === timesheet.id}
                          onClick={() => {
                            void handleTimesheetAction(timesheet.id, "approve");
                          }}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="table-row-action"
                          disabled={activeActionTimesheetId === timesheet.id}
                          onClick={() => {
                            void handleTimesheetAction(timesheet.id, "reject");
                          }}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
