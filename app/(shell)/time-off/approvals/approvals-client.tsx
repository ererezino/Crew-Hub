"use client";

import { type ChangeEvent, type FormEvent, useMemo, useState } from "react";
import { z } from "zod";

import { EmptyState } from "../../../../components/shared/empty-state";
import { ErrorState } from "../../../../components/shared/error-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { SlidePanel } from "../../../../components/shared/slide-panel";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { TeamAvailabilityPanel } from "../../../../components/time-off/team-availability-panel";
import { useTimeOffApprovals } from "../../../../hooks/use-time-off";
import { countryFlagFromCode, countryNameFromCode } from "../../../../lib/countries";
import { formatDays, formatDateRangeHuman, formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import { formatLeaveStatus } from "../../../../lib/format-labels";
import { formatLeaveTypeLabel } from "../../../../lib/time-off";
import type { LeaveRequestRecord, TimeOffRequestMutationResponse } from "../../../../types/time-off";
import { humanizeError } from "@/lib/errors";

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
  const [contextTarget, setContextTarget] = useState<LeaveRequestRecord | null>(null);
  const [rejectTarget, setRejectTarget] = useState<LeaveRequestRecord | null>(null);
  const [rejectValues, setRejectValues] = useState<RejectFormValues>({ rejectionReason: "" });
  const [rejectErrors, setRejectErrors] = useState<RejectFormErrors>({});
  const [isRejecting, setIsRejecting] = useState(false);

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

  const showToast = (variant: ToastVariant, rawMessage: string) => {
    const message = variant === "error" ? humanizeError(rawMessage) : rawMessage;
    const toastId = createToastId();
    setToasts((currentToasts) => [...currentToasts, { id: toastId, variant, message }]);

    window.setTimeout(() => {
      dismissToast(toastId);
    }, 4000);
  };

  const handleApprove = async (requestRecord: LeaveRequestRecord) => {
    setIsMutatingRequestId(requestRecord.id);

    try {
      const response = await fetch(`/api/v1/time-off/requests/${requestRecord.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "approve"
        })
      });

      const payload = (await response.json()) as TimeOffRequestMutationResponse;

      if (!response.ok || !payload.data?.request) {
        showToast("error", payload.error?.message ?? "Unable to approve leave request.");
        return;
      }

      approvalsQuery.refresh();
      if (contextTarget?.id === requestRecord.id) {
        setContextTarget(null);
      }
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

  const openContextPanel = (requestRecord: LeaveRequestRecord) => {
    setContextTarget(requestRecord);
  };

  const closeContextPanel = () => {
    setContextTarget(null);
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

    const confirmed = window.confirm(
      `Reject ${rejectTarget.employeeName}'s leave request? This action requires a reason and will notify the employee.`
    );

    if (!confirmed) {
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
          description="Approve or decline team leave requests with full date context and clear decision history."
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
                        {requestRecord.employeeDepartment ?? ""}
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
                        className="table-row-action"
                        onClick={() => openContextPanel(requestRecord)}
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
        isOpen={Boolean(contextTarget)}
        title="Review Leave Request"
        description={
          contextTarget
            ? `Review full context for ${contextTarget.employeeName} before making an approval decision.`
            : undefined
        }
        onClose={closeContextPanel}
      >
        {contextTarget ? (
          <div className="slide-panel-form-wrapper">
            <article className="settings-card">
              <h3 className="section-title">{contextTarget.employeeName}</h3>
              <p className="settings-card-description">
                {contextTarget.employeeDepartment ?? ""}
              </p>
              <p className="settings-card-description">
                <span className="country-chip">
                  <span>{countryFlagFromCode(contextTarget.employeeCountryCode)}</span>
                  <span>{countryNameFromCode(contextTarget.employeeCountryCode)}</span>
                </span>
              </p>
              <p className="settings-card-description">
                Leave type: {formatLeaveTypeLabel(contextTarget.leaveType)}
              </p>
              <p className="settings-card-description">
                Date range: {formatDateRangeHuman(contextTarget.startDate, contextTarget.endDate)}
              </p>
              <p className="settings-card-description">
                Total days: <span className="numeric">{formatDays(contextTarget.totalDays)}</span>
              </p>
              <p className="settings-card-description">
                Submitted:{" "}
                <time
                  dateTime={contextTarget.createdAt}
                  title={formatDateTimeTooltip(contextTarget.createdAt)}
                >
                  {formatRelativeTime(contextTarget.createdAt)}
                </time>
              </p>
              <p className="settings-card-description">Reason: {contextTarget.reason}</p>
            </article>

            <article className="settings-card">
              <h3 className="section-title">Team calendar context</h3>
              <p className="settings-card-description">
                Review team calendar context before approval to avoid overlapping absences.
              </p>
              <TeamAvailabilityPanel
                startDate={contextTarget.startDate}
                endDate={contextTarget.endDate}
              />
            </article>

            <div className="slide-panel-actions">
              <button
                type="button"
                className="button"
                onClick={closeContextPanel}
              >
                Close
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  closeContextPanel();
                  openRejectPanel(contextTarget);
                }}
                disabled={isMutatingRequestId === contextTarget.id}
              >
                Reject
              </button>
              <button
                type="button"
                className="button button-accent"
                onClick={() => handleApprove(contextTarget)}
                disabled={isMutatingRequestId === contextTarget.id}
              >
                {isMutatingRequestId === contextTarget.id ? "Saving..." : "Approve"}
              </button>
            </div>
          </div>
        ) : null}
      </SlidePanel>

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
