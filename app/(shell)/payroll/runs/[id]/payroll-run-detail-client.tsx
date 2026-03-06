"use client";

import {
  Fragment,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { z } from "zod";

import { EmptyState } from "../../../../../components/shared/empty-state";
import { ErrorState } from "../../../../../components/shared/error-state";
import { PageHeader } from "../../../../../components/shared/page-header";
import { StatusBadge } from "../../../../../components/shared/status-badge";
import { CurrencyDisplay } from "../../../../../components/ui/currency-display";
import { useConfirmAction } from "../../../../../hooks/use-confirm-action";
import { usePayrollRunDetail } from "../../../../../hooks/use-payroll-runs";
import { countryFlagFromCode, countryNameFromCode } from "../../../../../lib/countries";
import { formatDate, formatDateTimeTooltip } from "../../../../../lib/datetime";
import { toSentenceCase } from "../../../../../lib/format-labels";
import {
  getCurrencyTotal,
  getPrimaryCurrency,
  labelForPayrollRunStatus,
  toneForPayrollRunStatus
} from "../../../../../lib/payroll/runs";
import type {
  CreatePaymentBatchResponse,
  RetryPaymentResponse
} from "../../../../../types/payments";
import type { GeneratePayslipsResponse } from "../../../../../types/payslips";
import type {
  AddPayrollAdjustmentResponse,
  CalculatePayrollRunResponse,
  PayrollAdjustmentType,
  PayrollRunItem,
  PayrollRunActionResponse,
  PayrollRunStatus
} from "../../../../../types/payroll-runs";

type SortDirection = "asc" | "desc";
type ToastVariant = "success" | "error" | "info";

type ToastMessage = {
  id: string;
  variant: ToastVariant;
  message: string;
};

type AdjustmentFormValues = {
  adjustmentType: PayrollAdjustmentType;
  label: string;
  amount: string;
  notes: string;
};

type AdjustmentFormField = keyof AdjustmentFormValues;
type AdjustmentFormErrors = Partial<Record<AdjustmentFormField, string>>;

const RUN_STATUS_FLOW: PayrollRunStatus[] = [
  "draft",
  "calculated",
  "pending_first_approval",
  "pending_final_approval",
  "approved",
  "processing",
  "completed"
];

const adjustmentSchema = z.object({
  adjustmentType: z.enum(["bonus", "deduction", "correction"]),
  label: z.string().trim().min(1, "Label is required.").max(120, "Label is too long."),
  amount: z.string().trim().regex(/^-?\d+$/, "Amount must be a whole number."),
  notes: z.string().max(300, "Notes must be 300 characters or fewer.")
});

const INITIAL_ADJUSTMENT_VALUES: AdjustmentFormValues = {
  adjustmentType: "bonus",
  label: "",
  amount: "",
  notes: ""
};

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function itemTableSkeleton() {
  return (
    <section className="payroll-run-skeleton" aria-hidden="true">
      <div className="payroll-run-skeleton-timeline" />
      <div className="payroll-run-skeleton-metrics" />
      <div className="table-skeleton-header" />
      {Array.from({ length: 8 }, (_, index) => (
        <div key={`payroll-run-row-skeleton-${index}`} className="table-skeleton-row" />
      ))}
    </section>
  );
}

function contractorNote() {
  return "This person is a contractor. Taxes are not withheld by Crew Hub. The contractor is responsible for their own tax obligations.";
}

function paymentStatusLabel(status: PayrollRunItem["paymentStatus"]): string {
  switch (status) {
    case "paid":
      return "Paid";
    case "failed":
      return "Failed";
    case "processing":
      return "Processing";
    case "cancelled":
      return "Cancelled";
    default:
      return "Pending";
  }
}

function paymentStatusTone(
  status: PayrollRunItem["paymentStatus"]
): "success" | "error" | "processing" | "warning" | "draft" {
  switch (status) {
    case "paid":
      return "success";
    case "failed":
      return "error";
    case "processing":
      return "processing";
    case "cancelled":
      return "warning";
    default:
      return "draft";
  }
}

function signedAmountPrefix(amount: number | null): string {
  if (amount === null || amount === 0) {
    return "";
  }

  return amount > 0 ? "+" : "-";
}

function absoluteAmount(amount: number | null): number {
  if (amount === null) {
    return 0;
  }

  return Math.abs(amount);
}

function summarizeStatusStep(
  runStatus: PayrollRunStatus
): {
  step: PayrollRunStatus;
  state: "complete" | "active" | "upcoming";
}[] {
  const currentIndex = RUN_STATUS_FLOW.indexOf(runStatus);

  return RUN_STATUS_FLOW.map((status, index) => {
    if (currentIndex === -1) {
      return {
        step: status,
        state: "upcoming"
      };
    }

    if (index < currentIndex) {
      return { step: status, state: "complete" };
    }

    if (index === currentIndex) {
      return { step: status, state: "active" };
    }

    return { step: status, state: "upcoming" };
  });
}

function getAdjustmentErrors(values: AdjustmentFormValues): AdjustmentFormErrors {
  const parsed = adjustmentSchema.safeParse(values);

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      adjustmentType: errors.adjustmentType?.[0],
      label: errors.label?.[0],
      amount: errors.amount?.[0],
      notes: errors.notes?.[0]
    };
  }

  const integerAmount = Number.parseInt(values.amount.trim(), 10);

  if (!Number.isSafeInteger(integerAmount)) {
    return {
      amount: "Amount is out of supported range."
    };
  }

  if (values.adjustmentType === "correction" && integerAmount === 0) {
    return {
      amount: "Correction amount cannot be zero."
    };
  }

  if (
    (values.adjustmentType === "bonus" || values.adjustmentType === "deduction") &&
    integerAmount <= 0
  ) {
    return {
      amount: "Bonus and deduction amounts must be greater than zero."
    };
  }

  return {};
}

