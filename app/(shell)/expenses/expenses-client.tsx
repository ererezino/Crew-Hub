"use client";

import Link from "next/link";
import {
  Fragment,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useMemo,
  useRef,
  useState
} from "react";
import { z } from "zod";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { SlidePanel } from "../../../components/shared/slide-panel";
import { StatusBadge } from "../../../components/shared/status-badge";
import { CurrencyDisplay } from "../../../components/ui/currency-display";
import { MoneyInput } from "../../../components/ui/money-input";
import { useExpenses } from "../../../hooks/use-expenses";
import { countryFlagFromCode, countryNameFromCode } from "../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import {
  ALLOWED_RECEIPT_EXTENSIONS,
  currentMonthKey,
  formatMonthLabel,
  getExpenseCategoryLabel,
  getExpenseStatusLabel,
  isAllowedReceiptUpload,
  MAX_RECEIPT_FILE_BYTES,
  toneForExpenseStatus
} from "../../../lib/expenses";
import type {
  CreateExpenseResponse,
  ExpenseCategory,
  ExpenseReceiptSignedUrlResponse,
  ExpenseRecord,
  UpdateExpenseResponse
} from "../../../types/expenses";

type SortDirection = "asc" | "desc";
type ToastVariant = "success" | "error" | "info";

type ToastMessage = {
  id: string;
  variant: ToastVariant;
  message: string;
};

type ExpenseFormValues = {
  category: ExpenseCategory;
  description: string;
  amount: string;
  expenseDate: string;
  currency: string;
};

type ExpenseFormField = keyof ExpenseFormValues | "receipt";
type ExpenseFormErrors = Partial<Record<ExpenseFormField, string>>;
type ExpenseFormTouched = Record<ExpenseFormField, boolean>;

const expenseFormSchema = z.object({
  category: z.enum([
    "travel",
    "lodging",
    "meals",
    "transport",
    "internet",
    "office_supplies",
    "software",
    "wellness",
    "other"
  ]),
  description: z.string().trim().min(1, "Description is required").max(3000, "Description is too long"),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Amount must be a valid number with up to 2 decimals."),
  expenseDate: z.iso.date(),
  currency: z.string().trim().length(3, "Currency must be a 3-letter code.")
});

const INITIAL_FORM_VALUES: ExpenseFormValues = {
  category: "travel",
  description: "",
  amount: "",
  expenseDate: new Date().toISOString().slice(0, 10),
  currency: "USD"
};

const INITIAL_TOUCHED: ExpenseFormTouched = {
  category: false,
  description: false,
  amount: false,
  expenseDate: false,
  currency: false,
  receipt: false
};

const ALL_TOUCHED: ExpenseFormTouched = {
  category: true,
  description: true,
  amount: true,
  expenseDate: true,
  currency: true,
  receipt: true
};

const categoryOptions: ExpenseCategory[] = [
  "travel",
  "lodging",
  "meals",
  "transport",
  "internet",
  "office_supplies",
  "software",
  "wellness",
  "other"
];

const uploadAcceptValue = ALLOWED_RECEIPT_EXTENSIONS.map((extension) => `.${extension}`).join(",");

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseMoneyToMinorUnits(value: string): number | null {
  const trimmed = value.trim();

  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }

  const [wholePart, decimalPart = ""] = trimmed.split(".");
  const whole = Number.parseInt(wholePart, 10);

  if (!Number.isSafeInteger(whole)) {
    return null;
  }

  const paddedDecimals = `${decimalPart}00`.slice(0, 2);
  const fractional = Number.parseInt(paddedDecimals, 10);

  if (!Number.isSafeInteger(fractional)) {
    return null;
  }

  const amount = whole * 100 + fractional;

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return null;
  }

  return amount;
}

function hasFormErrors(errors: ExpenseFormErrors): boolean {
  return Object.values(errors).some((error) => Boolean(error));
}

function validateReceipt(file: File | null): string | undefined {
  if (!file) {
    return "Receipt is required.";
  }

  if (file.size > MAX_RECEIPT_FILE_BYTES) {
    return "Receipt exceeds the 10MB upload limit.";
  }

  if (!isAllowedReceiptUpload(file.name, file.type)) {
    return "Unsupported file type. Allowed: pdf, png, jpg.";
  }

  return undefined;
}

