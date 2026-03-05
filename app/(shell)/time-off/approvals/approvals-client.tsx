"use client";

import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { EmptyState } from "../../../../components/shared/empty-state";
import { ErrorState } from "../../../../components/shared/error-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { SlidePanel } from "../../../../components/shared/slide-panel";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useTimeOffApprovals } from "../../../../hooks/use-time-off";
import { countryFlagFromCode, countryNameFromCode } from "../../../../lib/countries";
import { formatDays, formatDateRangeHuman, formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import { formatLeaveStatus } from "../../../../lib/format-labels";
import { formatLeaveTypeLabel } from "../../../../lib/time-off";
import type { LeaveRequestRecord, TimeOffRequestMutationResponse } from "../../../../types/time-off";

type OverlapMember = {
  name: string;
  leaveType: string;
  startDate: string;
  endDate: string;
};

type SortDirection = "asc" | "desc";
type ToastVariant = "success" | "error" | "info";

type ToastMessage = {
  id: string;
  message: string;
  variant: ToastVariant;
};

type RejectFormValues = {
  rejectionReason: string;
};

type RejectFormErrors = {
  rejectionReason?: string;
};

const rejectSchema = z.object({
  rejectionReason: z.string().trim().min(1, "Rejection reason is required").max(2000, "Reason is too long")
});

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ApprovalTableSkeleton() {
  return (
    <div className="table-skeleton" aria-hidden="true">
      <div className="table-skeleton-header" />
      {Array.from({ length: 6 }, (_, index) => (
        <div key={`timeoff-approval-skeleton-${index}`} className="table-skeleton-row" />
      ))}
    </div>
  );
}

function toneForStatus(status: LeaveRequestRecord["status"]) {
  switch (status) {
    case "pending":
      return "pending" as const;
    case "approved":
      return "success" as const;
    case "rejected":
      return "error" as const;
    case "cancelled":
      return "warning" as const;
    default:
      return "draft" as const;
  }
}

export function TimeOffApprovalsClient({ embedded = false }: { embedded?: boolean }) {
  const approvalsQuery = useTimeOffApprovals();
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isMutatingRequestId, setIsMutatingRequestId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<LeaveRequestRecord | null>(null);
  const [rejectValues, setRejectValues] = useState<RejectFormValues>({ rejectionReason: "" });
  const [rejectErrors, setRejectErrors] = useState<RejectFormErrors>({});
  const [isRejecting, setIsRejecting] = useState(false);
  const [detailTarget, setDetailTarget] = useState<LeaveRequestRecord | null>(null);
  const [approvalNote, setApprovalNote] = useState("");
  const [teamOverlap, setTeamOverlap] = useState<OverlapMember[]>([]);

  const requests = useMemo(() => {
    const rows = approvalsQuery.data?.requests ?? [];

    return [...rows].sort((leftRequest, rightRequest) => {
      const leftTime = Date.parse(`${leftRequest.startDate}T00:00:00.000Z`);
      const rightTime = Date.parse(`${rightRequest.startDate}T00:00:00.000Z`);

      return sortDirection === "asc" ? leftTime - rightTime : rightTime - leftTime;
    });
  }, [approvalsQuery.data?.requests, sortDirection]);

  const dismissToast = (toastId: string) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
  };

  const showToast = (variant: ToastVariant, message: string) => {
    const toastId = createToastId();
    setToasts((currentToasts) => [...currentToasts, { id: toastId, variant, message }]);

    window.setTimeout(() => {
      dismissToast(toastId);
    }, 4000);
  };

  const openDetailPanel = useCallback((requestRecord: LeaveRequestRecord) => {
    setDetailTarget(requestRecord);
    setApprovalNote("");
  }, []);

  const closeDetailPanel = useCallback(() => {
    setDetailTarget(null);
    setApprovalNote("");
    setTeamOverlap([]);
  }, []);

  // Fetch team overlap when detail panel opens
  useEffect(() => {
    if (!detailTarget) return;

    const controller = new AbortController();
    const params = new URLSearchParams({
      startDate: detailTarget.startDate,
      endDate: detailTarget.endDate
    });

    fetch(`/api/v1/time-off/overlap?${params.toString()}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((json: { data?: { overlap: OverlapMember[] } }) => {
        if (json.data?.overlap) {
          setTeamOverlap(json.data.overlap);
        }
      })
      .catch(() => {
        // Ignore abort errors
      });

    return () => controller.abort();
  }, [detailTarget]);

  const handleApprove = async (requestRecord: LeaveRequestRecord) => {
    setIsMutatingRequestId(requestRecord.id);

    try {
      const response = await fetch(`/api/v1/time-off/requests/${requestRecord.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "approve",
          approvalNote: approvalNote.trim() || undefined
        })
      });

      const payload = (await response.json()) as TimeOffRequestMutationResponse;

      if (!response.ok || !payload.data?.request) {
        showToast("error", payload.error?.message ?? "Unable to approve leave request.");
        return;
      }

      approvalsQuery.refresh();
      closeDetailPanel();
      showToast("success", "Leave request approved.");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to approve leave request.");
    } finally {
      setIsMutatingRequestId(null);
    }
  };

  const openRejectPanel = (requestRecord: LeaveRequestRecord) => {
    setRejectTarget(requestRecord);
    setRejectValues({ rejectionReason: "" });
    setRejectErrors({});
  };

  const closeRejectPanel = () => {
    setRejectTarget(null);
    setRejectValues({ rejectionReason: "" });
    setRejectErrors({});
  };

  const handleRejectReasonChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValues = {
      rejectionReason: event.currentTarget.value
    };

    setRejectValues(nextValues);
    const validation = rejectSchema.safeParse(nextValues);
    setRejectErrors(validation.success ? {} : { rejectionReason: validation.error.flatten().fieldErrors.rejectionReason?.[0] });
  };

  const handleSubmitReject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!rejectTarget) {
      return;
    }

    const validation = rejectSchema.safeParse(rejectValues);

    if (!validation.success) {
      setRejectErrors({
        rejectionReason: validation.error.flatten().fieldErrors.rejectionReason?.[0]
      });
      return;
    }

    setIsRejecting(true);

    try {
      const response = await fetch(`/api/v1/time-off/requests/${rejectTarget.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "reject",
          rejectionReason: rejectValues.rejectionReason.trim()
        })
      });

      const payload = (await response.json()) as TimeOffRequestMutationResponse;

      if (!response.ok || !payload.data?.request) {
        showToast("error", payload.error?.message ?? "Unable to reject leave request.");
        return;
      }

      approvalsQuery.refresh();
      closeRejectPanel();
      showToast("info", "Leave request rejected.");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to reject leave request.");
    } finally {
      setIsRejecting(false);
    }
  };

  return (
    <>
      {!embedded ? (
        <PageHeader
          title="Time Off Approvals"
          description="Review pending leave requests from your team and process approvals."
        />
      ) : null}

      {approvalsQuery.isLoading ? <ApprovalTableSkeleton /> : null}

      {!approvalsQuery.isLoading && approvalsQuery.errorMessage ? (
        <ErrorState
          title="Approvals are unavailable"
          message={approvalsQuery.errorMessage}
          onRetry={approvalsQuery.refresh}
        />
      ) : null}

      {!approvalsQuery.isLoading && !approvalsQuery.errorMessage && requests.length === 0 ? (
        <EmptyState
          title="No pending approvals"
          description="Pending leave requests from your team will appear here."
          ctaLabel="Open Time Off"
          ctaHref="/time-off"
        />
      ) : null}

      {!approvalsQuery.isLoading && !approvalsQuery.errorMessage && requests.length > 0 ? (
        <div className="data-table-container">
          <table className="data-table" aria-label="Time off approvals table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Country</th>
                <th>Leave type</th>
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
                    Dates {sortDirection === "asc" ? "↑" : "↓"}
                  </button>
                </th>
                <th>Days</th>
                <th>Status</th>
                <th>Requested</th>
                <th className="table-action-column">Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((requestRecord) => (
                <tr key={requestRecord.id} className="data-table-row">
                  <td>
                    <div className="documents-cell-copy">
                      <p className="documents-cell-title">{requestRecord.employeeName}</p>
                      <p className="documents-cell-description">
                        {requestRecord.employeeDepartment ?? "No department"}
                      </p>
                    </div>
                  </td>
                  <td>
                    <span className="country-chip">
                      <span>{countryFlagFromCode(requestRecord.employeeCountryCode)}</span>
                      <span>{countryNameFromCode(requestRecord.employeeCountryCode)}</span>
                    </span>
                  </td>
                  <td>{formatLeaveTypeLabel(requestRecord.leaveType)}</td>
                  <td>
                    <time
                      dateTime={requestRecord.startDate}
                      title={formatDateTimeTooltip(requestRecord.startDate)}
                    >
                      {formatDateRangeHuman(requestRecord.startDate, requestRecord.endDate)}
                    </time>
                  </td>
                  <td className="numeric">{formatDays(requestRecord.totalDays)}</td>
                  <td>
                    <StatusBadge tone={toneForStatus(requestRecord.status)}>
                      {formatLeaveStatus(requestRecord.status)}
                    </StatusBadge>
                  </td>
                  <td>
                    <time
                      dateTime={requestRecord.createdAt}
                      title={formatDateTimeTooltip(requestRecord.createdAt)}
                    >
                      {formatRelativeTime(requestRecord.createdAt)}
                    </time>
                  </td>
                  <td className="table-row-action-cell">
                    <div className="timeoff-row-actions">
                      <button
                        type="button"
                        className="button button-accent notification-action-button"
                        onClick={() => openDetailPanel(requestRecord)}
                        disabled={isMutatingRequestId === requestRecord.id}
                      >
                        Review
                      </button>
                      <button
                        type="button"
                        className="table-row-action"
                        onClick={() => handleApprove(requestRecord)}
                        disabled={isMutatingRequestId === requestRecord.id}
                      >
                        {isMutatingRequestId === requestRecord.id ? "Saving..." : "Approve"}
                      </button>
                      <button
                        type="button"
                        className="table-row-action"
                        onClick={() => openRejectPanel(requestRecord)}
                        disabled={isMutatingRequestId === requestRecord.id}
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
      ) : null}

      <SlidePanel
        isOpen={Boolean(rejectTarget)}
        title="Reject Leave Request"
        description={rejectTarget ? `Provide a reason for rejecting ${rejectTarget.employeeName}'s request.` : undefined}
        onClose={closeRejectPanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleSubmitReject} noValidate>
          <label className="form-field" htmlFor="timeoff-reject-reason">
            <span className="form-label">Rejection reason</span>
            <textarea
              id="timeoff-reject-reason"
              className={rejectErrors.rejectionReason ? "form-input form-input-error" : "form-input"}
              value={rejectValues.rejectionReason}
              onChange={handleRejectReasonChange}
              rows={5}
            />
            {rejectErrors.rejectionReason ? (
              <p className="form-field-error">{rejectErrors.rejectionReason}</p>
            ) : null}
          </label>

          <div className="slide-panel-actions">
            <button type="button" className="button" onClick={closeRejectPanel}>
              Cancel
            </button>
            <button type="submit" className="button button-accent" disabled={isRejecting}>
              {isRejecting ? "Rejecting..." : "Reject request"}
            </button>
          </div>
        </form>
      </SlidePanel>

      <SlidePanel
        isOpen={Boolean(detailTarget)}
        title="Review Leave Request"
        description={detailTarget ? `${detailTarget.employeeName} - ${formatLeaveTypeLabel(detailTarget.leaveType)}` : undefined}
        onClose={closeDetailPanel}
      >
        {detailTarget ? (
          <div className="slide-panel-form-wrapper">
            <dl className="leave-review-summary">
              <dt>Employee</dt>
              <dd>{detailTarget.employeeName}</dd>
              <dt>Department</dt>
              <dd>{detailTarget.employeeDepartment ?? "N/A"}</dd>
              <dt>Leave type</dt>
              <dd>{formatLeaveTypeLabel(detailTarget.leaveType)}</dd>
              <dt>Dates</dt>
              <dd>{formatDateRangeHuman(detailTarget.startDate, detailTarget.endDate)}</dd>
              <dt>Duration</dt>
              <dd className="numeric">{formatDays(detailTarget.totalDays)}</dd>
              <dt>Reason</dt>
              <dd>{detailTarget.reason || "No reason provided"}</dd>
            </dl>

            {teamOverlap.length > 0 ? (
              <aside className="leave-review-overlap" aria-label="Team overlap">
                <p className="leave-review-overlap-heading">Team members also out during this period</p>
                <ul className="leave-review-overlap-list">
                  {teamOverlap.map((member, idx) => (
                    <li key={idx}>
                      <span>{member.name}</span>
                      <span className="settings-card-description">
                        {formatLeaveTypeLabel(member.leaveType)} ({member.startDate} - {member.endDate})
                      </span>
                    </li>
                  ))}
                </ul>
              </aside>
            ) : (
              <p className="settings-card-description" style={{ marginBottom: "var(--space-3)" }}>
                No other team members are out during this period.
              </p>
            )}

            <label className="form-field" htmlFor="leave-approval-note">
              <span className="form-label">Approval note (optional)</span>
              <textarea
                id="leave-approval-note"
                className="form-input"
                value={approvalNote}
                onChange={(e) => setApprovalNote(e.currentTarget.value)}
                rows={3}
                placeholder="Add a note visible to the employee"
                maxLength={500}
              />
            </label>

            <div className="slide-panel-actions">
              <button
                type="button"
                className="button"
                onClick={() => openRejectPanel(detailTarget)}
              >
                Reject
              </button>
              <button
                type="button"
                className="button button-accent"
                onClick={() => handleApprove(detailTarget)}
                disabled={isMutatingRequestId === detailTarget.id}
              >
                {isMutatingRequestId === detailTarget.id ? "Approving..." : "Approve"}
              </button>
            </div>
          </div>
        ) : null}
      </SlidePanel>

      {toasts.length > 0 ? (
        <section className="toast-region" aria-live="polite">
          {toasts.map((toast) => (
            <article
              key={toast.id}
              className={`toast-message toast-message-${toast.variant}`}
              role="status"
            >
              <p>{toast.message}</p>
              <button
                type="button"
                className="toast-dismiss"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss notification"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </article>
          ))}
        </section>
      ) : null}
    </>
  );
}
