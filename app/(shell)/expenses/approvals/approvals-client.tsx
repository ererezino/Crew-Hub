"use client";

import {
  type ChangeEvent,
  type FormEvent,
  useMemo,
  useState
} from "react";
import { z } from "zod";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { SlidePanel } from "../../../../components/shared/slide-panel";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { CurrencyDisplay } from "../../../../components/ui/currency-display";
import { useExpenseApprovals } from "../../../../hooks/use-expenses";
import { countryFlagFromCode, countryNameFromCode } from "../../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import {
  currentMonthKey,
  formatMonthLabel,
  getExpenseCategoryLabel,
  toneForExpenseStatus
} from "../../../../lib/expenses";
import type {
  ExpenseBulkApproveResponse,
  ExpenseReceiptSignedUrlResponse,
  ExpenseRecord,
  UpdateExpenseResponse
} from "../../../../types/expenses";

type SortDirection = "asc" | "desc";
type ToastVariant = "success" | "error" | "info";

type ToastMessage = {
  id: string;
  variant: ToastVariant;
  message: string;
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

function ApprovalSkeleton() {
  return (
    <section className="expenses-skeleton-layout" aria-hidden="true">
      <div className="expenses-metric-skeleton-grid">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={`expenses-approval-metric-skeleton-${index}`} className="expenses-metric-skeleton-card" />
        ))}
      </div>
      <div className="expenses-table-skeleton">
        <div className="expenses-table-skeleton-header" />
        {Array.from({ length: 7 }, (_, index) => (
          <div key={`expenses-approval-skeleton-${index}`} className="expenses-table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

export function ExpenseApprovalsClient() {
  const [month, setMonth] = useState(currentMonthKey());
  const approvalsQuery = useExpenseApprovals({ month });
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isMutatingId, setIsMutatingId] = useState<string | null>(null);
  const [isBulkApproving, setIsBulkApproving] = useState(false);
  const [isOpeningReceiptById, setIsOpeningReceiptById] = useState<Record<string, boolean>>({});
  const [rejectTarget, setRejectTarget] = useState<ExpenseRecord | null>(null);
  const [rejectValues, setRejectValues] = useState<RejectFormValues>({ rejectionReason: "" });
  const [rejectErrors, setRejectErrors] = useState<RejectFormErrors>({});
  const [isRejecting, setIsRejecting] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const expenses = useMemo(() => {
    const rows = approvalsQuery.data?.expenses ?? [];

    return [...rows].sort((leftExpense, rightExpense) => {
      const leftTime = Date.parse(leftExpense.expenseDate);
      const rightTime = Date.parse(rightExpense.expenseDate);
      return sortDirection === "asc" ? leftTime - rightTime : rightTime - leftTime;
    });
  }, [approvalsQuery.data?.expenses, sortDirection]);

  const allSelected = expenses.length > 0 && expenses.every((expense) => selectedIds.includes(expense.id));

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

  const toggleSelected = (expenseId: string) => {
    setSelectedIds((current) =>
      current.includes(expenseId)
        ? current.filter((id) => id !== expenseId)
        : [...current, expenseId]
    );
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([]);
      return;
    }

    setSelectedIds(expenses.map((expense) => expense.id));
  };

  const handleSingleApprove = async (expense: ExpenseRecord) => {
    setIsMutatingId(expense.id);

    try {
      const response = await fetch(`/api/v1/expenses/${expense.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "approve"
        })
      });

      const payload = (await response.json()) as UpdateExpenseResponse;

      if (!response.ok || !payload.data?.expense) {
        showToast("error", payload.error?.message ?? "Unable to approve expense.");
        return;
      }

      setSelectedIds((current) => current.filter((id) => id !== expense.id));
      approvalsQuery.refresh();
      showToast("success", "Expense approved.");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to approve expense.");
    } finally {
      setIsMutatingId(null);
    }
  };

  const handleBulkApprove = async () => {
    if (selectedIds.length === 0) {
      return;
    }

    setIsBulkApproving(true);

    try {
      const response = await fetch("/api/v1/expenses/approvals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          expenseIds: selectedIds
        })
      });

      const payload = (await response.json()) as ExpenseBulkApproveResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? "Unable to bulk approve expenses.");
        return;
      }

      setSelectedIds([]);
      approvalsQuery.refresh();
      showToast("success", `Approved ${payload.data.approvedCount} expenses.`);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to bulk approve expenses.");
    } finally {
      setIsBulkApproving(false);
    }
  };

  const openRejectPanel = (expense: ExpenseRecord) => {
    setRejectTarget(expense);
    setRejectValues({ rejectionReason: "" });
    setRejectErrors({});
  };

  const closeRejectPanel = () => {
    if (isRejecting) {
      return;
    }

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

    setRejectErrors(
      validation.success ? {} : { rejectionReason: validation.error.flatten().fieldErrors.rejectionReason?.[0] }
    );
  };

  const submitReject = async (event: FormEvent<HTMLFormElement>) => {
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
      const response = await fetch(`/api/v1/expenses/${rejectTarget.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "reject",
          rejectionReason: rejectValues.rejectionReason.trim()
        })
      });

      const payload = (await response.json()) as UpdateExpenseResponse;

      if (!response.ok || !payload.data?.expense) {
        showToast("error", payload.error?.message ?? "Unable to reject expense.");
        return;
      }

      closeRejectPanel();
      setSelectedIds((current) => current.filter((id) => id !== rejectTarget.id));
      approvalsQuery.refresh();
      showToast("info", "Expense rejected.");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to reject expense.");
    } finally {
      setIsRejecting(false);
    }
  };

  const openReceipt = async (expense: ExpenseRecord) => {
    setIsOpeningReceiptById((current) => ({
      ...current,
      [expense.id]: true
    }));

    try {
      const response = await fetch(`/api/v1/expenses/${expense.id}/receipt`, {
        method: "GET"
      });

      const payload = (await response.json()) as ExpenseReceiptSignedUrlResponse;

      if (!response.ok || !payload.data?.url) {
        showToast("error", payload.error?.message ?? "Unable to open receipt.");
        return;
      }

      window.open(payload.data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to open receipt.");
    } finally {
      setIsOpeningReceiptById((current) => {
        const next = { ...current };
        delete next[expense.id];
        return next;
      });
    }
  };

  return (
    <>
      <PageHeader
        title="Expense Approvals"
        description="Review pending expense requests, approve or reject submissions, and process batches."
        actions={
          <button
            type="button"
            className="button button-accent"
            onClick={handleBulkApprove}
            disabled={selectedIds.length === 0 || isBulkApproving}
          >
            {isBulkApproving ? "Approving..." : `Bulk approve (${selectedIds.length})`}
          </button>
        }
      />

      <section className="expenses-toolbar" aria-label="Approvals filters">
        <label className="form-field">
          <span className="form-label">Month</span>
          <input
            className="form-input numeric"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.currentTarget.value)}
          />
        </label>
        <p className="settings-card-description">Showing {formatMonthLabel(month)} pending expenses.</p>
      </section>

      {approvalsQuery.isLoading ? <ApprovalSkeleton /> : null}

      {!approvalsQuery.isLoading && approvalsQuery.errorMessage ? (
        <section className="expenses-error-state">
          <EmptyState
            title="Expense approvals are unavailable"
            description={approvalsQuery.errorMessage}
            ctaLabel="Retry"
            ctaHref="/expenses/approvals"
          />
          <button type="button" className="button button-accent" onClick={() => approvalsQuery.refresh()}>
            Retry
          </button>
        </section>
      ) : null}

      {!approvalsQuery.isLoading && !approvalsQuery.errorMessage && approvalsQuery.data ? (
        <>
          <section className="expenses-metric-grid" aria-label="Pending approvals summary">
            <article className="metric-card">
              <p className="metric-label">Pending Count</p>
              <p className="metric-value numeric">{approvalsQuery.data.pendingCount}</p>
              <p className="metric-hint">Awaiting manager or admin review</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Pending Amount</p>
              <p className="metric-value">
                <CurrencyDisplay amount={approvalsQuery.data.pendingAmount} currency="USD" />
              </p>
              <p className="metric-hint">Total amount currently in approval queue</p>
            </article>
          </section>

          {expenses.length === 0 ? (
            <EmptyState
              title="No pending expenses"
              description="All current expense submissions have been processed."
              ctaLabel="Open expenses"
              ctaHref="/expenses"
            />
          ) : (
            <section className="data-table-container" aria-label="Pending expenses approvals table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>
                      <label className="expenses-checkbox">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleSelectAll}
                          aria-label="Select all pending expenses"
                        />
                      </label>
                    </th>
                    <th>Employee</th>
                    <th>Category</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Country</th>
                    <th>
                      <button
                        type="button"
                        className="table-sort-trigger"
                        onClick={() =>
                          setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
                        }
                      >
                        Expense date
                        <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      </button>
                    </th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th className="table-action-column">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((expense) => (
                    <tr key={expense.id} className="data-table-row">
                      <td>
                        <label className="expenses-checkbox">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(expense.id)}
                            onChange={() => toggleSelected(expense.id)}
                            aria-label={`Select expense from ${expense.employeeName}`}
                          />
                        </label>
                      </td>
                      <td>
                        <div className="documents-cell-copy">
                          <p className="documents-cell-title">{expense.employeeName}</p>
                          <p className="documents-cell-description">
                            {expense.employeeDepartment ?? "No department"}
                          </p>
                        </div>
                      </td>
                      <td>{getExpenseCategoryLabel(expense.category)}</td>
                      <td>
                        <p className="expenses-description">{expense.description}</p>
                      </td>
                      <td>
                        <CurrencyDisplay amount={expense.amount} currency={expense.currency} />
                      </td>
                      <td>
                        <span className="country-chip">
                          <span>{countryFlagFromCode(expense.employeeCountryCode)}</span>
                          <span>{countryNameFromCode(expense.employeeCountryCode)}</span>
                        </span>
                      </td>
                      <td>
                        <time
                          dateTime={expense.expenseDate}
                          title={formatDateTimeTooltip(expense.expenseDate)}
                        >
                          {expense.expenseDate}
                        </time>
                      </td>
                      <td>
                        <StatusBadge tone={toneForExpenseStatus(expense.status)}>
                          {expense.status}
                        </StatusBadge>
                      </td>
                      <td>
                        <time
                          dateTime={expense.createdAt}
                          title={formatDateTimeTooltip(expense.createdAt)}
                        >
                          {formatRelativeTime(expense.createdAt)}
                        </time>
                      </td>
                      <td className="table-row-action-cell">
                        <div className="expenses-approval-row-actions">
                          <button
                            type="button"
                            className="table-row-action"
                            onClick={() => openReceipt(expense)}
                            disabled={Boolean(isOpeningReceiptById[expense.id])}
                          >
                            {isOpeningReceiptById[expense.id] ? "Opening..." : "Receipt"}
                          </button>
                          <button
                            type="button"
                            className="table-row-action"
                            onClick={() => handleSingleApprove(expense)}
                            disabled={isMutatingId === expense.id}
                          >
                            {isMutatingId === expense.id ? "Saving..." : "Approve"}
                          </button>
                          <button
                            type="button"
                            className="table-row-action"
                            onClick={() => openRejectPanel(expense)}
                            disabled={isMutatingId === expense.id}
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      ) : null}

      <SlidePanel
        isOpen={Boolean(rejectTarget)}
        title="Reject expense"
        description={rejectTarget ? `Provide a reason for rejecting ${rejectTarget.employeeName}'s expense.` : undefined}
        onClose={closeRejectPanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={submitReject}>
          <label className="form-field">
            <span className="form-label">Rejection reason</span>
            <textarea
              className={rejectErrors.rejectionReason ? "form-input form-input-error" : "form-input"}
              rows={4}
              value={rejectValues.rejectionReason}
              onChange={handleRejectReasonChange}
              placeholder="Explain why this expense cannot be approved."
              disabled={isRejecting}
            />
            {rejectErrors.rejectionReason ? (
              <p className="form-field-error">{rejectErrors.rejectionReason}</p>
            ) : null}
          </label>
          <div className="slide-panel-actions">
            <button type="button" className="button" onClick={closeRejectPanel} disabled={isRejecting}>
              Cancel
            </button>
            <button type="submit" className="button button-accent" disabled={isRejecting}>
              {isRejecting ? "Submitting..." : "Submit rejection"}
            </button>
          </div>
        </form>
      </SlidePanel>

      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast-message toast-message-${toast.variant}`}>
            <span>{toast.message}</span>
            <button
              type="button"
              className="toast-dismiss"
              aria-label="Dismiss notification"
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
    </>
  );
}
