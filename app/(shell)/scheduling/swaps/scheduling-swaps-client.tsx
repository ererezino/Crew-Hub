"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useSchedulingShifts, useSchedulingSwaps } from "../../../../hooks/use-scheduling";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import { formatTimeRangeLabel } from "../../../../lib/scheduling";

type SortDirection = "asc" | "desc";

type SwapAction = "accept" | "reject" | "cancel" | "approve";

type SwapRequestFormState = {
  shiftId: string;
  reason: string;
};

function swapsSkeleton() {
  return (
    <div className="timeoff-table-skeleton" aria-hidden="true">
      <div className="timeoff-table-skeleton-header" />
      {Array.from({ length: 6 }, (_, index) => (
        <div key={`swap-skeleton-${index}`} className="timeoff-table-skeleton-row" />
      ))}
    </div>
  );
}

function toneForSwapStatus(status: "pending" | "accepted" | "rejected" | "cancelled") {
  switch (status) {
    case "pending":
      return "pending" as const;
    case "accepted":
      return "success" as const;
    case "rejected":
      return "error" as const;
    case "cancelled":
      return "draft" as const;
    default:
      return "draft" as const;
  }
}

export function SchedulingSwapsClient({
  currentUserId,
  canManageSwaps
}: {
  currentUserId: string;
  canManageSwaps: boolean;
}) {
  const swapsQuery = useSchedulingSwaps({
    scope: canManageSwaps ? "team" : "mine"
  });
  const shiftsQuery = useSchedulingShifts({
    scope: "mine"
  });
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [requestForm, setRequestForm] = useState<SwapRequestFormState>({
    shiftId: "",
    reason: ""
  });
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [isUpdatingSwapId, setIsUpdatingSwapId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const sortedSwaps = useMemo(() => {
    const rows = swapsQuery.data?.swaps ?? [];

    return [...rows].sort((leftSwap, rightSwap) => {
      const leftValue = new Date(leftSwap.createdAt).getTime();
      const rightValue = new Date(rightSwap.createdAt).getTime();

      return sortDirection === "asc" ? leftValue - rightValue : rightValue - leftValue;
    });
  }, [sortDirection, swapsQuery.data?.swaps]);

  const swappableShifts = useMemo(() => {
    const rows = shiftsQuery.data?.shifts ?? [];
    const now = Date.now();

    return rows.filter((shift) => new Date(shift.endTime).getTime() >= now);
  }, [shiftsQuery.data?.shifts]);

  async function handleCreateSwapRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestError(null);
    setFeedbackMessage(null);

    if (!requestForm.shiftId) {
      setRequestError("Select a shift to request a swap.");
      return;
    }

    setIsSubmittingRequest(true);

    try {
      const response = await fetch("/api/v1/scheduling/swaps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          shiftId: requestForm.shiftId,
          reason: requestForm.reason || undefined
        })
      });
      const payload = (await response.json()) as {
        data: unknown;
        error: { message?: string } | null;
      };

      if (!response.ok) {
        setRequestError(payload.error?.message ?? "Unable to create swap request.");
        return;
      }

      setRequestForm({
        shiftId: "",
        reason: ""
      });
      setFeedbackMessage("Swap request submitted.");
      swapsQuery.refresh();
      shiftsQuery.refresh();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Unable to create swap request.");
    } finally {
      setIsSubmittingRequest(false);
    }
  }

  async function handleSwapAction(swapId: string, action: SwapAction) {
    setIsUpdatingSwapId(swapId);
    setFeedbackMessage(null);

    try {
      const response = await fetch(`/api/v1/scheduling/swaps/${swapId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action
        })
      });
      const payload = (await response.json()) as {
        data: unknown;
        error: { message?: string } | null;
      };

      if (!response.ok) {
        setFeedbackMessage(payload.error?.message ?? "Unable to update swap request.");
        return;
      }

      setFeedbackMessage("Swap request updated.");
      swapsQuery.refresh();
      shiftsQuery.refresh();
    } catch (error) {
      setFeedbackMessage(error instanceof Error ? error.message : "Unable to update swap request.");
    } finally {
      setIsUpdatingSwapId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Shift Swaps"
        description="Request, review, and resolve shift swap requests."
      />

      {(swapsQuery.isLoading || shiftsQuery.isLoading) ? swapsSkeleton() : null}

      {!swapsQuery.isLoading && swapsQuery.errorMessage ? (
        <section className="compensation-error-state">
          <EmptyState
            title="Shift swaps are unavailable"
            description={swapsQuery.errorMessage}
            ctaLabel="Back to dashboard"
            ctaHref="/dashboard"
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => swapsQuery.refresh()}
          >
            Retry
          </button>
        </section>
      ) : null}

      {!swapsQuery.isLoading && !swapsQuery.errorMessage ? (
        <section className="compensation-layout" aria-label="Shift swap management">
          <article className="settings-card">
            <header className="announcement-item-header">
              <div>
                <h2 className="section-title">Request a swap</h2>
                <p className="settings-card-description">
                  Select one of your upcoming shifts and optionally add context.
                </p>
              </div>
            </header>
            <form className="settings-form-grid" onSubmit={handleCreateSwapRequest}>
              <label className="settings-field">
                <span className="settings-field-label">My shift</span>
                <select
                  className="settings-input"
                  value={requestForm.shiftId}
                  onChange={(event) =>
                    setRequestForm((currentValue) => ({
                      ...currentValue,
                      shiftId: event.target.value
                    }))
                  }
                >
                  <option value="">Select shift</option>
                  {swappableShifts.map((shift) => (
                    <option key={shift.id} value={shift.id}>
                      {shift.shiftDate} {formatTimeRangeLabel(shift.startTime, shift.endTime)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-field">
                <span className="settings-field-label">Reason</span>
                <textarea
                  className="settings-input"
                  value={requestForm.reason}
                  onChange={(event) =>
                    setRequestForm((currentValue) => ({
                      ...currentValue,
                      reason: event.target.value
                    }))
                  }
                  rows={3}
                  placeholder="Need coverage for a client meeting."
                />
              </label>
              {requestError ? <p className="form-field-error">{requestError}</p> : null}
              <div className="settings-actions">
                <button type="submit" className="button button-accent" disabled={isSubmittingRequest}>
                  {isSubmittingRequest ? "Submitting..." : "Request swap"}
                </button>
              </div>
            </form>
          </article>

          {feedbackMessage ? <p className="settings-card-description">{feedbackMessage}</p> : null}

          {sortedSwaps.length === 0 ? (
            <EmptyState
              title="No swap requests yet"
              description="Your submitted and received swap requests will appear here."
              ctaLabel="Open Scheduling"
              ctaHref="/scheduling"
            />
          ) : (
            <div className="data-table-container">
              <table className="data-table" aria-label="Shift swaps table">
                <thead>
                  <tr>
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
                        Requested
                        <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      </button>
                    </th>
                    <th>Shift</th>
                    <th>Requester</th>
                    <th>Target</th>
                    <th>Status</th>
                    <th>Approved by</th>
                    <th className="table-action-column">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSwaps.map((swap) => {
                    const canCancel = swap.status === "pending" && swap.requesterId === currentUserId;
                    const canTargetRespond =
                      swap.status === "pending" && swap.targetId === currentUserId;
                    const canManagerApprove =
                      canManageSwaps &&
                      swap.targetId !== null &&
                      (swap.status === "accepted" || swap.status === "pending");
                    const canManagerReject = canManageSwaps && swap.status === "pending";

                    return (
                      <tr key={swap.id} className="data-table-row">
                        <td>
                          <span title={formatDateTimeTooltip(swap.createdAt)}>
                            {formatRelativeTime(swap.createdAt)}
                          </span>
                        </td>
                        <td className="numeric">
                          {swap.shiftDate} {formatTimeRangeLabel(swap.shiftStartTime, swap.shiftEndTime)}
                        </td>
                        <td>{swap.requesterName}</td>
                        <td>{swap.targetName ?? "Open to team"}</td>
                        <td>
                          <StatusBadge tone={toneForSwapStatus(swap.status)}>
                            {swap.status}
                          </StatusBadge>
                        </td>
                        <td>{swap.approvedByName ?? "--"}</td>
                        <td className="table-row-action-cell">
                          <div className="timeatt-row-actions">
                            {canCancel ? (
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => handleSwapAction(swap.id, "cancel")}
                                disabled={isUpdatingSwapId === swap.id}
                              >
                                Cancel
                              </button>
                            ) : null}
                            {canTargetRespond ? (
                              <>
                                <button
                                  type="button"
                                  className="table-row-action"
                                  onClick={() => handleSwapAction(swap.id, "accept")}
                                  disabled={isUpdatingSwapId === swap.id}
                                >
                                  Accept
                                </button>
                                <button
                                  type="button"
                                  className="table-row-action"
                                  onClick={() => handleSwapAction(swap.id, "reject")}
                                  disabled={isUpdatingSwapId === swap.id}
                                >
                                  Reject
                                </button>
                              </>
                            ) : null}
                            {canManagerApprove ? (
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => handleSwapAction(swap.id, "approve")}
                                disabled={isUpdatingSwapId === swap.id}
                              >
                                Approve
                              </button>
                            ) : null}
                            {canManagerReject ? (
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => handleSwapAction(swap.id, "reject")}
                                disabled={isUpdatingSwapId === swap.id}
                              >
                                Reject
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
