"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import { usePeople } from "../../hooks/use-people";
import { SlidePanel } from "../shared/slide-panel";
import { StatusBadge } from "../shared/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

type QueueEntry = {
  approverId: string;
  approverName: string;
  approverStatus: string | null;
  isOrphaned: boolean;
  pendingExpensesManagerStage: number;
  pendingExpensesAdditionalStage: number;
  pendingExpenseIdsAdditionalStage: string[];
  pendingLeaveRequests: number;
};

type ToastVariant = "success" | "error";

type ToastMessage = {
  id: string;
  variant: ToastVariant;
  message: string;
};

/** The reassign API caps an explicit expenseIds subset at 200 entries. */
const REASSIGN_EXPENSE_IDS_LIMIT = 200;

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ApprovalQueuesSection() {
  const t = useTranslations("delegations");

  // ── State ──────────────────────────────────────────────────────────────

  const [queues, setQueues] = useState<QueueEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isForbidden, setIsForbidden] = useState(false);

  // Reassign panel
  const [reassignTarget, setReassignTarget] = useState<QueueEntry | null>(null);
  const [destinationId, setDestinationId] = useState("");
  const [isReassigning, setIsReassigning] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);

  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // People list for the destination dropdown (full-list default)
  const { people } = usePeople();

  // ── Data fetching ─────────────────────────────────────────────────────

  const fetchQueues = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/v1/approvals/queues");
      const json = await response.json();

      if (response.status === 403) {
        // Section is HR Admin / Super Admin only — hide it for everyone else.
        setIsForbidden(true);
        return;
      }

      if (!response.ok) {
        setErrorMessage(json?.error?.message ?? t("queues.errorLoading"));
        return;
      }

      setQueues(json.data.queues);
    } catch {
      setErrorMessage(t("queues.errorLoading"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchQueues();
  }, [fetchQueues]);

  // ── Toasts ────────────────────────────────────────────────────────────

  const dismissToast = (toastId: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== toastId));
  };

  const showToast = (variant: ToastVariant, message: string) => {
    const toastId = createToastId();
    setToasts((current) => [...current, { id: toastId, variant, message }]);

    window.setTimeout(() => {
      dismissToast(toastId);
    }, 4000);
  };

  // ── Reassign handlers ─────────────────────────────────────────────────

  const handleOpenReassign = (queue: QueueEntry) => {
    setReassignTarget(queue);
    setDestinationId("");
    setReassignError(null);
  };

  const handleCloseReassign = () => {
    setReassignTarget(null);
    setDestinationId("");
    setReassignError(null);
  };

  const destinationOptions = useMemo(
    () =>
      people
        .filter((p) => p.status === "active" && p.id !== reassignTarget?.approverId)
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [people, reassignTarget?.approverId]
  );

  const confirmReassign = async () => {
    if (!reassignTarget || !destinationId) return;
    setIsReassigning(true);
    setReassignError(null);

    try {
      const expenseIds = reassignTarget.pendingExpenseIdsAdditionalStage;

      const response = await fetch("/api/v1/approvals/reassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromApproverId: reassignTarget.approverId,
          toApproverId: destinationId,
          // Pin the action to the previewed items; past the API cap, fall
          // back to "everything assigned to this approver".
          ...(expenseIds.length > 0 && expenseIds.length <= REASSIGN_EXPENSE_IDS_LIMIT
            ? { expenseIds }
            : {})
        })
      });

      const json = await response.json();

      if (!response.ok) {
        setReassignError(json?.error?.message ?? t("queues.reassignFailed"));
        return;
      }

      const reassignedCount: number = json.data?.reassignedCount ?? 0;
      const skippedSelfApproval: number = json.data?.skippedSelfApproval ?? 0;

      showToast(
        "success",
        skippedSelfApproval > 0
          ? t("queues.reassignSuccessWithSkipped", {
              count: reassignedCount,
              skipped: skippedSelfApproval
            })
          : t("queues.reassignSuccess", { count: reassignedCount })
      );
      handleCloseReassign();
      void fetchQueues();
    } catch {
      setReassignError(t("queues.reassignFailed"));
    } finally {
      setIsReassigning(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────

  if (isForbidden) {
    return null;
  }

  return (
    <section className="approval-queues-section">
      <div className="approval-queues-header">
        <h2 className="section-title">{t("queues.title")}</h2>
        <p className="approval-queues-description">{t("queues.description")}</p>
      </div>

      {/* Error */}
      {errorMessage ? (
        <div className="delegations-error" role="alert">
          <p>{errorMessage}</p>
          <button
            type="button"
            className="button button-subtle"
            onClick={() => {
              setErrorMessage(null);
              void fetchQueues();
            }}
          >
            {t("retry")}
          </button>
        </div>
      ) : null}

      {/* Content */}
      {isLoading ? (
        <div className="delegations-loading">
          <div className="spinner" />
        </div>
      ) : queues.length === 0 ? (
        errorMessage ? null : (
          <p className="approval-queues-empty">{t("queues.empty")}</p>
        )
      ) : (
        <div className="delegation-table-wrapper">
          <table className="delegation-table" aria-label={t("queues.tableAriaLabel")}>
            <thead>
              <tr>
                <th>{t("queues.column.approver")}</th>
                <th>{t("queues.column.status")}</th>
                <th>{t("queues.column.expensesManagerStage")}</th>
                <th>{t("queues.column.expensesAdditionalStage")}</th>
                <th>{t("queues.column.leaveRequests")}</th>
                <th>{t("queues.column.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {queues.map((queue) => (
                <tr
                  key={queue.approverId}
                  className={queue.isOrphaned ? "approval-queue-row-orphaned" : undefined}
                >
                  <td>
                    <div className="delegation-person-cell">
                      <span className="delegation-person-name">{queue.approverName}</span>
                    </div>
                  </td>
                  <td>
                    {queue.isOrphaned ? (
                      <StatusBadge tone="warning">{t("queues.statusOrphaned")}</StatusBadge>
                    ) : (
                      <StatusBadge tone="success">{t("queues.statusActive")}</StatusBadge>
                    )}
                  </td>
                  <td className="approval-queue-count">{queue.pendingExpensesManagerStage}</td>
                  <td className="approval-queue-count">{queue.pendingExpensesAdditionalStage}</td>
                  <td className="approval-queue-count">{queue.pendingLeaveRequests}</td>
                  <td>
                    {queue.pendingExpensesAdditionalStage > 0 ? (
                      <div className="delegation-actions">
                        <button
                          type="button"
                          className="delegation-action-link"
                          onClick={() => handleOpenReassign(queue)}
                        >
                          {t("queues.reassign")}
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Manager-stage / leave queues are covered by delegations, not reassignment */}
      <p className="approval-queues-hint">{t("queues.delegationHint")}</p>

      {/* Reassign panel */}
      <SlidePanel
        isOpen={reassignTarget !== null}
        title={t("queues.reassignTitle")}
        description={t("queues.reassignDescription", {
          name: reassignTarget?.approverName ?? ""
        })}
        onClose={handleCloseReassign}
      >
        <div className="delegation-form">
          <div className="delegation-form-field">
            <span>{t("queues.field.destination")}</span>
            <p className="delegation-field-hint">{t("queues.field.destinationHint")}</p>
            <Select
              value={destinationId || "__none__"}
              onValueChange={(value) => setDestinationId(value === "__none__" ? "" : value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("field.selectPerson")}</SelectItem>
                {destinationOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.fullName}
                    {p.department ? ` · ${p.department}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="approval-reassign-summary">
            {t("queues.reassignSummary", {
              count: reassignTarget?.pendingExpensesAdditionalStage ?? 0
            })}
          </p>

          {reassignError ? (
            <div className="delegation-save-error" role="alert">
              {reassignError}
            </div>
          ) : null}

          <button
            type="button"
            className="button button-accent delegation-save-button"
            disabled={!destinationId || isReassigning}
            onClick={() => void confirmReassign()}
          >
            {isReassigning ? t("queues.reassigning") : t("queues.reassignConfirm")}
          </button>
        </div>
      </SlidePanel>

      {/* Toasts */}
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast-message toast-message-${toast.variant}`}>
            <span>{toast.message}</span>
            <button
              type="button"
              className="toast-dismiss"
              aria-label={t("queues.dismissNotification")}
              onClick={() => dismissToast(toast.id)}
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
          </div>
        ))}
      </div>
    </section>
  );
}