function getFormErrors(
  values: ExpenseFormValues,
  touched: ExpenseFormTouched,
  receipt: File | null
): ExpenseFormErrors {
  const parsed = expenseFormSchema.safeParse(values);
  const errors: ExpenseFormErrors = {};

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    errors.category = touched.category ? fieldErrors.category?.[0] : undefined;
    errors.description = touched.description ? fieldErrors.description?.[0] : undefined;
    errors.amount = touched.amount ? fieldErrors.amount?.[0] : undefined;
    errors.expenseDate = touched.expenseDate ? fieldErrors.expenseDate?.[0] : undefined;
    errors.currency = touched.currency ? fieldErrors.currency?.[0] : undefined;
  }

  if (touched.amount && parseMoneyToMinorUnits(values.amount) === null) {
    errors.amount = "Amount must be a positive value with up to 2 decimals.";
  }

  if (touched.receipt) {
    errors.receipt = validateReceipt(receipt);
  }

  return errors;
}

function uploadExpenseWithProgress(
  formData: FormData,
  onProgress: (value: number) => void
): Promise<{ status: number; payload: CreateExpenseResponse | null }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.open("POST", "/api/v1/expenses");

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }

      const progress = Math.round((event.loaded / event.total) * 100);
      onProgress(progress);
    };

    request.onerror = () => {
      reject(new Error("Expense submission failed."));
    };

    request.onload = () => {
      let payload: CreateExpenseResponse | null = null;

      try {
        payload = JSON.parse(request.responseText) as CreateExpenseResponse;
      } catch {
        payload = null;
      }

      resolve({
        status: request.status,
        payload
      });
    };

    request.send(formData);
  });
}

