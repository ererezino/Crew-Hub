"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { ConfirmDialog } from "../../../../components/shared/confirm-dialog";
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
  const queryClient = useQueryClient();
  const approvalsQuery = useTimeAttendanceApprovals({
    status: "submitted"
  });
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [activeActionTimesheetId, setActiveActionTimesheetId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [rejectTimesheetId, setRejectTimesheetId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectionError, setRejectionError] = useState<string | null>(null);
  const [confirmApproveTimesheetId, setConfirmApproveTimesheetId] = useState<string | null>(null);

  const sortedTimesheets = useMemo(() => {
    const rows = approvalsQuery.data?.timesheets ?? [];

    return [...rows].sort((leftTimesheet, rightTimesheet) => {
      const leftValue = new Date(`${leftTimesheet.weekStart}T00:00:00.000Z`).getTime();
      const rightValue = new Date(`${rightTimesheet.weekStart}T00:00:00.000Z`).getTime();

      return sortDirection === "asc" ? leftValue - rightValue : rightValue - leftValue;
    });
  }, [approvalsQuery.data?.timesheets, sortDirection]);

  const handleApprove = async (timesheetId: string) => {
    setActionMessage(null);
    setActiveActionTimesheetId(timesheetId);

    try {
      const response = await fetch("/api/v1/time-attendance/approvals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timesheetId, action: "approve" })
      });

      const payload = (await response.json()) as TimeAttendanceApprovalMutationResponse;

      if (!response.ok || !payload.data) {
        setActionMessage(payload.error?.message ?? "Unable to approve timesheet.");
        return;
      }

      setActionMessage("Timesheet approved.");
      approvalsQuery.refresh();
      void queryClient.invalidateQueries({ queryKey: ["approvals-tab-counts"] });
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Unable to approve timesheet.");
    } finally {
      setActiveActionTimesheetId(null);
    }
  };

  const openRejectDialog = (timesheetId: string) => {
    setRejectTimesheetId(timesheetId);
    setRejectionReason("");
    setRejectionError(null);
    setActionMessage(null);
  };

  const executeReject = async () => {
    if (!rejectTimesheetId) return;

    const reason = rejectionReason.trim();

    if (reason.length === 0) {
      setRejectionError("Rejection reason is required.");
      return;
    }

    const timesheetId = rejectTimesheetId;
    setRejectTimesheetId(null);
    setActiveActionTimesheetId(timesheetId);

    try {
      const response = await fetch("/api/v1/time-attendance/approvals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timesheetId, action: "reject", rejectionReason: reason })
      });

      const payload = (await response.json()) as TimeAttendanceApprovalMutationResponse;

      if (!response.ok || !payload.data) {
        setActionMessage(payload.error?.message ?? "Unable to reject timesheet.");
        return;
      }

      setActionMessage("Timesheet rejected.");
      approvalsQuery.refresh();
      void queryClient.invalidateQueries({ queryKey: ["approvals-tab-counts"] });
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Unable to reject timesheet.");
    } finally {
      setActiveActionTimesheetId(null);
    }
  };

  const openApproveDialog = (timesheetId: string) => {
    setConfirmApproveTimesheetId(timesheetId);
  };

  const closeApproveDialog = () => {
    setConfirmApproveTimesheetId(null);
  };

  const confirmApprove = async () => {
    if (!confirmApproveTimesheetId) {
      return;
    }

    const targetTimesheetId = confirmApproveTimesheetId;
    closeApproveDialog();
    await handleApprove(targetTimesheetId);
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
        <>
          <EmptyState
            title="Approvals are unavailable"
            description={approvalsQuery.errorMessage}
            ctaHref={embedded ? "/approvals?tab=timesheets" : "/dashboard"}
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => approvalsQuery.refresh()}
          >
            Retry
          </button>
        </>
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
                  <th>Person</th>
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
                          {timesheet.employeeDepartment ?? ""}
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
                          onClick={() => openApproveDialog(timesheet.id)}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="table-row-action"
                          disabled={activeActionTimesheetId === timesheet.id}
                          onClick={() => openRejectDialog(timesheet.id)}
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

      {rejectTimesheetId !== null ? (
        <div
          className="modal-overlay"
          onClick={() => setRejectTimesheetId(null)}
        >
          <section
            className="confirm-dialog modal-dialog modal-dialog-danger"
            role="dialog"
            aria-modal="true"
            aria-label="Reject timesheet"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="modal-title">Reject timesheet?</h2>
            <p className="settings-card-description">
              The team member will be notified with your reason.
            </p>
            <label className="form-label" htmlFor="rejection-reason">
              Reason
            </label>
            <textarea
              id="rejection-reason"
              className="form-textarea"
              rows={3}
              placeholder="Explain why this timesheet is being rejected"
              value={rejectionReason}
              onChange={(e) => {
                setRejectionReason(e.target.value);
                setRejectionError(null);
              }}
            />
            {rejectionError ? (
              <p className="form-field-error">{rejectionError}</p>
            ) : null}
            <div className="modal-actions">
              <button
                type="button"
                className="button button-subtle"
                onClick={() => setRejectTimesheetId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button button-danger"
                onClick={() => void executeReject()}
              >
                Reject
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <ConfirmDialog
        isOpen={confirmApproveTimesheetId !== null}
        tone="default"
        title="Approve timesheet?"
        description="This timesheet will move forward for payroll processing."
        confirmLabel="Approve"
        cancelLabel="Cancel"
        onConfirm={() => void confirmApprove()}
        onCancel={closeApproveDialog}
      />
    </>
  );
}