function hasErrors(errors: AdjustmentFormErrors): boolean {
  return Object.values(errors).some((value) => Boolean(value));
}

export function PayrollRunDetailClient({
  runId,
  viewerUserId,
  canManage,
  canFinalApprove
}: {
  runId: string;
  viewerUserId: string;
  canManage: boolean;
  canFinalApprove: boolean;
}) {
  const runQuery = usePayrollRunDetail({ runId, enabled: true });
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isGeneratingStatements, setIsGeneratingStatements] = useState(false);
  const [isProcessingPayments, setIsProcessingPayments] = useState(false);
  const [retryingPaymentId, setRetryingPaymentId] = useState<string | null>(null);
  const [activeRunAction, setActiveRunAction] = useState<
    null | "submit" | "approve_first" | "approve_final" | "reject" | "cancel"
  >(null);
  const [adjustmentItemId, setAdjustmentItemId] = useState<string | null>(null);
  const [adjustmentValues, setAdjustmentValues] = useState<AdjustmentFormValues>(
    INITIAL_ADJUSTMENT_VALUES
  );
  const [adjustmentErrors, setAdjustmentErrors] = useState<AdjustmentFormErrors>({});
  const [isSubmittingAdjustment, setIsSubmittingAdjustment] = useState(false);
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectReasonError, setRejectReasonError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const paymentPollingIntervalRef = useRef<number | null>(null);
  const { confirm, confirmDialog } = useConfirmAction();

  const sortedItems = useMemo(() => {
    const rows = runQuery.data?.items ?? [];

    return [...rows].sort((left, right) => {
      const comparison = left.fullName.localeCompare(right.fullName);
      return sortDirection === "asc" ? comparison : comparison * -1;
    });
  }, [runQuery.data?.items, sortDirection]);


  /** Derive the primary currency from the run's gross totals. */
  const runCurrency = useMemo(() => {
    const totals = runQuery.data?.run?.totalGross;
    if (!totals) return "NGN";
    return getPrimaryCurrency(totals);
  }, [runQuery.data?.run?.totalGross]);
  const run = runQuery.data?.run ?? null;
  const isApproved = run?.status === "approved";
  const isCalculated = run?.status === "calculated";
  const isPendingFirst = run?.status === "pending_first_approval";
  const isPendingFinal = run?.status === "pending_final_approval";
  const canCalculateRun = canManage && (run?.status === "draft" || isCalculated);
  const canGenerateStatements = canManage && isApproved;
  const canProcessPayments =
    canManage && (run?.status === "approved" || run?.status === "processing");
  const canAdjustItems = canManage && isCalculated;
  const canSubmitForApproval = canManage && isCalculated;
  const canApproveFirst =
    canManage &&
    isPendingFirst &&
    run?.initiatedBy !== viewerUserId;
  const canApproveFinal =
    canFinalApprove &&
    isPendingFinal &&
    run?.firstApprovedBy !== viewerUserId;
  const canRejectAtCurrentStep =
    (canManage &&
      isPendingFirst &&
      run?.initiatedBy !== viewerUserId) ||
    (canFinalApprove &&
      isPendingFinal &&
      run?.firstApprovedBy !== viewerUserId);
  const canCancelRun =
    canManage &&
    (run ? run.status !== "approved" && run.status !== "cancelled" : false);

  const refreshRunDetail = runQuery.refresh;

  const startPaymentPolling = useCallback(() => {
    if (paymentPollingIntervalRef.current !== null) {
      return;
    }

    paymentPollingIntervalRef.current = window.setInterval(() => {
      refreshRunDetail();
    }, 1250);
  }, [refreshRunDetail]);

  const stopPaymentPolling = useCallback(() => {
    if (paymentPollingIntervalRef.current === null) {
      return;
    }

    window.clearInterval(paymentPollingIntervalRef.current);
    paymentPollingIntervalRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      stopPaymentPolling();
    };
  }, [stopPaymentPolling]);

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

  const calculateRun = async () => {
    setIsCalculating(true);

    try {
      const response = await fetch(`/api/v1/payroll/runs/${runId}/calculate`, {
        method: "POST"
      });

      const payload = (await response.json()) as CalculatePayrollRunResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? "Unable to calculate payroll run.");
        return;
      }

      showToast(
        "success",
        `Calculation complete for ${payload.data.employeeCount} employees.`
      );
      runQuery.refresh();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to calculate payroll run.");
    } finally {
      setIsCalculating(false);
    }
  };

  const generateStatements = async () => {
    setIsGeneratingStatements(true);

    try {
      const response = await fetch(`/api/v1/payroll/runs/${runId}/generate-payslips`, {
        method: "POST"
      });

      const payload = (await response.json()) as GeneratePayslipsResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? "Unable to generate payment statements.");
        return;
      }

      if (payload.data.generatedCount > 0) {
        showToast(
          "success",
          `Generated ${payload.data.generatedCount} payment statement${
            payload.data.generatedCount === 1 ? "" : "s"
          }.`
        );
      } else {
        showToast("info", "No payment statements were generated.");
      }

      if (payload.data.skippedCount > 0) {
        showToast(
          "info",
          `${payload.data.skippedCount} statement${
            payload.data.skippedCount === 1 ? "" : "s"
          } skipped due to missing data or file upload issues.`
        );
      }

      runQuery.refresh();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Unable to generate payment statements."
      );
    } finally {
      setIsGeneratingStatements(false);
    }
  };

  const processPayments = async () => {
    setIsProcessingPayments(true);
    startPaymentPolling();

    try {
      const response = await fetch("/api/v1/payments/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          payrollRunId: runId
        })
      });

      const payload = (await response.json()) as CreatePaymentBatchResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? "Unable to process payroll payments.");
        return;
      }

      const summary = payload.data.summary;

      showToast(
        summary.failedCount > 0 ? "info" : "success",
        `Payments processed: ${summary.completedCount} completed, ${summary.failedCount} failed.`
      );

      if (summary.rejectedCount > 0) {
        showToast(
          "info",
          `${summary.rejectedCount} duplicate payment key${
            summary.rejectedCount === 1 ? "" : "s"
          } rejected by idempotency protection.`
        );
      }

      if (summary.failedCount > 0) {
        showToast(
          "error",
          "Some payments failed. Use Retry payment on failed employees."
        );
      }

      runQuery.refresh();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Unable to process payroll payments."
      );
    } finally {
      setIsProcessingPayments(false);
      window.setTimeout(() => {
        stopPaymentPolling();
      }, 900);
    }
  };

  const retryPayment = async (item: PayrollRunItem) => {
    if (!item.paymentId) {
      showToast("error", "No payment record is linked for retry.");
      return;
    }

    setRetryingPaymentId(item.paymentId);
    startPaymentPolling();

    try {
      const response = await fetch(`/api/v1/payments/${item.paymentId}/retry`, {
        method: "POST"
      });

      const payload = (await response.json()) as RetryPaymentResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? "Unable to retry payment.");
        return;
      }

      showToast(
        payload.data.payment.status === "completed" ? "success" : "error",
        payload.data.payment.status === "completed"
          ? "Payment retry completed."
          : "Payment retry failed."
      );

      runQuery.refresh();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to retry payment.");
    } finally {
      setRetryingPaymentId(null);
      window.setTimeout(() => {
        stopPaymentPolling();
      }, 900);
    }
  };

  const performRunAction = async (
    action: "submit" | "approve_first" | "approve_final" | "reject" | "cancel",
    reason: string | null = null
  ) => {
    setActiveRunAction(action);

    try {
      const response = await fetch(`/api/v1/payroll/runs/${runId}/actions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action,
          reason
        })
      });

      const payload = (await response.json()) as PayrollRunActionResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? "Unable to update approval state.");
        return false;
      }

      if (action === "submit") {
        showToast("success", "Run submitted for first approval.");
      } else if (action === "approve_first") {
        showToast("success", "First approval complete. Awaiting final approval.");
      } else if (action === "approve_final") {
        showToast("success", "Final approval complete. Payroll is now locked.");
      } else if (action === "reject") {
        showToast("info", "Run rejected and returned to calculated state.");
      } else if (action === "cancel") {
        showToast("info", "Run cancelled.");
      }

      if (action === "approve_final") {
        setAdjustmentItemId(null);
      }

      runQuery.refresh();
      return true;
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to update approval state.");
      return false;
    } finally {
      setActiveRunAction(null);
    }
  };

  const openAdjustmentPanel = (item: PayrollRunItem) => {
    setAdjustmentItemId(item.id);
    setAdjustmentValues(INITIAL_ADJUSTMENT_VALUES);
    setAdjustmentErrors({});
  };

  const submitAdjustment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!adjustmentItemId) {
      return;
    }

    const errors = getAdjustmentErrors(adjustmentValues);
    setAdjustmentErrors(errors);

    if (hasErrors(errors)) {
      return;
    }

    setIsSubmittingAdjustment(true);

    try {
      const response = await fetch(
        `/api/v1/payroll/runs/${runId}/items/${adjustmentItemId}/adjustments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            adjustmentType: adjustmentValues.adjustmentType,
            label: adjustmentValues.label.trim(),
            amount: Number.parseInt(adjustmentValues.amount.trim(), 10),
            notes: adjustmentValues.notes.trim() ? adjustmentValues.notes.trim() : null
          })
        }
      );

      const payload = (await response.json()) as AddPayrollAdjustmentResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? "Unable to add payroll adjustment.");
        return;
      }

      showToast("success", "Payroll adjustment applied.");
      setAdjustmentItemId(null);
      setAdjustmentValues(INITIAL_ADJUSTMENT_VALUES);
      setAdjustmentErrors({});
      runQuery.refresh();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Unable to add payroll adjustment."
      );
    } finally {
      setIsSubmittingAdjustment(false);
    }
  };

  const submitRejectReason = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedReason = rejectReason.trim();

    if (!trimmedReason) {
      setRejectReasonError("Rejection reason is required.");
      return;
    }

    if (trimmedReason.length > 500) {
      setRejectReasonError("Rejection reason must be 500 characters or fewer.");
      return;
    }

    setRejectReasonError(null);
    const success = await performRunAction("reject", trimmedReason);

    if (success) {
      setIsRejectDialogOpen(false);
      setRejectReason("");
      setRejectReasonError(null);
    }
  };

  const cancelRun = async () => {
    const confirmed = await confirm({
      title: "Cancel payroll run?",
      description:
        "This run will move to cancelled status and cannot continue through approvals or payments.",
      confirmLabel: "Cancel run",
      tone: "danger"
    });

    if (!confirmed) {
      return;
    }

    await performRunAction("cancel");
  };

  return (
    <>
      <PageHeader
        title="Payroll Run"
        description="Review payroll calculations, approvals, and item-level adjustments."
        actions={
          canCalculateRun || canGenerateStatements || canProcessPayments ? (
            <>
              {canCalculateRun ? (
                <button
                  type="button"
                  className="button button-accent"
                  onClick={calculateRun}
                  disabled={
                    isCalculating ||
                    isGeneratingStatements ||
                    isProcessingPayments ||
                    activeRunAction !== null
                  }
                >
                  {isCalculating ? "Calculating..." : "Calculate run"}
                </button>
              ) : null}

              {canGenerateStatements ? (
                <button
                  type="button"
                  className="button button-accent"
                  onClick={generateStatements}
                  disabled={
                    isGeneratingStatements ||
                    isCalculating ||
                    isProcessingPayments ||
                    activeRunAction !== null
                  }
                >
                  {isGeneratingStatements ? "Generating..." : "Generate statements"}
                </button>
              ) : null}

              {canProcessPayments ? (
                <button
                  type="button"
                  className="button button-accent"
                  onClick={processPayments}
                  disabled={
                    isProcessingPayments ||
                    isCalculating ||
                    isGeneratingStatements ||
                    activeRunAction !== null
                  }
                >
                  {isProcessingPayments ? "Processing..." : "Process payments"}
                </button>
              ) : null}
            </>
          ) : null
        }
      />

      {runQuery.isLoading ? itemTableSkeleton() : null}

      {!runQuery.isLoading && runQuery.errorMessage ? (
        <ErrorState
          title="Payroll run is unavailable"
          message={runQuery.errorMessage}
          onRetry={() => runQuery.refresh()}
        />
      ) : null}

      {!runQuery.isLoading && !runQuery.errorMessage && runQuery.data ? (
        <>
          <section className="payroll-status-timeline" aria-label="Payroll status timeline">
            {summarizeStatusStep(runQuery.data.run.status).map((step) => (
              <article
                key={step.step}
                className={`payroll-status-step payroll-status-step-${step.state}`}
              >
                <span className="payroll-status-step-dot" />
                <p className="payroll-status-step-label">{labelForPayrollRunStatus(step.step)}</p>
              </article>
            ))}
          </section>

          <section className="payroll-run-summary-grid" aria-label="Payroll run summary">
            <article className="metric-card">
              <p className="metric-label">Status</p>
              <p className="metric-value">
                <StatusBadge tone={toneForPayrollRunStatus(runQuery.data.run.status)}>
                  {labelForPayrollRunStatus(runQuery.data.run.status)}
                </StatusBadge>
              </p>
              <p className="metric-hint">
                Pay date{" "}
                <time
                  dateTime={runQuery.data.run.payDate}
                  title={formatDateTimeTooltip(runQuery.data.run.payDate)}
                >
                  {formatDate(runQuery.data.run.payDate)}
                </time>
              </p>
            </article>

            <article className="metric-card">
              <p className="metric-label">Gross Total</p>
              <p className="metric-value">
                <CurrencyDisplay
                  amount={getCurrencyTotal(runQuery.data.run.totalGross, runCurrency)}
                  currency={runCurrency}
                />
              </p>
              <p className="metric-hint">Calculated gross across items</p>
            </article>

            <article className="metric-card">
              <p className="metric-label">Net Total</p>
              <p className="metric-value">
                <CurrencyDisplay
                  amount={getCurrencyTotal(runQuery.data.run.totalNet, runCurrency)}
                  currency={runCurrency}
                />
              </p>
              <p className="metric-hint">All adjustments included</p>
            </article>

            <article className="metric-card">
              <p className="metric-label">Employees</p>
              <p className="metric-value numeric">{runQuery.data.run.employeeCount}</p>
              <p className="metric-hint">Items currently in this run</p>
            </article>
          </section>

          <section className="settings-card payroll-approval-card" aria-label="Approval workflow">
            <div className="payroll-approval-header">
              <h2 className="section-title">Approval workflow</h2>
              <StatusBadge tone={toneForPayrollRunStatus(runQuery.data.run.status)}>
                {labelForPayrollRunStatus(runQuery.data.run.status)}
              </StatusBadge>
            </div>

            <div className="payroll-approval-steps">
              <article className="payroll-approval-step">
                <p className="payroll-approval-step-title">Step 1: First approval</p>
                {runQuery.data.run.firstApprovedAt ? (
                  <>
                    <StatusBadge tone="success">Approved</StatusBadge>
                    <p className="settings-card-description">
                      {runQuery.data.run.firstApprovedBy ?? "--"} at{" "}
                      <time
                        dateTime={runQuery.data.run.firstApprovedAt}
                        title={formatDateTimeTooltip(runQuery.data.run.firstApprovedAt)}
                      >
                        {new Date(runQuery.data.run.firstApprovedAt).toLocaleString()}
                      </time>
                    </p>
                  </>
                ) : (
                  <StatusBadge tone={isPendingFirst ? "pending" : "draft"}>
                    {isPendingFirst ? "Awaiting first approval" : "Not approved yet"}
                  </StatusBadge>
                )}
              </article>

              <article className="payroll-approval-step">
                <p className="payroll-approval-step-title">Step 2: Final approval</p>
                {runQuery.data.run.finalApprovedAt ? (
                  <>
                    <StatusBadge tone="success">Approved</StatusBadge>
                    <p className="settings-card-description">
                      {runQuery.data.run.finalApprovedBy ?? "--"} at{" "}
                      <time
                        dateTime={runQuery.data.run.finalApprovedAt}
                        title={formatDateTimeTooltip(runQuery.data.run.finalApprovedAt)}
                      >
                        {new Date(runQuery.data.run.finalApprovedAt).toLocaleString()}
                      </time>
                    </p>
                  </>
                ) : (
                  <StatusBadge tone={isPendingFinal ? "pending" : "draft"}>
                    {isPendingFinal ? "Awaiting final approval" : "Not approved yet"}
                  </StatusBadge>
                )}
              </article>
            </div>

            <div className="settings-actions payroll-approval-actions">
              {canSubmitForApproval ? (
                <button
                  type="button"
                  className="button button-accent"
                  disabled={activeRunAction !== null || isCalculating}
                  onClick={() => {
                    void performRunAction("submit");
                  }}
                >
                  {activeRunAction === "submit" ? "Submitting..." : "Submit for approval"}
                </button>
              ) : null}

              {canApproveFirst ? (
                <button
                  type="button"
                  className="button button-accent"
                  disabled={activeRunAction !== null}
                  onClick={() => {
                    void performRunAction("approve_first");
                  }}
                >
                  {activeRunAction === "approve_first" ? "Approving..." : "Approve step 1"}
                </button>
              ) : null}

              {canApproveFinal ? (
                <button
                  type="button"
                  className="button button-accent"
                  disabled={activeRunAction !== null}
                  onClick={() => {
                    void performRunAction("approve_final");
                  }}
                >
                  {activeRunAction === "approve_final" ? "Approving..." : "Approve final"}
                </button>
              ) : null}

              {canRejectAtCurrentStep ? (
                <button
                  type="button"
                  className="button button-subtle"
                  disabled={activeRunAction !== null}
                  onClick={() => {
                    setRejectReasonError(null);
                    setRejectReason("");
                    setIsRejectDialogOpen(true);
                  }}
                >
                  Reject
                </button>
              ) : null}

              {canCancelRun ? (
                <button
                  type="button"
                  className="button button-subtle"
                  disabled={activeRunAction !== null}
                  onClick={() => {
                    void cancelRun();
                  }}
                >
                  {activeRunAction === "cancel" ? "Cancelling..." : "Cancel run"}
                </button>
              ) : null}
            </div>
          </section>

          {isApproved ? (
            <section className="payroll-lock-banner" aria-label="Payroll locked">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div>
                <p className="section-title">Payroll locked</p>
                <p className="settings-card-description">
                  Final approval completed. Snapshot is immutable and edits are blocked.
                </p>
              </div>
            </section>
          ) : null}

          {runQuery.data.flaggedCount > 0 ? (
            <section className="payroll-flag-banner">
              <StatusBadge tone="warning">
                {runQuery.data.flaggedCount} flagged item
                {runQuery.data.flaggedCount === 1 ? "" : "s"}
              </StatusBadge>
              <p className="settings-card-description">
                Review flagged rows before moving to approvals.
              </p>
            </section>
          ) : null}

          {sortedItems.length === 0 ? (
            <EmptyState
              title="No payroll items yet"
              description="Run calculation to populate employees in this payroll run."
              ctaLabel="Back to payroll"
              ctaHref="/payroll"
            />
          ) : (
            <section className="data-table-container" aria-label="Payroll run items">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>
                      <button
                        type="button"
                        className="table-sort-trigger"
                        onClick={() =>
                          setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
                        }
                      >
                        Name
                        <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      </button>
                    </th>
                    <th>Dept</th>
                    <th>Country</th>
                    <th>Gross</th>
                    <th>Deductions</th>
                    <th>Net</th>
                    <th>Withholding</th>
                    <th>Payment</th>
                    <th className="table-action-column">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((item) => (
                    <Fragment key={item.id}>
                      <tr
                        className={`data-table-row${item.flagged ? " payroll-flagged-row" : ""}`}
                      >
                        <td>
                          <p>{item.fullName}</p>
                          {item.flagged ? (
                            <p className="settings-card-description">
                              <StatusBadge tone="warning">Flagged</StatusBadge>
                            </p>
                          ) : null}
                        </td>
                        <td>{item.department ?? "--"}</td>
                        <td>
                          <p className="country-chip">
                            <span>{countryFlagFromCode(item.countryCode)}</span>
                            <span>{countryNameFromCode(item.countryCode)}</span>
                          </p>
                        </td>
                        <td>
                          <CurrencyDisplay amount={item.grossAmount} currency={item.payCurrency} />
                        </td>
                        <td>
                          <CurrencyDisplay amount={item.deductionTotal} currency={item.payCurrency} />
                        </td>
                        <td>
                          <CurrencyDisplay amount={item.netAmount} currency={item.payCurrency} />
                          {item.netVarianceAmount !== null ? (
                            <p className="payroll-net-variance-inline">
                              {signedAmountPrefix(item.netVarianceAmount)}
                              <CurrencyDisplay
                                amount={absoluteAmount(item.netVarianceAmount)}
                                currency={item.payCurrency}
                              />
                              {" vs previous"}
                            </p>
                          ) : null}
                        </td>
                        <td>
                          {item.withholdingApplied ? (
                            <StatusBadge tone="success">Withholding applied</StatusBadge>
                          ) : (
                            <StatusBadge tone="info">No withholding</StatusBadge>
                          )}
                        </td>
                        <td>
                          <span className="payment-status-inline">
                            {item.paymentStatus === "processing" ? (
                              <span className="payment-status-pulse" aria-hidden="true" />
                            ) : item.paymentStatus === "paid" ? (
                              <svg
                                className="payment-status-icon payment-status-icon-success"
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                              >
                                <path
                                  d="M5 12.5 9.2 16.7 19 7"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  fill="none"
                                />
                              </svg>
                            ) : item.paymentStatus === "failed" ? (
                              <svg
                                className="payment-status-icon payment-status-icon-error"
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                              >
                                <path
                                  d="M7 7l10 10M17 7L7 17"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                />
                              </svg>
                            ) : null}
                            <StatusBadge tone={paymentStatusTone(item.paymentStatus)}>
                              {paymentStatusLabel(item.paymentStatus)}
                            </StatusBadge>
                          </span>
                        </td>
                        <td className="table-row-action-cell">
                          <div className="payroll-row-actions">
                            {canManage &&
                            item.paymentStatus === "failed" &&
                            item.paymentId ? (
                              <button
                                type="button"
                                className="table-row-action"
                                disabled={
                                  isProcessingPayments ||
                                  retryingPaymentId === item.paymentId
                                }
                                onClick={() => {
                                  void retryPayment(item);
                                }}
                              >
                                {retryingPaymentId === item.paymentId
                                  ? "Retrying..."
                                  : "Retry payment"}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="table-row-action"
                              onClick={() =>
                                setExpandedItemId((current) =>
                                  current === item.id ? null : item.id
                                )
                              }
                            >
                              {expandedItemId === item.id ? "Collapse" : "Expand"}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {expandedItemId === item.id ? (
                        <tr className="payroll-item-expanded-row">
                          <td colSpan={9}>
                            <section className="payroll-item-expanded-content">
                              {item.flagged && item.flagReason ? (
                                <article className="payroll-item-flag-note">
                                  <StatusBadge tone="warning">Flag reason</StatusBadge>
                                  <p>{item.flagReason}</p>
                                </article>
                              ) : null}

                              <div className="payroll-item-detail-grid">
                                <article className="settings-card">
                                  <h3 className="section-title">Breakdown</h3>
                                  <p>
                                    Base salary:{" "}
                                    <CurrencyDisplay
                                      amount={item.baseSalaryAmount}
                                      currency={item.payCurrency}
                                    />
                                  </p>
                                  <ul className="payroll-allowance-list">
                                    {item.allowances.length > 0 ? (
                                      item.allowances.map((allowance, allowanceIndex) => (
                                        <li key={`${item.id}-allowance-${allowanceIndex}`}>
                                          <span>{allowance.label}</span>
                                          <CurrencyDisplay
                                            amount={allowance.amount}
                                            currency={allowance.currency}
                                          />
                                        </li>
                                      ))
                                    ) : (
                                      <li>No allowances</li>
                                    )}
                                  </ul>
                                  {item.withholdingApplied ? (
                                    <div className="payroll-deduction-section">
                                      <p className="form-label">Deductions</p>
                                      <ul className="payroll-deduction-list">
                                      {item.deductions.map((deduction, deductionIndex) => (
                                        <li key={`${item.id}-deduction-${deductionIndex}`}>
                                          <span>{deduction.ruleName}</span>
                                          <CurrencyDisplay
                                            amount={deduction.amount}
                                            currency={item.payCurrency}
                                          />
                                        </li>
                                      ))}
                                      {item.deductions.length === 0 ? <li>No deductions</li> : null}
                                      </ul>
                                    </div>
                                  ) : (
                                    <p className="settings-card-description">{contractorNote()}</p>
                                  )}
                                  <p>
                                    Payment status:{" "}
                                    <StatusBadge tone={paymentStatusTone(item.paymentStatus)}>
                                      {paymentStatusLabel(item.paymentStatus)}
                                    </StatusBadge>
                                  </p>
                                  <p className="settings-card-description">
                                    Payment reference: {item.paymentReference ?? "--"}
                                  </p>
                                  <p>
                                    Net pay:{" "}
                                    <CurrencyDisplay amount={item.netAmount} currency={item.payCurrency} />
                                  </p>
                                  {item.previousNetAmount !== null ? (
                                    <>
                                      <p className="settings-card-description">
                                        Previous period{" "}
                                        {item.previousPayPeriodEnd
                                          ? `(${formatDate(item.previousPayPeriodEnd)})`
                                          : ""}{" "}
                                        net:{" "}
                                        <CurrencyDisplay
                                          amount={item.previousNetAmount}
                                          currency={item.payCurrency}
                                        />
                                      </p>
                                      <p className="payroll-variance-line">
                                        <span className="numeric">Net change:</span>{" "}
                                        <span
                                          className={`numeric ${
                                            (item.netVarianceAmount ?? 0) > 0
                                              ? "payroll-variance-up"
                                              : (item.netVarianceAmount ?? 0) < 0
                                                ? "payroll-variance-down"
                                                : "payroll-variance-flat"
                                          }`}
                                        >
                                          {signedAmountPrefix(item.netVarianceAmount)}
                                          <CurrencyDisplay
                                            amount={absoluteAmount(item.netVarianceAmount)}
                                            currency={item.payCurrency}
                                          />
                                        </span>
                                      </p>
                                    </>
                                  ) : (
                                    <p className="settings-card-description">
                                      No previous payroll period found for comparison.
                                    </p>
                                  )}
                                </article>

                                <article className="settings-card">
                                  <h3 className="section-title">Adjustments</h3>
                                  <ul className="payroll-adjustment-list">
                                    {item.adjustments.length > 0 ? (
                                      item.adjustments.map((adjustment) => (
                                        <li key={adjustment.id}>
                                          <span>
                                            {adjustment.label} ({toSentenceCase(adjustment.type)})
                                          </span>
                                          <CurrencyDisplay
                                            amount={adjustment.amount}
                                            currency={item.payCurrency}
                                          />
                                        </li>
                                      ))
                                    ) : (
                                      <li>No adjustments</li>
                                    )}
                                  </ul>

                                  {canAdjustItems ? (
                                    adjustmentItemId === item.id ? (
                                      <form className="settings-form" onSubmit={submitAdjustment} noValidate>
                                        <label className="form-field" htmlFor={`adjustment-type-${item.id}`}>
                                          <span className="form-label">Type</span>
                                          <select
                                            id={`adjustment-type-${item.id}`}
                                            className={
                                              adjustmentErrors.adjustmentType
                                                ? "form-input form-input-error"
                                                : "form-input"
                                            }
                                            value={adjustmentValues.adjustmentType}
                                            onChange={(event) =>
                                              setAdjustmentValues((current) => ({
                                                ...current,
                                                adjustmentType: event.currentTarget
                                                  .value as PayrollAdjustmentType
                                              }))
                                            }
                                          >
                                            <option value="bonus">Bonus</option>
                                            <option value="deduction">Deduction</option>
                                            <option value="correction">Correction</option>
                                          </select>
                                          {adjustmentErrors.adjustmentType ? (
                                            <p className="form-field-error">
                                              {adjustmentErrors.adjustmentType}
                                            </p>
                                          ) : null}
                                        </label>

                                        <label className="form-field" htmlFor={`adjustment-label-${item.id}`}>
                                          <span className="form-label">Label</span>
                                          <input
                                            id={`adjustment-label-${item.id}`}
                                            className={
                                              adjustmentErrors.label
                                                ? "form-input form-input-error"
                                                : "form-input"
                                            }
                                            value={adjustmentValues.label}
                                            onChange={(event) =>
                                              setAdjustmentValues((current) => ({
                                                ...current,
                                                label: event.currentTarget.value
                                              }))
                                            }
                                          />
                                          {adjustmentErrors.label ? (
                                            <p className="form-field-error">{adjustmentErrors.label}</p>
                                          ) : null}
                                        </label>

                                        <label className="form-field" htmlFor={`adjustment-amount-${item.id}`}>
                                          <span className="form-label">Amount (smallest unit)</span>
                                          <input
                                            id={`adjustment-amount-${item.id}`}
                                            className={
                                              adjustmentErrors.amount
                                                ? "form-input form-input-error"
                                                : "form-input"
                                            }
                                            value={adjustmentValues.amount}
                                            onChange={(event) =>
                                              setAdjustmentValues((current) => ({
                                                ...current,
                                                amount: event.currentTarget.value
                                              }))
                                            }
                                          />
                                          {adjustmentErrors.amount ? (
                                            <p className="form-field-error">{adjustmentErrors.amount}</p>
                                          ) : null}
                                        </label>

                                        <label className="form-field" htmlFor={`adjustment-notes-${item.id}`}>
                                          <span className="form-label">Notes (optional)</span>
                                          <textarea
                                            id={`adjustment-notes-${item.id}`}
                                            className={
                                              adjustmentErrors.notes
                                                ? "form-input form-input-error"
                                                : "form-input"
                                            }
                                            rows={2}
                                            value={adjustmentValues.notes}
                                            onChange={(event) =>
                                              setAdjustmentValues((current) => ({
                                                ...current,
                                                notes: event.currentTarget.value
                                              }))
                                            }
                                          />
                                          {adjustmentErrors.notes ? (
                                            <p className="form-field-error">{adjustmentErrors.notes}</p>
                                          ) : null}
                                        </label>

                                        <div className="settings-actions">
                                          <button
                                            type="submit"
                                            className="button button-accent"
                                            disabled={isSubmittingAdjustment}
                                          >
                                            {isSubmittingAdjustment ? "Saving..." : "Apply adjustment"}
                                          </button>
                                          <button
                                            type="button"
                                            className="button button-subtle"
                                            onClick={() => {
                                              setAdjustmentItemId(null);
                                              setAdjustmentValues(INITIAL_ADJUSTMENT_VALUES);
                                              setAdjustmentErrors({});
                                            }}
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      </form>
                                    ) : (
                                      <button
                                        type="button"
                                        className="button button-accent"
                                        onClick={() => openAdjustmentPanel(item)}
                                      >
                                        Add adjustment
                                      </button>
                                    )
                                  ) : (
                                    <p className="settings-card-description">
                                      Adjustments are available only while status is calculated.
                                    </p>
                                  )}
                                </article>
                              </div>
                            </section>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      ) : null}

      {isRejectDialogOpen ? (
        <section className="payroll-reject-dialog" aria-label="Reject payroll run dialog">
          <button
            type="button"
            className="payroll-reject-backdrop"
            aria-label="Close reject dialog"
            onClick={() => {
              if (activeRunAction) {
                return;
              }

              setIsRejectDialogOpen(false);
              setRejectReasonError(null);
            }}
          />
          <article className="payroll-reject-panel">
            <h2 className="section-title">Reject payroll run</h2>
            <p className="settings-card-description">
              Add a reason. The run will move back to calculated.
            </p>

            <form className="settings-form" onSubmit={submitRejectReason} noValidate>
              <label className="form-field" htmlFor="reject-reason">
                <span className="form-label">Rejection reason</span>
                <textarea
                  id="reject-reason"
                  className={rejectReasonError ? "form-input form-input-error" : "form-input"}
                  value={rejectReason}
                  onChange={(event) => {
                    setRejectReason(event.currentTarget.value);
                    if (rejectReasonError) {
                      setRejectReasonError(null);
                    }
                  }}
                  rows={4}
                />
                {rejectReasonError ? (
                  <p className="form-field-error">{rejectReasonError}</p>
                ) : null}
              </label>

              <div className="settings-actions">
                <button
                  type="submit"
                  className="button button-accent"
                  disabled={activeRunAction === "reject"}
                >
                  {activeRunAction === "reject" ? "Rejecting..." : "Confirm reject"}
                </button>
                <button
                  type="button"
                  className="button button-subtle"
                  disabled={activeRunAction === "reject"}
                  onClick={() => {
                    setIsRejectDialogOpen(false);
                    setRejectReasonError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </article>
        </section>
      ) : null}

      {confirmDialog}

      {toasts.length > 0 ? (
        <section className="toast-region" aria-live="polite" aria-label="Payroll toasts">
          {toasts.map((toast) => (
            <article key={toast.id} className={`toast-message toast-message-${toast.variant}`}>
              <p>{toast.message}</p>
              <button
                type="button"
                className="toast-dismiss"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss toast"
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