function CategoryIcon({ category }: { category: ExpenseCategory }) {
  if (category === "travel") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M3 14.5l18-4.2-8.1 7.2.7 3.8-2.7-2.2-3 2 .5-4.3z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (category === "lodging") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 10.5l8-6 8 6V20H4zM9.5 20v-5h5V20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (category === "meals") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M6 4v7m3-7v7m-1.5 0V20M15 4v6.5c0 1.7 1.3 3 3 3h.5V20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (category === "transport") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 15l2-6h12l2 6M7 15h10M8 18.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm8 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (category === "internet") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M3.5 8.5a12 12 0 0117 0M6.5 11.5a8 8 0 0111 0M9.5 14.5a4 4 0 015 0M12 18h.01"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (category === "office_supplies") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M5 5h14v14H5zM5 9h14M9 5v14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (category === "software") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 6h16v12H4zM8 10h3m2 0h3m-8 4h8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (category === "wellness") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 20s-6.5-4.1-6.5-9A3.5 3.5 0 019 7.7c1.4 0 2.3.8 3 1.7.7-.9 1.6-1.7 3-1.7a3.5 3.5 0 013.5 3.3c0 4.9-6.5 9-6.5 9z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 12h12M12 6v12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ExpensesSkeleton() {
  return (
    <section className="expenses-skeleton-layout" aria-hidden="true">
      <div className="expenses-metric-skeleton-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={`expenses-metric-skeleton-${index}`} className="expenses-metric-skeleton-card" />
        ))}
      </div>
      <div className="expenses-table-skeleton">
        <div className="expenses-table-skeleton-header" />
        {Array.from({ length: 8 }, (_, index) => (
          <div key={`expenses-table-skeleton-${index}`} className="expenses-table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

function ExpenseTimelineItem({
  title,
  timestamp,
  description,
  tone
}: {
  title: string;
  timestamp: string | null;
  description: string;
  tone: "pending" | "success" | "error" | "info";
}) {
  return (
    <li className={`expenses-timeline-item expenses-timeline-item-${tone}`}>
      <div className="expenses-timeline-marker" aria-hidden="true" />
      <div className="expenses-timeline-main">
        <p className="expenses-timeline-title">{title}</p>
        <p className="expenses-timeline-description">{description}</p>
      </div>
      <p className="expenses-timeline-time" title={timestamp ? formatDateTimeTooltip(timestamp) : undefined}>
        {timestamp ? formatRelativeTime(timestamp) : "Pending"}
      </p>
    </li>
  );
}

export function ExpensesClient({
  currentUserId,
  canApprove,
  canViewReports,
  showEmployeeColumn
}: {
  currentUserId: string;
  canApprove: boolean;
  canViewReports: boolean;
  showEmployeeColumn: boolean;
}) {
  const [month, setMonth] = useState(currentMonthKey());
  const expensesQuery = useExpenses({ month });
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isDraggingReceipt, setIsDraggingReceipt] = useState(false);
  const [formValues, setFormValues] = useState<ExpenseFormValues>(INITIAL_FORM_VALUES);
  const [formTouched, setFormTouched] = useState<ExpenseFormTouched>(INITIAL_TOUCHED);
  const [formErrors, setFormErrors] = useState<ExpenseFormErrors>({});
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isOpeningReceiptById, setIsOpeningReceiptById] = useState<Record<string, boolean>>({});
  const [isMutatingExpenseId, setIsMutatingExpenseId] = useState<string | null>(null);
  const [expandedExpenseId, setExpandedExpenseId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const receiptInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const expenses = useMemo(() => {
    const rows = expensesQuery.data?.expenses ?? [];

    return [...rows].sort((leftExpense, rightExpense) => {
      const leftTime = Date.parse(`${leftExpense.expenseDate}T00:00:00.000Z`);
      const rightTime = Date.parse(`${rightExpense.expenseDate}T00:00:00.000Z`);
      return sortDirection === "asc" ? leftTime - rightTime : rightTime - leftTime;
    });
  }, [expensesQuery.data?.expenses, sortDirection]);

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

  const openPanel = () => {
    setIsPanelOpen(true);
    setFormValues({
      ...INITIAL_FORM_VALUES,
      expenseDate: new Date().toISOString().slice(0, 10)
    });
    setFormTouched(INITIAL_TOUCHED);
    setFormErrors({});
    setReceiptFile(null);
    setSubmitError(null);
    setUploadProgress(0);
  };

  const closePanel = () => {
    if (isSubmitting) {
      return;
    }

    setIsPanelOpen(false);
    setFormValues(INITIAL_FORM_VALUES);
    setFormTouched(INITIAL_TOUCHED);
    setFormErrors({});
    setReceiptFile(null);
    setSubmitError(null);
    setUploadProgress(0);
    setIsDraggingReceipt(false);
  };

  const handleFormFieldChange =
    (field: keyof ExpenseFormValues) =>
    (
      event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> | string
    ) => {
      const nextValue =
        typeof event === "string" ? event : event.currentTarget.value;

      const nextValues = {
        ...formValues,
        [field]: field === "currency" ? nextValue.toUpperCase() : nextValue
      };

      setFormValues(nextValues);

      if (formTouched[field]) {
        setFormErrors(getFormErrors(nextValues, formTouched, receiptFile));
      }

      if (submitError) {
        setSubmitError(null);
      }
    };

  const handleFieldBlur = (field: ExpenseFormField) => () => {
    const nextTouched = {
      ...formTouched,
      [field]: true
    };

    setFormTouched(nextTouched);
    setFormErrors(getFormErrors(formValues, nextTouched, receiptFile));
  };

  const handleReceiptSelection = (file: File | null) => {
    const nextTouched = {
      ...formTouched,
      receipt: true
    };

    setReceiptFile(file);
    setFormTouched(nextTouched);
    setFormErrors(getFormErrors(formValues, nextTouched, file));
    setSubmitError(null);
    setUploadProgress(0);
  };

  const handleReceiptInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    handleReceiptSelection(file);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingReceipt(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingReceipt(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingReceipt(false);
    const droppedFile = event.dataTransfer.files?.[0] ?? null;
    handleReceiptSelection(droppedFile);
  };

  const handleSubmitExpense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setFormTouched(ALL_TOUCHED);
    const nextErrors = getFormErrors(formValues, ALL_TOUCHED, receiptFile);
    setFormErrors(nextErrors);
    setSubmitError(null);

    if (hasFormErrors(nextErrors) || !receiptFile) {
      return;
    }

    const amountMinorUnits = parseMoneyToMinorUnits(formValues.amount);

    if (amountMinorUnits === null) {
      setFormErrors((currentErrors) => ({
        ...currentErrors,
        amount: "Amount must be a positive value with up to 2 decimals."
      }));
      return;
    }

    setIsSubmitting(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.set("category", formValues.category);
    formData.set("description", formValues.description.trim());
    formData.set("amount", String(amountMinorUnits));
    formData.set("expenseDate", formValues.expenseDate);
    formData.set("currency", formValues.currency.trim().toUpperCase());
    formData.set("receipt", receiptFile);

    try {
      const result = await uploadExpenseWithProgress(formData, setUploadProgress);

      if (result.status < 200 || result.status > 299 || !result.payload?.data?.expense) {
        setSubmitError(result.payload?.error?.message ?? "Unable to submit expense.");
        return;
      }

      closePanel();
      expensesQuery.refresh();
      showToast("success", "Expense submitted.");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to submit expense.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openReceipt = async (expense: ExpenseRecord) => {
    setIsOpeningReceiptById((currentMap) => ({
      ...currentMap,
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
      setIsOpeningReceiptById((currentMap) => {
        const nextMap = { ...currentMap };
        delete nextMap[expense.id];
        return nextMap;
      });
    }
  };

  const mutateExpense = async ({
    expense,
    action
  }: {
    expense: ExpenseRecord;
    action: "cancel";
  }) => {
    setIsMutatingExpenseId(expense.id);

    try {
      const response = await fetch(`/api/v1/expenses/${expense.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action
        })
      });

      const payload = (await response.json()) as UpdateExpenseResponse;

      if (!response.ok || !payload.data?.expense) {
        showToast("error", payload.error?.message ?? "Unable to update expense.");
        return;
      }

      expensesQuery.refresh();
      showToast("success", "Expense cancelled.");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to update expense.");
    } finally {
      setIsMutatingExpenseId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Submit expenses with receipts, track approvals, and monitor reimbursement status."
        actions={
          <>
            {canApprove ? (
              <Link className="button" href="/expenses/approvals">
                Approvals
              </Link>
            ) : null}
            {canViewReports ? (
              <Link className="button" href="/expenses/reports">
                Reports
              </Link>
            ) : null}
            <button type="button" className="button button-accent" onClick={openPanel}>
              Submit expense
            </button>
          </>
        }
      />

      <section className="expenses-toolbar" aria-label="Expenses filters">
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
          Showing {formatMonthLabel(month)} expenses.
        </p>
      </section>

      {expensesQuery.isLoading ? <ExpensesSkeleton /> : null}

      {!expensesQuery.isLoading && expensesQuery.errorMessage ? (
        <section className="expenses-error-state">
          <EmptyState
            title="Expenses are unavailable"
            description={expensesQuery.errorMessage}
            ctaLabel="Retry"
            ctaHref="/expenses"
          />
          <button type="button" className="button button-accent" onClick={() => expensesQuery.refresh()}>
            Retry
          </button>
        </section>
      ) : null}

      {!expensesQuery.isLoading && !expensesQuery.errorMessage && expensesQuery.data ? (
        <>
          <section className="expenses-metric-grid" aria-label="Expense metrics">
            <article className="metric-card">
              <p className="metric-label">Submitted Amount</p>
              <p className="metric-value">
                <CurrencyDisplay amount={expensesQuery.data.summary.totalAmount} currency="USD" />
              </p>
              <p className="metric-hint">{expensesQuery.data.summary.totalCount} submissions</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Pending Reimbursement</p>
              <p className="metric-value">
                <CurrencyDisplay amount={expensesQuery.data.summary.pendingAmount} currency="USD" />
              </p>
              <p className="metric-hint">
                {expensesQuery.data.summary.pendingCount + expensesQuery.data.summary.managerApprovedCount} pending
              </p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Awaiting Finance</p>
              <p className="metric-value numeric">
                {expensesQuery.data.summary.managerApprovedCount + expensesQuery.data.summary.approvedCount}
              </p>
              <p className="metric-hint">Manager-approved and awaiting disbursement</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Reimbursed</p>
              <p className="metric-value numeric">{expensesQuery.data.summary.reimbursedCount}</p>
              <p className="metric-hint">
                <CurrencyDisplay amount={expensesQuery.data.summary.reimbursedAmount} currency="USD" />
              </p>
            </article>
          </section>

          {expenses.length === 0 ? (
            <EmptyState
              title="No expenses found"
              description="Submit your first expense to start reimbursement tracking."
              ctaLabel="Submit expense"
              ctaHref="/expenses"
            />
          ) : (
            <section className="data-table-container" aria-label="Expenses table">
              <table className="data-table">
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
                        Expense date
                        <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      </button>
                    </th>
                    {showEmployeeColumn ? <th>Employee</th> : null}
                    <th>Category</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Country</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th className="table-action-column">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((expense) => {
                    const isExpanded = expandedExpenseId === expense.id;

                    const managerDescription = expense.managerApprovedByName
                      ? `Approved by ${expense.managerApprovedByName}.`
                      : expense.status === "rejected"
                        ? "Rejected before manager approval."
                        : "Awaiting manager decision.";

                    const financeDescription = expense.reimbursedAt
                      ? `Disbursed by ${expense.reimbursedByName ?? "Finance"}${expense.reimbursementReference ? ` (Ref: ${expense.reimbursementReference})` : ""}.`
                      : expense.financeRejectedAt
                        ? `Finance rejected.${expense.financeRejectionReason ? ` Reason: ${expense.financeRejectionReason}` : ""}`
                        : "Awaiting finance disbursement.";

                    return (
                      <Fragment key={expense.id}>
                        <tr className="data-table-row">
                          <td>
                            <time
                              dateTime={expense.expenseDate}
                              title={formatDateTimeTooltip(expense.expenseDate)}
                            >
                              {expense.expenseDate}
                            </time>
                          </td>
                          {showEmployeeColumn ? (
                            <td>
                              <div className="documents-cell-copy">
                                <p className="documents-cell-title">{expense.employeeName}</p>
                                <p className="documents-cell-description">
                                  {expense.employeeDepartment ?? "No department"}
                                </p>
                              </div>
                            </td>
                          ) : null}
                          <td>
                            <span className="expenses-category-chip">
                              <span className="expenses-category-icon">
                                <CategoryIcon category={expense.category} />
                              </span>
                              <span>{getExpenseCategoryLabel(expense.category)}</span>
                            </span>
                          </td>
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
                            <div className="expenses-row-actions">
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
                                onClick={() =>
                                  setExpandedExpenseId((currentId) =>
                                    currentId === expense.id ? null : expense.id
                                  )
                                }
                              >
                                {isExpanded ? "Hide details" : "Details"}
                              </button>

                              {expense.employeeId === currentUserId && expense.status === "pending" ? (
                                <button
                                  type="button"
                                  className="table-row-action"
                                  onClick={() => mutateExpense({ expense, action: "cancel" })}
                                  disabled={isMutatingExpenseId === expense.id}
                                >
                                  {isMutatingExpenseId === expense.id ? "Saving..." : "Cancel"}
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr className="expenses-detail-row">
                            <td colSpan={showEmployeeColumn ? 10 : 9}>
                              <div className="expenses-detail-card">
                                <h3 className="section-title">Approval Timeline</h3>
                                <ul className="expenses-timeline">
                                  <ExpenseTimelineItem
                                    title="Submitted"
                                    timestamp={expense.createdAt}
                                    description={`Submitted by ${expense.employeeName}.`}
                                    tone="success"
                                  />
                                  <ExpenseTimelineItem
                                    title="Manager Approval"
                                    timestamp={expense.managerApprovedAt}
                                    description={managerDescription}
                                    tone={
                                      expense.managerApprovedAt
                                        ? "success"
                                        : expense.status === "rejected"
                                          ? "error"
                                          : "pending"
                                    }
                                  />
                                  <ExpenseTimelineItem
                                    title="Finance Disbursement"
                                    timestamp={expense.reimbursedAt ?? expense.financeRejectedAt}
                                    description={financeDescription}
                                    tone={
                                      expense.reimbursedAt
                                        ? "success"
                                        : expense.financeRejectedAt
                                          ? "error"
                                          : "info"
                                    }
                                  />
                                </ul>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}
        </>
      ) : null}

      <SlidePanel
        isOpen={isPanelOpen}
        title="Submit expense"
        description="Upload a receipt and submit an expense for approval."
        onClose={closePanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleSubmitExpense}>
          <div className="form-field">
            <span className="form-label">Category</span>
            <div className="expenses-category-grid" onBlur={handleFieldBlur("category")}>
              {categoryOptions.map((category) => (
                <button
                  key={category}
                  type="button"
                  className={
                    formValues.category === category
                      ? "expenses-category-option expenses-category-option-active"
                      : "expenses-category-option"
                  }
                  onClick={() => handleFormFieldChange("category")(category)}
                >
                  <span className="expenses-category-option-icon">
                    <CategoryIcon category={category} />
                  </span>
                  <span>{getExpenseCategoryLabel(category)}</span>
                </button>
              ))}
            </div>
            {formErrors.category ? <p className="form-field-error">{formErrors.category}</p> : null}
          </div>

          <label className="form-field">
            <span className="form-label">Description</span>
            <textarea
              className={formErrors.description ? "form-input form-input-error" : "form-input"}
              value={formValues.description}
              onChange={handleFormFieldChange("description")}
              onBlur={handleFieldBlur("description")}
              rows={4}
              placeholder="Describe what this expense covers."
              disabled={isSubmitting}
            />
            {formErrors.description ? (
              <p className="form-field-error">{formErrors.description}</p>
            ) : null}
          </label>

          <div className="expenses-form-grid">
            <label className="form-field">
              <span className="form-label">Amount</span>
              <MoneyInput
                id="expense-amount-input"
                value={formValues.amount}
                onChange={(value) => handleFormFieldChange("amount")(value)}
                onBlur={handleFieldBlur("amount")}
                currency={formValues.currency}
                disabled={isSubmitting}
                hasError={Boolean(formErrors.amount)}
              />
              {formErrors.amount ? <p className="form-field-error">{formErrors.amount}</p> : null}
            </label>

            <label className="form-field">
              <span className="form-label">Date</span>
              <input
                className={formErrors.expenseDate ? "form-input form-input-error" : "form-input"}
                type="date"
                value={formValues.expenseDate}
                onChange={handleFormFieldChange("expenseDate")}
                onBlur={handleFieldBlur("expenseDate")}
                disabled={isSubmitting}
              />
              {formErrors.expenseDate ? (
                <p className="form-field-error">{formErrors.expenseDate}</p>
              ) : null}
            </label>
          </div>

          <div className="form-field">
            <span className="form-label">Receipt</span>
            <div
              className={isDraggingReceipt ? "document-dropzone document-dropzone-active" : "document-dropzone"}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <p className="document-dropzone-title">
                {receiptFile ? receiptFile.name : "Drag and drop a receipt file"}
              </p>
              <p className="document-dropzone-hint">
                PDF, PNG, JPG up to 10MB. Mobile camera capture is supported.
              </p>
              {receiptFile ? (
                <p className="document-dropzone-hint numeric">{Math.round(receiptFile.size / 1024)} KB</p>
              ) : null}
            </div>
            <div className="expenses-receipt-actions">
              <button
                type="button"
                className="button"
                onClick={() => receiptInputRef.current?.click()}
                disabled={isSubmitting}
              >
                Choose file
              </button>
              <button
                type="button"
                className="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={isSubmitting}
              >
                Use camera
              </button>
            </div>
            <input
              ref={receiptInputRef}
              type="file"
              className="expenses-hidden-input"
              accept={uploadAcceptValue}
              onChange={handleReceiptInputChange}
            />
            <input
              ref={cameraInputRef}
              type="file"
              className="expenses-hidden-input"
              accept="image/*"
              capture="environment"
              onChange={handleReceiptInputChange}
            />
            {formErrors.receipt ? <p className="form-field-error">{formErrors.receipt}</p> : null}
          </div>

          {isSubmitting ? (
            <div className="expenses-upload-progress" aria-live="polite">
              <div
                className="expenses-upload-progress-bar"
                style={{ width: `${uploadProgress}%` }}
              />
              <span className="numeric">{uploadProgress}%</span>
            </div>
          ) : null}

          {submitError ? <p className="form-submit-error">{submitError}</p> : null}

          <div className="slide-panel-actions">
            <button
              type="button"
              className="button"
              onClick={closePanel}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button type="submit" className="button button-accent" disabled={isSubmitting}>
              {isSubmitting ? "Submitting..." : "Submit expense"}
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
