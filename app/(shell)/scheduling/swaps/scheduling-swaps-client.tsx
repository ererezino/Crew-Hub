"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { ConfirmDialog } from "../../../../components/shared/confirm-dialog";
import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { usePeople } from "../../../../hooks/use-people";
import { useSchedulingShifts, useSchedulingSwaps } from "../../../../hooks/use-scheduling";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import { formatSwapStatus } from "../../../../lib/format-labels";
import { formatTimeRangeLabel } from "../../../../lib/scheduling";

type SortDirection = "asc" | "desc";

type SwapAction = "accept" | "reject" | "cancel" | "approve";

type SwapRequestFormState = {
  shiftId: string;
  reason: string;
};

function swapsSkeleton() {
  return (
    <div className="table-skeleton" aria-hidden="true">
      <div className="table-skeleton-header" />
      {Array.from({ length: 6 }, (_, index) => (
        <div key={`swap-skeleton-${index}`} className="table-skeleton-row" />
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
  canManageSwaps,
  embedded = false
}: {
  currentUserId: string;
  canManageSwaps: boolean;
  embedded?: boolean;
}) {
  const t = useTranslations("scheduling");
  const tc = useTranslations("common");
  const swapsQuery = useSchedulingSwaps({
    scope: canManageSwaps ? "team" : "mine"
  });
  const shiftsQuery = useSchedulingShifts({
    scope: "mine"
  });
  const reportsQuery = usePeople({
    scope: "reports",
    enabled: canManageSwaps
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
  const [confirmAction, setConfirmAction] = useState<{ swapId: string; action: SwapAction } | null>(null);
  const [assignSwapId, setAssignSwapId] = useState<string | null>(null);
  const [assignTargetId, setAssignTargetId] = useState("");
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignLeaveWarning, setAssignLeaveWarning] = useState<string | null>(null);

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

  const assignSwap = useMemo(
    () => sortedSwaps.find((swap) => swap.id === assignSwapId) ?? null,
    [assignSwapId, sortedSwaps]
  );

  const assignCandidates = useMemo(() => {
    if (!assignSwap) {
      return [];
    }

    return reportsQuery.people.filter((person) => {
      if (person.id === assignSwap.requesterId) {
        return false;
      }

      return person.status === "active" || person.status === "onboarding";
    });
  }, [assignSwap, reportsQuery.people]);

  async function handleCreateSwapRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestError(null);
    setFeedbackMessage(null);

    if (!requestForm.shiftId) {
      setRequestError(t("swaps.validationSelectShift"));
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
        error: { code?: string; message?: string } | null;
      };

      if (!response.ok) {
        setRequestError(payload.error?.message ?? t("swaps.failedCreate"));
        return;
      }

      setRequestForm({
        shiftId: "",
        reason: ""
      });
      setFeedbackMessage(t("swaps.submitted"));
      swapsQuery.refresh();
      shiftsQuery.refresh();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : t("swaps.failedCreate"));
    } finally {
      setIsSubmittingRequest(false);
    }
  }

  async function handleSwapAction(
    swapId: string,
    action: SwapAction,
    options?: { targetId?: string; allowLeaveConflict?: boolean }
  ): Promise<void> {
    setIsUpdatingSwapId(swapId);
    setFeedbackMessage(null);
    setAssignError(null);

    try {
      const response = await fetch(`/api/v1/scheduling/swaps/${swapId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action,
          targetId: options?.targetId,
          allowLeaveConflict: options?.allowLeaveConflict === true
        })
      });
      const payload = (await response.json()) as {
        data: unknown;
        error: { code?: string; message?: string } | null;
      };

      if (!response.ok) {
        if (
          payload.error?.code === "SHIFT_SWAP_TARGET_ON_LEAVE" &&
          options?.targetId &&
          options?.allowLeaveConflict !== true
        ) {
          setAssignLeaveWarning(
            payload.error.message ??
              t("swaps.leaveConflictWarning")
          );
          return;
        }

        if (assignSwapId && assignSwapId === swapId) {
          setAssignError(payload.error?.message ?? t("swaps.failedUpdate"));
        } else {
          setFeedbackMessage(payload.error?.message ?? t("swaps.failedUpdate"));
        }
        return;
      }

      setFeedbackMessage(t("swaps.updated"));
      setAssignSwapId(null);
      setAssignTargetId("");
      setAssignError(null);
      setAssignLeaveWarning(null);
      swapsQuery.refresh();
      shiftsQuery.refresh();
    } catch (error) {
      if (assignSwapId && assignSwapId === swapId) {
        setAssignError(error instanceof Error ? error.message : t("swaps.failedUpdate"));
      } else {
        setFeedbackMessage(error instanceof Error ? error.message : t("swaps.failedUpdate"));
      }
    } finally {
      setIsUpdatingSwapId(null);
    }
  }

  const closeAssignDialog = () => {
    if (isUpdatingSwapId) {
      return;
    }

    setAssignSwapId(null);
    setAssignTargetId("");
    setAssignError(null);
    setAssignLeaveWarning(null);
  };

  const submitAssignApproval = async (allowLeaveConflict: boolean) => {
    if (!assignSwap) {
      return;
    }

    if (!assignTargetId) {
      setAssignError(t("swaps.validationSelectMember"));
      return;
    }

    await handleSwapAction(assignSwap.id, "approve", {
      targetId: assignTargetId,
      allowLeaveConflict
    });
  };

  return (
    <>
      {!embedded ? (
        <PageHeader
          title={t("swaps.pageTitle")}
          description={t("swaps.pageDescription")}
        />
      ) : null}

      {(swapsQuery.isLoading || shiftsQuery.isLoading) ? swapsSkeleton() : null}

      {!swapsQuery.isLoading && swapsQuery.errorMessage ? (
        <>
          <EmptyState
            title={t("swaps.errorTitle")}
            description={swapsQuery.errorMessage}
          />
          <button
            type="button"
            className="button"
            onClick={() => swapsQuery.refresh()}
          >
            {tc("retry")}
          </button>
        </>
      ) : null}

      {!swapsQuery.isLoading && !swapsQuery.errorMessage ? (
        <section className="compensation-layout" aria-label={t("swaps.ariaSection")}>
          <article className="settings-card">
            <header className="announcement-item-header">
              <div>
                <h2 className="section-title">{t("swaps.requestTitle")}</h2>
                <p className="settings-card-description">
                  {t("swaps.requestDescription")}
                </p>
              </div>
            </header>
            <form className="settings-form" onSubmit={handleCreateSwapRequest}>
              <div>
                <label className="form-label" htmlFor="swap-shift-select">{t("swaps.myShift")}</label>
                <select
                  id="swap-shift-select"
                  className="form-input"
                  value={requestForm.shiftId}
                  onChange={(event) =>
                    setRequestForm((currentValue) => ({
                      ...currentValue,
                      shiftId: event.target.value
                    }))
                  }
                >
                  <option value="">{t("swaps.selectShift")}</option>
                  {swappableShifts.map((shift) => (
                    <option key={shift.id} value={shift.id}>
                      {shift.shiftDate} {formatTimeRangeLabel(shift.startTime, shift.endTime)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label" htmlFor="swap-reason">{t("swaps.reason")}</label>
                <textarea
                  id="swap-reason"
                  className="form-input"
                  value={requestForm.reason}
                  onChange={(event) =>
                    setRequestForm((currentValue) => ({
                      ...currentValue,
                      reason: event.target.value
                    }))
                  }
                  rows={3}
                  placeholder={t("swaps.reasonPlaceholder")}
                />
              </div>
              {requestError ? <p className="form-field-error">{requestError}</p> : null}
              <div className="settings-actions">
                <button type="submit" className="button button-primary" disabled={isSubmittingRequest}>
                  {isSubmittingRequest ? tc("submitting") : t("swaps.submit")}
                </button>
              </div>
            </form>
          </article>

          {feedbackMessage ? <p className="settings-card-description">{feedbackMessage}</p> : null}

          {sortedSwaps.length === 0 ? (
            <EmptyState
              title={t("swaps.emptyTitle")}
              description={t("swaps.emptyDescription")}
              ctaLabel={t("openShifts.openScheduling")}
              ctaHref="/scheduling"
            />
          ) : (
            <div className="data-table-container">
              <table className="data-table" aria-label={t("swaps.ariaTable")}>
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
                        {t("swaps.colRequested")}
                        <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      </button>
                    </th>
                    <th>{t("swaps.colShift")}</th>
                    <th>{t("swaps.colRequester")}</th>
                    <th>{t("swaps.colTarget")}</th>
                    <th>{t("swaps.colReason")}</th>
                    <th>{t("swaps.colStatus")}</th>
                    <th>{t("swaps.colApprovedBy")}</th>
                    <th className="table-action-column">{t("swaps.colActions")}</th>
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
                    const canManagerAssignAndApprove =
                      canManageSwaps &&
                      swap.targetId === null &&
                      (swap.status === "accepted" || swap.status === "pending");
                    const canManagerReject =
                      canManageSwaps && (swap.status === "pending" || swap.status === "accepted");

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
                        <td>{swap.targetName ?? t("swaps.openToTeam")}</td>
                        <td title={swap.reason ?? undefined}>
                          {swap.reason
                            ? (swap.reason.length > 40
                                ? `${swap.reason.slice(0, 40)}...`
                                : swap.reason)
                            : "--"}
                        </td>
                        <td>
                          <StatusBadge tone={toneForSwapStatus(swap.status)}>
                            {formatSwapStatus(swap.status)}
                          </StatusBadge>
                        </td>
                        <td>{swap.approvedByName ?? "--"}</td>
                        <td className="table-row-action-cell">
                          <div className="timeatt-row-actions">
                            {canCancel ? (
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => setConfirmAction({ swapId: swap.id, action: "cancel" })}
                                disabled={isUpdatingSwapId === swap.id}
                              >
                                {tc("cancel")}
                              </button>
                            ) : null}
                            {canTargetRespond ? (
                              <>
                                <button
                                  type="button"
                                  className="table-row-action"
                                  onClick={() => {
                                    void handleSwapAction(swap.id, "accept");
                                  }}
                                  disabled={isUpdatingSwapId === swap.id}
                                >
                                  {tc("accept")}
                                </button>
                                <button
                                  type="button"
                                  className="table-row-action"
                                  onClick={() => setConfirmAction({ swapId: swap.id, action: "reject" })}
                                  disabled={isUpdatingSwapId === swap.id}
                                >
                                  {tc("reject")}
                                </button>
                              </>
                            ) : null}
                            {canManagerAssignAndApprove ? (
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => {
                                  setAssignSwapId(swap.id);
                                  setAssignTargetId("");
                                  setAssignError(null);
                                  setAssignLeaveWarning(null);
                                }}
                                disabled={isUpdatingSwapId === swap.id}
                              >
                                {t("swaps.assignApprove")}
                              </button>
                            ) : null}
                            {canManagerApprove ? (
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => {
                                  void handleSwapAction(swap.id, "approve");
                                }}
                                disabled={isUpdatingSwapId === swap.id}
                              >
                                {tc("approve")}
                              </button>
                            ) : null}
                            {canManagerReject ? (
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => setConfirmAction({ swapId: swap.id, action: "reject" })}
                                disabled={isUpdatingSwapId === swap.id}
                              >
                                {tc("reject")}
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

      {assignSwap ? (
        <div
          className="modal-overlay"
          onClick={() => {
            closeAssignDialog();
          }}
        >
          <section
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("swaps.assignTitle")}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="modal-title">{t("swaps.assignTitle")}</h2>
            <p className="settings-card-description" style={{ marginBottom: "var(--space-3)" }}>
              {t("swaps.assignDescription", { requesterName: assignSwap.requesterName, shiftDate: assignSwap.shiftDate })}
            </p>

            <label className="form-field">
              <span className="form-label">{t("swaps.replacementLabel")}</span>
              <select
                className="form-input"
                value={assignTargetId}
                onChange={(event) => {
                  setAssignTargetId(event.currentTarget.value);
                  setAssignError(null);
                  setAssignLeaveWarning(null);
                }}
                disabled={reportsQuery.isLoading || isUpdatingSwapId === assignSwap.id}
              >
                <option value="">
                  {reportsQuery.isLoading ? t("swaps.loadingMembers") : t("swaps.selectReplacement")}
                </option>
                {assignCandidates.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName}
                  </option>
                ))}
              </select>
            </label>

            {assignLeaveWarning ? (
              <div className="settings-card" style={{ borderColor: "var(--color-error-strong)" }}>
                <p className="form-field-error" style={{ marginBottom: "var(--space-2)" }}>
                  {assignLeaveWarning}
                </p>
                <p className="settings-card-description" dangerouslySetInnerHTML={{ __html: t("swaps.leaveConflictBody") }} />
              </div>
            ) : null}

            {assignError ? <p className="form-field-error">{assignError}</p> : null}

            <div className="modal-actions">
              <button
                type="button"
                className="button button-subtle"
                onClick={closeAssignDialog}
                disabled={isUpdatingSwapId === assignSwap.id}
              >
                {tc("cancel")}
              </button>
              {assignLeaveWarning ? (
                <>
                  <button
                    type="button"
                    className="button button-accent"
                    onClick={closeAssignDialog}
                    disabled={isUpdatingSwapId === assignSwap.id}
                  >
                    {t("swaps.no")}
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      void submitAssignApproval(true);
                    }}
                    disabled={isUpdatingSwapId === assignSwap.id}
                  >
                    {t("swaps.yesProceed")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="button button-accent"
                  onClick={() => {
                    void submitAssignApproval(false);
                  }}
                  disabled={isUpdatingSwapId === assignSwap.id}
                >
                  {isUpdatingSwapId === assignSwap.id ? tc("saving") : t("swaps.assignApprove")}
                </button>
              )}
            </div>
          </section>
        </div>
      ) : null}

      <ConfirmDialog
        isOpen={confirmAction !== null}
        title={
          confirmAction?.action === "cancel"
            ? t("swaps.confirmCancelTitle")
            : t("swaps.confirmRejectTitle")
        }
        description={
          confirmAction?.action === "cancel"
            ? t("swaps.confirmCancelBody")
            : t("swaps.confirmRejectBody")
        }
        confirmLabel={confirmAction?.action === "cancel" ? t("swaps.cancelRequest") : tc("reject")}
        tone="danger"
        isConfirming={isUpdatingSwapId !== null}
        onConfirm={() => {
          if (confirmAction) {
            void handleSwapAction(confirmAction.swapId, confirmAction.action);
            setConfirmAction(null);
          }
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </>
  );
}
