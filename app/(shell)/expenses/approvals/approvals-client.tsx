"use client";

import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";

import { ConfirmDialog } from "../../../../components/shared/confirm-dialog";
import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { SlidePanel } from "../../../../components/shared/slide-panel";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { CurrencyDisplay } from "../../../../components/ui/currency-display";
import { useExpenseApprovals } from "../../../../hooks/use-expenses";
import { countryFlagFromCode, countryNameFromCode } from "../../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime, formatSingleDateHuman } from "../../../../lib/datetime";
import {
  currentMonthKey,
  formatMonthLabel,
  getExpenseCategoryLabel,
  getExpenseStatusLabel,
  toneForExpenseStatus
} from "../../../../lib/expenses";
import { EXPENSE_CATEGORIES } from "../../../../types/expenses";
import type {
  CreateExpenseCommentResponse,
  ExpenseCategory,
  ExpenseApprovalStage,
  ExpenseBulkApproveResponse,
  ExpenseCommentRecord,
  ExpenseCommentsResponse,
  ExpenseReceiptSignedUrlResponse,
  ExpenseRecord,
  UpdateExpenseResponse
} from "../../../../types/expenses";
import { humanizeError } from "@/lib/errors";

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

type RequestInfoFormErrors = {
  message?: string;
};

type DisburseFormValues = {
  reimbursementReference: string;
  reimbursementNotes: string;
};

