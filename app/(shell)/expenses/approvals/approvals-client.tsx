"use client";

import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
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
  getExpenseStatusLabel,
  toneForExpenseStatus
} from "../../../../lib/expenses";
import type {
  ExpenseApprovalStage,
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

type RejectMode = "manager" | "finance";

type RejectFormValues = {
  reason: string;
};

type RejectFormErrors = {
  reason?: string;
};

type DisburseFormValues = {
  reimbursementReference: string;
  reimbursementNotes: string;
};

type DisburseFormErrors = {
  reimbursementReference?: string;
};

const rejectSchema = z.object({
  reason: z.string().trim().min(1, "Rejection reason is required").max(2000, "Reason is too long")
});

const disburseSchema = z.object({
  reimbursementReference: z
    .string()
    .trim()
    .min(1, "Reimbursement reference is required")
    .max(120, "Reference is too long"),
  reimbursementNotes: z.string().trim().max(2000, "Notes are too long")
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

export function ExpenseApprovalsClient({
  canManagerApprove,
  canFinanceApprove
}: {
  canManagerApprove: boolean;
  canFinanceApprove: boolean;
}) {
  const availableStages = useMemo<ExpenseApprovalStage[]>(() => {
    const stages: ExpenseApprovalStage[] = [];

    if (canManagerApprove) {
      stages.push("manager");
    }

    if (canFinanceApprove) {
      stages.push("finance");
    }

    return stages;
  }, [canFinanceApprove, canManagerApprove]);
  const [month, setMonth] = useState(currentMonthKey());
  const [stage, setStage] = useState<ExpenseApprovalStage>(availableStages[0] ?? "manager");
  const approvalsQuery = useExpenseApprovals({ month, stage });
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isMutatingId, setIsMutatingId] = useState<string | null>(null);
  const [isBulkApproving, setIsBulkApproving] = useState(false);
  const [isOpeningReceiptById, setIsOpeningReceiptById] = useState<Record<string, boolean>>({});
  const [rejectTarget, setRejectTarget] = useState<ExpenseRecord | null>(null);
  const [rejectMode, setRejectMode] = useState<RejectMode>("manager");
  const [rejectValues, setRejectValues] = useState<RejectFormValues>({ reason: "" });
  const [rejectErrors, setRejectErrors] = useState<RejectFormErrors>({});
  const [isRejecting, setIsRejecting] = useState(false);
  const [disburseTarget, setDisburseTarget] = useState<ExpenseRecord | null>(null);
  const [disburseValues, setDisburseValues] = useState<DisburseFormValues>({
    reimbursementReference: "",
    reimbursementNotes: ""
  });
  const [disburseErrors, setDisburseErrors] = useState<DisburseFormErrors>({});
  const [isDisbursing, setIsDisbursing] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const expenses = useMemo(() => {
    const rows = approvalsQuery.data?.expenses ?? [];

    return [...rows].sort((leftExpense, rightExpense) => {
      const leftTime = Date.parse(leftExpense.expenseDate);
      const rightTime = Date.parse(rightExpense.expenseDate);
      return sortDirection === "asc" ? leftTime - rightTime : rightTime - leftTime;
    });
  }, [approvalsQuery.data?.expenses, sortDirection]);

  useEffect(() => {
    if (!availableStages.includes(stage) && availableStages[0]) {
      setStage(availableStages[0]);
    }
  }, [availableStages, stage]);

  useEffect(() => {
    setSelectedIds([]);
  }, [month, stage]);

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

  const handleSingleManagerApprove = async (expense: ExpenseRecord) => {
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
      showToast("success", "Expense moved to finance disbursement.");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to approve expense.");
    } finally {
      setIsMutatingId(null);
    }
  };

  const openDisbursePanel = (expense: ExpenseRecord) => {
    const defaultReference = `EXP-${expense.expenseDate.replaceAll("-", "")}-${expense.id.slice(0, 8).toUpperCase()}`;

    setDisburseTarget(expense);
    setDisburseValues({
      reimbursementReference: defaultReference,
      reimbursementNotes: ""
    });
    setDisburseErrors({});
  };

  const closeDisbursePanel = () => {
    if (isDisbursing) {
      return;
    }

    setDisburseTarget(null);
    setDisburseValues({
      reimbursementReference: "",
      reimbursementNotes: ""
    });
    setDisburseErrors({});
  };

  const handleDisburseFieldChange =
    (field: keyof DisburseFormValues) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const nextValues = {
        ...disburseValues,
        [field]: event.currentTarget.value
      };

      setDisburseValues(nextValues);

      const validation = disburseSchema.safeParse(nextValues);
      setDisburseErrors(
        validation.success
          ? {}
          : {
              reimbursementReference: validation.error.flatten().fieldErrors.reimbursementReference?.[0]
            }
      );
    };

  const submitDisbursement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!disburseTarget) {
      return;
    }

    const validation = disburseSchema.safeParse(disburseValues);

    if (!validation.success) {
      setDisburseErrors({
        reimbursementReference: validation.error.flatten().fieldErrors.reimbursementReference?.[0]
      });
      return;
    }

    setIsDisbursing(true);
    setIsMutatingId(disburseTarget.id);

    try {
      const response = await fetch(`/api/v1/expenses/${disburseTarget.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "approve",
          reimbursementReference: disburseValues.reimbursementReference.trim(),
          reimbursementNotes: disburseValues.reimbursementNotes.trim() || undefined
        })
      });

      const payload = (await response.json()) as UpdateExpenseResponse;

      if (!response.ok || !payload.data?.expense) {
        showToast("error", payload.error?.message ?? "Unable to disburse expense.");
        return;
      }

      closeDisbursePanel();
      setSelectedIds((current) => current.filter((id) => id !== disburseTarget.id));
      approvalsQuery.refresh();
      showToast("success", "Expense disbursed.");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to disburse expense.");
    } finally {
      setIsDisbursing(false);
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
          expenseIds: selectedIds,
          stage
        })
      });

      const payload = (await response.json()) as ExpenseBulkApproveResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? "Unable to process selected expenses.");
        return;
      }

      setSelectedIds([]);
      approvalsQuery.refresh();
      showToast(
        "success",
        stage === "manager"
          ? `Moved ${payload.data.approvedCount} expenses to finance.`
          : `Disbursed ${payload.data.approvedCount} expenses.`
      );
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to process selected expenses.");
    } finally {
      setIsBulkApproving(false);
    }
  };

  const openRejectPanel = (expense: ExpenseRecord, mode: RejectMode) => {
    setRejectTarget(expense);
    setRejectMode(mode);
    setRejectValues({ reason: "" });
    setRejectErrors({});
  };

  const closeRejectPanel = () => {
    if (isRejecting) {
      return;
    }

    setRejectTarget(null);
    setRejectValues({ reason: "" });
    setRejectErrors({});
  };

  const handleRejectReasonChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValues = {
      reason: event.currentTarget.value
    };

    setRejectValues(nextValues);

    const validation = rejectSchema.safeParse(nextValues);

    setRejectErrors(
      validation.success ? {} : { reason: validation.error.flatten().fieldErrors.reason?.[0] }
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
        reason: validation.error.flatten().fieldErrors.reason?.[0]
      });
      return;
    }

    setIsRejecting(true);
    setIsMutatingId(rejectTarget.id);

    try {
      const response = await fetch(`/api/v1/expenses/${rejectTarget.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(
          rejectMode === "manager"
            ? {
                action: "reject",
                rejectionReason: rejectValues.reason.trim()
              }
            : {
                action: "reject",
                financeRejectionReason: rejectValues.reason.trim()
              }
        )
      });

      const payload = (await response.json()) as UpdateExpenseResponse;

      if (!response.ok || !payload.data?.expense) {
        showToast("error", payload.error?.message ?? "Unable to reject expense.");
        return;
      }

      closeRejectPanel();
      setSelectedIds((current) => current.filter((id) => id !== rejectTarget.id));
      approvalsQuery.refresh();
      showToast(
        rejectMode === "manager" ? "info" : "error",
        rejectMode === "manager" ? "Expense rejected." : "Expense finance-rejected."
      );
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to reject expense.");
    } finally {
      setIsRejecting(false);
      setIsMutatingId(null);
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

  const stageTitle = stage === "manager" ? "Pending My Approval" : "Pending Disbursement";
  const stageDescription =
    stage === "manager"
      ? "Expenses from your direct reports awaiting manager approval."
      : "Manager-approved expenses ready for finance disbursement.";

  return (
    <>
      <PageHeader
        title="Expense Approvals"
        description="Manager approval and finance disbursement queues."
        actions={
          <button
            type="button"
            className="button button-accent"
            onClick={handleBulkApprove}
            disabled={selectedIds.length === 0 || isBulkApproving}
          >
            {isBulkApproving
              ? stage === "manager"
                ? "Approving..."
                : "Disbursing..."
              : stage === "manager"
                ? `Bulk approve (${selectedIds.length})`
                : `Bulk disburse (${selectedIds.length})`}
          </button>
        }
      />

      {availableStages.length > 1 ? (
        <section className="expenses-approval-tabs" aria-label="Approval queues">
          <button
            type="button"
            className={stage === "manager" ? "settings-tab settings-tab-active" : "settings-tab"}
            onClick={() => setStage("manager")}
          >
            Pending My Approval
          </button>
          <button
            type="button"
            className={stage === "finance" ? "settings-tab settings-tab-active" : "settings-tab"}
            onClick={() => setStage("finance")}
          >
            Pending Disbursement
          </button>
        </section>
      ) : null}

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
        <p className="settings-card-description">
          {stageTitle}: {formatMonthLabel(month)}.
        </p>
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
              <p className="metric-label">{stage === "manager" ? "Pending Manager Approval" : "Pending Disbursement"}</p>
              <p className="metric-value numeric">{approvalsQuery.data.pendingCount}</p>
              <p className="metric-hint">{stageDescription}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Queue Amount</p>
              <p className="metric-value">
                <CurrencyDisplay amount={approvalsQuery.data.pendingAmount} currency="USD" />
              </p>
              <p className="metric-hint">Total amount currently in this queue</p>
            </article>
          </section>

          {expenses.length === 0 ? (
            <EmptyState
              title={stage === "manager" ? "No expenses pending manager approval" : "No expenses pending disbursement"}
              description="All current expense submissions have been processed for this stage."
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
                          aria-label={`Select all ${stageTitle.toLowerCase()} expenses`}
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
                          {getExpenseStatusLabel(expense.status)}
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
                          {stage === "manager" ? (
                            <>
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => handleSingleManagerApprove(expense)}
                                disabled={isMutatingId === expense.id}
                              >
                                {isMutatingId === expense.id ? "Saving..." : "Approve"}
                              </button>
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => openRejectPanel(expense, "manager")}
                                disabled={isMutatingId === expense.id}
                              >
                                Reject
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => openDisbursePanel(expense)}
                                disabled={isMutatingId === expense.id}
                              >
                                {isMutatingId === expense.id ? "Saving..." : "Disburse"}
                              </button>
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => openRejectPanel(expense, "finance")}
                                disabled={isMutatingId === expense.id}
                              >
                                Reject
                              </button>
                            </>
                          )}
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
        title={rejectMode === "manager" ? "Reject expense" : "Finance reject expense"}
        description={
          rejectTarget
            ? rejectMode === "manager"
              ? `Provide a reason for rejecting ${rejectTarget.employeeName}'s expense.`
              : `Provide a finance rejection reason for ${rejectTarget.employeeName}'s expense.`
            : undefined
        }
        onClose={closeRejectPanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={submitReject}>
          <label className="form-field">
            <span className="form-label">Rejection reason</span>
            <textarea
              className={rejectErrors.reason ? "form-input form-input-error" : "form-input"}
              rows={4}
              value={rejectValues.reason}
              onChange={handleRejectReasonChange}
              placeholder="Explain why this expense cannot be approved."
              disabled={isRejecting}
            />
            {rejectErrors.reason ? <p className="form-field-error">{rejectErrors.reason}</p> : null}
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

      <SlidePanel
        isOpen={Boolean(disburseTarget)}
        title="Disburse expense"
        description={
          disburseTarget
            ? `Finalize reimbursement for ${disburseTarget.employeeName}.`
            : undefined
        }
        onClose={closeDisbursePanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={submitDisbursement}>
          <label className="form-field">
            <span className="form-label">Reimbursement reference</span>
            <input
              className={disburseErrors.reimbursementReference ? "form-input form-input-error" : "form-input"}
              value={disburseValues.reimbursementReference}
              onChange={handleDisburseFieldChange("reimbursementReference")}
              placeholder="BANK-REF-1234"
              disabled={isDisbursing}
            />
            {disburseErrors.reimbursementReference ? (
              <p className="form-field-error">{disburseErrors.reimbursementReference}</p>
            ) : null}
          </label>
          <label className="form-field">
            <span className="form-label">Notes</span>
            <textarea
              className="form-input"
              rows={4}
              value={disburseValues.reimbursementNotes}
              onChange={handleDisburseFieldChange("reimbursementNotes")}
              placeholder="Optional disbursement notes."
              disabled={isDisbursing}
            />
          </label>
          <div className="slide-panel-actions">
            <button type="button" className="button" onClick={closeDisbursePanel} disabled={isDisbursing}>
              Cancel
            </button>
            <button type="submit" className="button button-accent" disabled={isDisbursing}>
              {isDisbursing ? "Disbursing..." : "Confirm disbursement"}
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