type DisburseFormErrors = {
  reimbursementReference?: string;
  paymentProof?: string;
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
      <div className="table-skeleton">
        <div className="table-skeleton-header" />
        {Array.from({ length: 7 }, (_, index) => (
          <div key={`expenses-approval-skeleton-${index}`} className="table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

export function ExpenseApprovalsClient({
  canManagerApprove,
  canFinanceApprove,
  embedded = false
}: {
  canManagerApprove: boolean;
  canFinanceApprove: boolean;
  embedded?: boolean;
}) {
  const queryClient = useQueryClient();
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
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<ExpenseCategory | "all">("all");
  const [fromDateFilter, setFromDateFilter] = useState("");
  const [toDateFilter, setToDateFilter] = useState("");
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
  const [requestInfoTarget, setRequestInfoTarget] = useState<ExpenseRecord | null>(null);
  const [requestInfoMessage, setRequestInfoMessage] = useState("");
  const [requestInfoThread, setRequestInfoThread] = useState<ExpenseCommentRecord[]>([]);
  const [requestInfoErrors, setRequestInfoErrors] = useState<RequestInfoFormErrors>({});
  const [isLoadingRequestInfoThread, setIsLoadingRequestInfoThread] = useState(false);
  const [isRequestingInfo, setIsRequestingInfo] = useState(false);
  const [disburseTarget, setDisburseTarget] = useState<ExpenseRecord | null>(null);
  const [disburseValues, setDisburseValues] = useState<DisburseFormValues>({
    reimbursementReference: "",
    reimbursementNotes: ""
  });
  const [disburseErrors, setDisburseErrors] = useState<DisburseFormErrors>({});
  const [isDisbursing, setIsDisbursing] = useState(false);
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const paymentProofInputRef = useRef<HTMLInputElement>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [confirmApproveTarget, setConfirmApproveTarget] = useState<ExpenseRecord | null>(null);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);

  const queueCurrency = useMemo(() => {
    const rows = approvalsQuery.data?.expenses ?? [];
    return rows.length > 0 ? rows[0].currency : "USD";
  }, [approvalsQuery.data?.expenses]);

  const expenses = useMemo(() => {
    const rows = approvalsQuery.data?.expenses ?? [];

    return [...rows].sort((leftExpense, rightExpense) => {
      const leftTime = Date.parse(leftExpense.expenseDate);
      const rightTime = Date.parse(rightExpense.expenseDate);
      return sortDirection === "asc" ? leftTime - rightTime : rightTime - leftTime;
    });
  }, [approvalsQuery.data?.expenses, sortDirection]);

  const filteredExpenses = useMemo(() => {
    const normalizedEmployeeFilter = employeeFilter.trim().toLowerCase();

    return expenses.filter((expense) => {
      if (categoryFilter !== "all" && expense.category !== categoryFilter) {
        return false;
      }

      if (fromDateFilter && expense.expenseDate < fromDateFilter) {
        return false;
      }

      if (toDateFilter && expense.expenseDate > toDateFilter) {
        return false;
      }

      if (!normalizedEmployeeFilter) {
        return true;
      }

      const searchableText = [
        expense.employeeName,
        expense.employeeDepartment ?? "",
        getExpenseCategoryLabel(expense.category)
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(normalizedEmployeeFilter);
    });
  }, [categoryFilter, employeeFilter, expenses, fromDateFilter, toDateFilter]);

  useEffect(() => {
    if (!availableStages.includes(stage) && availableStages[0]) {
      setStage(availableStages[0]);
    }
  }, [availableStages, stage]);

  useEffect(() => {
    setSelectedIds([]);
  }, [month, stage, employeeFilter, categoryFilter, fromDateFilter, toDateFilter]);

  const allSelected =
    filteredExpenses.length > 0 &&
    filteredExpenses.every((expense) => selectedIds.includes(expense.id));

  const dismissToast = (toastId: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== toastId));
  };

  const showToast = (variant: ToastVariant, rawMessage: string) => {
    const message = variant === "error" ? humanizeError(rawMessage) : rawMessage;
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

    setSelectedIds(filteredExpenses.map((expense) => expense.id));
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
      void queryClient.invalidateQueries({ queryKey: ["approvals-tab-counts"] });
      showToast("success", "Expense moved to finance payment queue.");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to approve expense.");
    } finally {
      setIsMutatingId(null);
    }
  };

  const openApproveConfirm = (expense: ExpenseRecord) => {
    setConfirmApproveTarget(expense);
  };

  const closeApproveConfirm = () => {
    setConfirmApproveTarget(null);
  };

  const confirmSingleApprove = async () => {
    if (!confirmApproveTarget) {
      return;
    }

    const target = confirmApproveTarget;
    closeApproveConfirm();
    await handleSingleManagerApprove(target);
  };

  const loadRequestInfoThread = async (expenseId: string) => {
    setIsLoadingRequestInfoThread(true);
    try {
      const response = await fetch(`/api/v1/expenses/${expenseId}/comments`, {
        method: "GET"
      });
      const payload = (await response.json()) as ExpenseCommentsResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? "Unable to load expense conversation.");
        setRequestInfoThread([]);
        return;
      }

      setRequestInfoThread(payload.data.comments);
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Unable to load expense conversation."
      );
      setRequestInfoThread([]);
    } finally {
      setIsLoadingRequestInfoThread(false);
    }
  };

  const openRequestInfoPanel = (expense: ExpenseRecord) => {
    setRequestInfoTarget(expense);
    setRequestInfoMessage("");
    setRequestInfoErrors({});
    setRequestInfoThread([]);
    void loadRequestInfoThread(expense.id);
  };

  const closeRequestInfoPanel = () => {
    if (isRequestingInfo) {
      return;
    }

    setRequestInfoTarget(null);
    setRequestInfoMessage("");
    setRequestInfoErrors({});
    setRequestInfoThread([]);
  };

  const handleRequestInfoMessageChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.currentTarget.value;
    setRequestInfoMessage(value);

    if (value.trim().length === 0) {
      setRequestInfoErrors({ message: "Message is required." });
      return;
    }

    if (value.trim().length > 2000) {
      setRequestInfoErrors({ message: "Message is too long." });
      return;
    }

    setRequestInfoErrors({});
  };

  const submitRequestInfo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!requestInfoTarget) {
      return;
    }

    const trimmedMessage = requestInfoMessage.trim();
    if (!trimmedMessage) {
      setRequestInfoErrors({ message: "Message is required." });
      return;
    }

    if (trimmedMessage.length > 2000) {
      setRequestInfoErrors({ message: "Message is too long." });
      return;
    }

    setIsRequestingInfo(true);
    setIsMutatingId(requestInfoTarget.id);

    try {
      const response = await fetch(`/api/v1/expenses/${requestInfoTarget.id}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "request_info",
          message: trimmedMessage
        })
      });

      const payload = (await response.json()) as CreateExpenseCommentResponse;

      if (!response.ok || !payload.data?.comment) {
        showToast("error", payload.error?.message ?? "Unable to request additional info.");
        return;
      }
      const createdComment = payload.data.comment;

      setRequestInfoThread((current) => [...current, createdComment]);
      setRequestInfoMessage("");
      setRequestInfoErrors({});
      approvalsQuery.refresh();
      void queryClient.invalidateQueries({ queryKey: ["approvals-tab-counts"] });
      showToast("info", "Info request sent to employee.");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to request additional info.");
    } finally {
      setIsRequestingInfo(false);
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
    setPaymentProofFile(null);
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
    setPaymentProofFile(null);
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

  const handlePaymentProofChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setPaymentProofFile(file);
    setDisburseErrors((current) => ({
      ...current,
      paymentProof: undefined
    }));
  };

  const submitDisbursement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!disburseTarget) {
      return;
    }

    const validation = disburseSchema.safeParse(disburseValues);

    if (!validation.success) {
      setDisburseErrors({
        reimbursementReference: validation.error.flatten().fieldErrors.reimbursementReference?.[0],
        paymentProof: undefined
      });
      return;
    }

    if (!paymentProofFile) {
      setDisburseErrors({
        reimbursementReference: undefined,
        paymentProof: "Payment proof receipt is required."
      });
      return;
    }

    setIsDisbursing(true);
    setIsMutatingId(disburseTarget.id);

    try {
      // Step 1: Upload payment proof file
      const uploadForm = new FormData();
      uploadForm.set("paymentProof", paymentProofFile);

      const uploadResponse = await fetch(
        `/api/v1/expenses/${disburseTarget.id}/payment-proof`,
        { method: "POST", body: uploadForm }
      );

      if (!uploadResponse.ok) {
        const uploadPayload = await uploadResponse.json().catch(() => null);
        showToast(
          "error",
          (uploadPayload as { error?: { message?: string } } | null)?.error?.message ??
            "Unable to upload payment proof."
        );
        return;
      }

      const uploadResult = (await uploadResponse.json()) as { data?: { path?: string } };
      const receiptPath = uploadResult.data?.path;

      if (!receiptPath) {
        showToast("error", "Unable to upload payment proof.");
        return;
      }

      // Step 2: Mark the expense as paid
      const response = await fetch(`/api/v1/expenses/${disburseTarget.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "approve",
          reimbursementReference: disburseValues.reimbursementReference.trim(),
          reimbursementNotes: disburseValues.reimbursementNotes.trim() || undefined,
          reimbursementReceiptPath: receiptPath
        })
      });

      const payload = (await response.json()) as UpdateExpenseResponse;

      if (!response.ok || !payload.data?.expense) {
        showToast("error", payload.error?.message ?? "Unable to mark expense as paid.");
        return;
      }

      closeDisbursePanel();
      setSelectedIds((current) => current.filter((id) => id !== disburseTarget.id));
      approvalsQuery.refresh();
      void queryClient.invalidateQueries({ queryKey: ["approvals-tab-counts"] });
      showToast("success", "Expense marked as paid.");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to mark expense as paid.");
    } finally {
      setIsDisbursing(false);
      setIsMutatingId(null);
    }
  };

  const handleBulkApprove = async () => {
    if (stage !== "manager") {
      showToast("error", "Bulk processing is only available for manager approvals.");
      return;
    }

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
      void queryClient.invalidateQueries({ queryKey: ["approvals-tab-counts"] });
      showToast(
        "success",
        `Moved ${payload.data.approvedCount} expenses to finance.`
      );
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to process selected expenses.");
    } finally {
      setIsBulkApproving(false);
    }
  };

  const openBulkApproveConfirm = () => {
    if (stage !== "manager") {
      return;
    }

    if (selectedIds.length === 0 || isBulkApproving) {
      return;
    }

    setShowBulkConfirm(true);
  };

  const closeBulkApproveConfirm = () => {
    if (isBulkApproving) {
      return;
    }

    setShowBulkConfirm(false);
  };

  const confirmBulkApprove = async () => {
    setShowBulkConfirm(false);
    await handleBulkApprove();
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
      void queryClient.invalidateQueries({ queryKey: ["approvals-tab-counts"] });
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

  const stageTitle = stage === "manager" ? "Pending My Approval" : "Pending Payment";
  const stageDescription =
    stage === "manager"
      ? "Expenses from your direct reports awaiting manager approval."
      : "Manager-approved expenses awaiting finance payment confirmation with uploaded payment proof.";
  const hasActiveFilters =
    employeeFilter.trim().length > 0 ||
    categoryFilter !== "all" ||
    fromDateFilter.length > 0 ||
    toDateFilter.length > 0;
  const canBulkProcess = stage === "manager";

  const clearFilters = () => {
    setEmployeeFilter("");
    setCategoryFilter("all");
    setFromDateFilter("");
    setToDateFilter("");
  };

  return (
    <>
      {!embedded ? (
        <PageHeader
          title="Expense Approvals"
          description="Process manager-approved expenses, confirm payments, and close the finance queue efficiently."
          actions={
            canBulkProcess ? (
              <button
                type="button"
                className="button button-accent"
                onClick={openBulkApproveConfirm}
                disabled={selectedIds.length === 0 || isBulkApproving}
              >
                {isBulkApproving ? "Approving..." : `Bulk approve (${selectedIds.length})`}
              </button>
            ) : null
          }
        />
      ) : null}

      {availableStages.length > 1 ? (
        <section className="page-tabs" aria-label="Approval queues">
          <button
            type="button"
            className={stage === "manager" ? "page-tab page-tab-active" : "page-tab"}
            onClick={() => setStage("manager")}
          >
            Pending My Approval
          </button>
          <button
            type="button"
            className={stage === "finance" ? "page-tab page-tab-active" : "page-tab"}
            onClick={() => setStage("finance")}
          >
            Pending Payment
          </button>
        </section>
      ) : null}

      <section className="expenses-toolbar" aria-label="Approvals filters">
        <div className="expenses-toolbar-copy">
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
        </div>
        <div className="expenses-toolbar-actions">
          <p className="settings-card-description">
            Filter by employee, category, and date range to prioritize reimbursements faster.
          </p>
          <button type="button" className="button" onClick={clearFilters} disabled={!hasActiveFilters}>
            Clear filters
          </button>
        </div>
      </section>

      <section className="expenses-approvals-filter-bar" aria-label="Approval queue filters">
        <label className="form-field">
          <span className="form-label">Employee</span>
          <input
            type="search"
            className="form-input"
            value={employeeFilter}
            onChange={(event) => setEmployeeFilter(event.currentTarget.value)}
            placeholder="Search by employee or department"
          />
        </label>
        <label className="form-field">
          <span className="form-label">Category</span>
          <select
            className="form-input"
            value={categoryFilter}
            onChange={(event) =>
              setCategoryFilter(event.currentTarget.value as ExpenseCategory | "all")
            }
          >
            <option value="all">All categories</option>
            {EXPENSE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {getExpenseCategoryLabel(category)}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span className="form-label">From Date</span>
          <input
            type="date"
            className="form-input numeric"
            value={fromDateFilter}
            onChange={(event) => setFromDateFilter(event.currentTarget.value)}
          />
        </label>
        <label className="form-field">
          <span className="form-label">To Date</span>
          <input
            type="date"
            className="form-input numeric"
            value={toDateFilter}
            onChange={(event) => setToDateFilter(event.currentTarget.value)}
          />
        </label>
      </section>

      {approvalsQuery.isLoading ? <ApprovalSkeleton /> : null}

      {!approvalsQuery.isLoading && approvalsQuery.errorMessage ? (
        <>
          <EmptyState
            title="Expense approvals are unavailable"
            description={approvalsQuery.errorMessage}
            ctaLabel="Retry"
            ctaHref={embedded ? "/approvals?tab=expenses" : "/expenses/approvals"}
          />
          <button type="button" className="button button-accent" onClick={() => approvalsQuery.refresh()}>
            Retry
          </button>
        </>
      ) : null}

      {!approvalsQuery.isLoading && !approvalsQuery.errorMessage && approvalsQuery.data ? (
        <>
          <section className="expenses-metric-grid" aria-label="Pending approvals summary">
            <article className="metric-card">
              <p className="metric-label">{stage === "manager" ? "Pending Manager Approval" : "Pending Payment"}</p>
              <p className="metric-value numeric">{approvalsQuery.data.pendingCount}</p>
              <p className="metric-hint">{stageDescription}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Queue Amount</p>
              <p className="metric-value">
                <CurrencyDisplay amount={approvalsQuery.data.pendingAmount} currency={queueCurrency} />
              </p>
              <p className="metric-hint">Total amount currently in this queue</p>
            </article>
          </section>

          {filteredExpenses.length === 0 ? (
            <EmptyState
              title={
                hasActiveFilters
                  ? "No expenses match current filters"
                  : stage === "manager"
                    ? "No expenses pending manager approval"
                    : "No expenses pending payment confirmation"
              }
              description={
                hasActiveFilters
                  ? "Try clearing one or more filters to view more expense requests."
                  : "All current expense submissions have been processed for this stage."
              }
              ctaLabel="Open expenses"
              ctaHref="/expenses"
            />
          ) : (
            <section className="data-table-container" aria-label="Pending expenses approvals table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>
                      {canBulkProcess ? (
                        <label className="expenses-checkbox">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={toggleSelectAll}
                            aria-label={`Select all ${stageTitle.toLowerCase()} expenses`}
                          />
                        </label>
                      ) : null}
                    </th>
                    <th>Employee</th>
                    <th>Category</th>
                    <th>Description</th>
                    <th>Vendor</th>
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
                  {filteredExpenses.map((expense) => (
                    <tr key={expense.id} className="data-table-row">
                      <td>
                        {canBulkProcess ? (
                          <label className="expenses-checkbox">
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(expense.id)}
                              onChange={() => toggleSelected(expense.id)}
                              aria-label={`Select expense from ${expense.employeeName}`}
                            />
                          </label>
                        ) : null}
                      </td>
                      <td>
                        <div className="documents-cell-copy">
                          <p className="documents-cell-title">{expense.employeeName}</p>
                          <p className="documents-cell-description">
                            {expense.employeeDepartment ?? ""}
                          </p>
                        </div>
                      </td>
                      <td>{getExpenseCategoryLabel(expense.category)}</td>
                      <td>
                        <p className="expenses-description">{expense.description}</p>
                      </td>
                      <td>
                        {expense.vendorName ? (
                          <div className="documents-cell-copy">
                            <p className="documents-cell-title">{expense.vendorName}</p>
                            {expense.vendorBankAccountName ? (
                              <p className="documents-cell-description">
                                {expense.vendorBankAccountName}
                                {expense.vendorBankAccountNumber
                                  ? ` ••${expense.vendorBankAccountNumber.slice(-4)}`
                                  : ""}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
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
                          {formatSingleDateHuman(expense.expenseDate)}
                        </time>
                      </td>
                      <td>
                        <StatusBadge tone={toneForExpenseStatus(expense.status)}>
                          {getExpenseStatusLabel(expense.status)}
                        </StatusBadge>
                        {expense.infoRequestState === "requested" ? (
                          <p className="documents-cell-description">
                            Info requested
                            {expense.infoRequestUpdatedByName
                              ? ` by ${expense.infoRequestUpdatedByName}`
                              : ""}.
                          </p>
                        ) : null}
                        {expense.infoRequestState === "responded" ? (
                          <p className="documents-cell-description">
                            Employee replied to info request.
                          </p>
                        ) : null}
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
                                onClick={() => openApproveConfirm(expense)}
                                disabled={isMutatingId === expense.id}
                              >
                                {isMutatingId === expense.id ? "Saving..." : "Approve"}
                              </button>
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => openRequestInfoPanel(expense)}
                                disabled={isMutatingId === expense.id}
                              >
                                Request info
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
                                {isMutatingId === expense.id ? "Saving..." : "Mark paid"}
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
        title="Mark expense as paid"
        description={
          disburseTarget
            ? `Record payment confirmation for ${disburseTarget.employeeName}.`
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
              rows={3}
              value={disburseValues.reimbursementNotes}
              onChange={handleDisburseFieldChange("reimbursementNotes")}
              placeholder="Optional payment notes."
              disabled={isDisbursing}
            />
          </label>
          <div className="form-field">
            <span className="form-label">Payment proof receipt</span>
            <p className="form-hint">Upload a bank transaction receipt or transfer confirmation (PDF, PNG, JPG).</p>
            <div className="payment-proof-upload">
              {paymentProofFile ? (
                <div className="payment-proof-file">
                  <span className="payment-proof-file-name">{paymentProofFile.name}</span>
                  <span className="payment-proof-file-size">
                    {Math.round(paymentProofFile.size / 1024)} KB
                  </span>
                  <button
                    type="button"
                    className="payment-proof-remove"
                    onClick={() => {
                      setPaymentProofFile(null);
                      setDisburseErrors((current) => ({
                        ...current,
                        paymentProof: "Payment proof receipt is required."
                      }));
                      if (paymentProofInputRef.current) {
                        paymentProofInputRef.current.value = "";
                      }
                    }}
                    disabled={isDisbursing}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="button"
                  onClick={() => paymentProofInputRef.current?.click()}
                  disabled={isDisbursing}
                >
                  Choose file
                </button>
              )}
              <input
                ref={paymentProofInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={handlePaymentProofChange}
                style={{ display: "none" }}
              />
            </div>
            {disburseErrors.paymentProof ? (
              <p className="form-field-error">{disburseErrors.paymentProof}</p>
            ) : null}
          </div>
          <div className="slide-panel-actions">
            <button type="button" className="button" onClick={closeDisbursePanel} disabled={isDisbursing}>
              Cancel
            </button>
            <button type="submit" className="button button-accent" disabled={isDisbursing}>
              {isDisbursing ? "Saving..." : "Confirm payment"}
            </button>
          </div>
        </form>
      </SlidePanel>

      <SlidePanel
        isOpen={Boolean(requestInfoTarget)}
        title="Request more info"
        description={
          requestInfoTarget
            ? `Ask ${requestInfoTarget.employeeName} for additional details before approval.`
            : undefined
        }
        onClose={closeRequestInfoPanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={submitRequestInfo}>
          <section className="settings-card" aria-label="Expense conversation">
            <h3 className="section-title">Conversation</h3>
            {isLoadingRequestInfoThread ? (
              <p className="settings-card-description">Loading conversation...</p>
            ) : requestInfoThread.length === 0 ? (
              <p className="settings-card-description">No prior messages.</p>
            ) : (
              <ul className="compensation-history-list">
                {requestInfoThread.map((comment) => (
                  <li key={comment.id} className="compensation-history-item">
                    <div className="compensation-history-item-title">
                      <span>{comment.authorName}</span>
                      <StatusBadge tone={comment.commentType === "request_info" ? "warning" : "info"}>
                        {comment.commentType === "request_info" ? "Requested info" : "Response"}
                      </StatusBadge>
                    </div>
                    <p>{comment.message}</p>
                    <p className="compensation-history-item-meta" title={formatDateTimeTooltip(comment.createdAt)}>
                      {formatRelativeTime(comment.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <label className="form-field">
            <span className="form-label">Message to employee</span>
            <textarea
              className={requestInfoErrors.message ? "form-input form-input-error" : "form-input"}
              rows={4}
              value={requestInfoMessage}
              onChange={handleRequestInfoMessageChange}
              placeholder="What additional details do you need?"
              disabled={isRequestingInfo}
            />
            {requestInfoErrors.message ? (
              <p className="form-field-error">{requestInfoErrors.message}</p>
            ) : null}
          </label>
          <div className="slide-panel-actions">
            <button
              type="button"
              className="button"
              onClick={closeRequestInfoPanel}
              disabled={isRequestingInfo}
            >
              Cancel
            </button>
            <button type="submit" className="button button-accent" disabled={isRequestingInfo}>
              {isRequestingInfo ? "Sending..." : "Send request"}
            </button>
          </div>
        </form>
      </SlidePanel>

      <ConfirmDialog
        isOpen={Boolean(confirmApproveTarget)}
        title="Approve expense?"
        description={
          confirmApproveTarget
            ? `Approve ${confirmApproveTarget.employeeName}'s expense and move it to finance payment queue.`
            : undefined
        }
        confirmLabel="Approve expense"
        cancelLabel="Cancel"
        isConfirming={Boolean(isMutatingId)}
        onCancel={closeApproveConfirm}
        onConfirm={() => {
          void confirmSingleApprove();
        }}
      />

      <ConfirmDialog
        isOpen={showBulkConfirm}
        title="Bulk approve expenses?"
        description={`This will move ${selectedIds.length} selected expenses to finance for payment.`}
        confirmLabel="Approve selected"
        cancelLabel="Cancel"
        isConfirming={isBulkApproving}
        onCancel={closeBulkApproveConfirm}
        onConfirm={() => {
          void confirmBulkApprove();
        }}
      />

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
