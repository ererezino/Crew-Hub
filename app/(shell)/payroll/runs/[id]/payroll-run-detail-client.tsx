"use client";

import {
  Fragment,
  type FormEvent,
  useMemo,
  useState
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { z } from "zod";

type AppLocale = "en" | "fr";

import { EmptyState } from "../../../../../components/shared/empty-state";
import { ErrorState } from "../../../../../components/shared/error-state";
import { PageHeader } from "../../../../../components/shared/page-header";
import { StatusBadge } from "../../../../../components/shared/status-badge";
import { CurrencyDisplay } from "../../../../../components/ui/currency-display";
import { useConfirmAction } from "../../../../../hooks/use-confirm-action";
import { usePayrollRunDetail } from "../../../../../hooks/use-payroll-runs";
import { countryFlagFromCode, countryNameFromCode } from "../../../../../lib/countries";
import { formatDate, formatDateTimeTooltip } from "../../../../../lib/datetime";
import {
  getCurrencyTotal,
  getPrimaryCurrency,
  toneForPayrollRunStatus
} from "../../../../../lib/payroll/runs";
import type { GeneratePayslipsResponse } from "../../../../../types/payslips";
import type {
  AddPayrollAdjustmentResponse,
  CalculatePayrollRunResponse,
  PayrollAdjustmentType,
  PayrollRunItem,
  PayrollRunActionResponse,
  PayrollRunStatus
} from "../../../../../types/payroll-runs";
import { humanizeError } from "@/lib/errors";

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

function createAdjustmentSchema(td: (key: string) => string) {
  return z.object({
    adjustmentType: z.enum(["bonus", "deduction", "correction"]),
    label: z.string().trim().min(1, td("adjustmentValidation.labelRequired")).max(120, td("adjustmentValidation.labelTooLong")),
    amount: z.string().trim().regex(/^-?\d+$/, td("adjustmentValidation.amountWholeNumber")),
    notes: z.string().max(300, td("adjustmentValidation.notesTooLong"))
  });
}

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

function paymentStatusTone(
  status: PayrollRunItem["paymentStatus"]
): "success" | "error" | "processing" | "warning" | "draft" {
  void status;
  return "draft";
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

function getAdjustmentErrors(values: AdjustmentFormValues, td: (key: string) => string): AdjustmentFormErrors {
  const schema = createAdjustmentSchema(td);
  const parsed = schema.safeParse(values);

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
      amount: td("adjustmentValidation.amountOutOfRange")
    };
  }

  if (values.adjustmentType === "correction" && integerAmount === 0) {
    return {
      amount: td("adjustmentValidation.correctionNotZero")
    };
  }

  if (
    (values.adjustmentType === "bonus" || values.adjustmentType === "deduction") &&
    integerAmount <= 0
  ) {
    return {
      amount: td("adjustmentValidation.bonusDeductionPositive")
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
  const t = useTranslations('payrollRunDetail');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const td = t as (key: string, params?: Record<string, unknown>) => string;

  const runQuery = usePayrollRunDetail({ runId, enabled: true });
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isGeneratingStatements, setIsGeneratingStatements] = useState(false);
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

  const calculateRun = async () => {
    setIsCalculating(true);

    try {
      const response = await fetch(`/api/v1/payroll/runs/${runId}/calculate`, {
        method: "POST"
      });

      const payload = (await response.json()) as CalculatePayrollRunResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? td("toast.unableToCalculate"));
        return;
      }

      showToast(
        "success",
        td("toast.calculationComplete", { count: payload.data.employeeCount })
      );
      runQuery.refresh();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : td("toast.unableToCalculate"));
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
        showToast("error", payload.error?.message ?? td("toast.unableToGenerateStatements"));
        return;
      }

      if (payload.data.generatedCount > 0) {
        showToast(
          "success",
          td("toast.statementsGenerated", { count: payload.data.generatedCount })
        );
      } else {
        showToast("info", td("toast.noStatementsGenerated"));
      }

      if (payload.data.skippedCount > 0) {
        showToast(
          "info",
          td("toast.statementsSkipped", { count: payload.data.skippedCount })
        );
      }

      runQuery.refresh();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : td("toast.unableToGenerateStatements")
      );
    } finally {
      setIsGeneratingStatements(false);
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
        showToast("error", payload.error?.message ?? td("toast.unableToUpdateApproval"));
        return false;
      }

      if (action === "submit") {
        showToast("success", td("toast.submittedForApproval"));
      } else if (action === "approve_first") {
        showToast("success", td("toast.firstApprovalComplete"));
      } else if (action === "approve_final") {
        showToast("success", td("toast.finalApprovalComplete"));
      } else if (action === "reject") {
        showToast("info", td("toast.runRejected"));
      } else if (action === "cancel") {
        showToast("info", td("toast.runCancelled"));
      }

      if (action === "approve_final") {
        setAdjustmentItemId(null);
      }

      runQuery.refresh();
      return true;
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : td("toast.unableToUpdateApproval"));
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

    const errors = getAdjustmentErrors(adjustmentValues, td);
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
        showToast("error", payload.error?.message ?? td("toast.unableToAddAdjustment"));
        return;
      }

      showToast("success", td("toast.adjustmentApplied"));
      setAdjustmentItemId(null);
      setAdjustmentValues(INITIAL_ADJUSTMENT_VALUES);
      setAdjustmentErrors({});
      runQuery.refresh();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : td("toast.unableToAddAdjustment")
      );
    } finally {
      setIsSubmittingAdjustment(false);
    }
  };

  const submitRejectReason = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedReason = rejectReason.trim();

    if (!trimmedReason) {
      setRejectReasonError(td("rejectDialog.reasonRequired"));
      return;
    }

    if (trimmedReason.length > 500) {
      setRejectReasonError(td("rejectDialog.reasonTooLong"));
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
      title: td("cancelDialog.title"),
      description: td("cancelDialog.description"),
      confirmLabel: td("cancelDialog.confirmLabel"),
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
        title={t('title')}
        description={t('description')}
        actions={
          canCalculateRun || canGenerateStatements ? (
            <>
              {canCalculateRun ? (
                <button
                  type="button"
                  className="button button-accent"
                  onClick={calculateRun}
                  disabled={
                    isCalculating ||
                    isGeneratingStatements ||
                    activeRunAction !== null
                  }
                >
                  {isCalculating ? t('actions.calculating') : t('actions.calculateRun')}
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
                    activeRunAction !== null
                  }
                >
                  {isGeneratingStatements ? t('actions.generating') : t('actions.generateStatements')}
                </button>
              ) : null}
            </>
          ) : null
        }
      />

      {runQuery.isLoading ? itemTableSkeleton() : null}

      {!runQuery.isLoading && runQuery.errorMessage ? (
        <ErrorState
          title={t('errorTitle')}
          message={runQuery.errorMessage}
          onRetry={() => runQuery.refresh()}
        />
      ) : null}

      {!runQuery.isLoading && !runQuery.errorMessage && runQuery.data ? (
        <>
          <section className="payroll-status-timeline" aria-label={t('title')}>
            {summarizeStatusStep(runQuery.data.run.status).map((step) => (
              <article
                key={step.step}
                className={`payroll-status-step payroll-status-step-${step.state}`}
              >
                <span className="payroll-status-step-dot" />
                <p className="payroll-status-step-label">{td(`statusTimeline.${step.step}`)}</p>
              </article>
            ))}
          </section>

          <section className="payroll-run-summary-grid" aria-label={t('title')}>
            <article className="metric-card">
              <p className="metric-label">{t('metrics.status')}</p>
              <p className="metric-value">
                <StatusBadge tone={toneForPayrollRunStatus(runQuery.data.run.status)}>
                  {td(`statusTimeline.${runQuery.data.run.status}`)}
                </StatusBadge>
              </p>
              <p className="metric-hint">
                {t('metrics.payDate')}{" "}
                <time
                  dateTime={runQuery.data.run.payDate}
                  title={formatDateTimeTooltip(runQuery.data.run.payDate, locale)}
                >
                  {formatDate(runQuery.data.run.payDate, locale)}
                </time>
              </p>
            </article>

            <article className="metric-card">
              <p className="metric-label">{t('metrics.grossTotal')}</p>
              <p className="metric-value">
                <CurrencyDisplay
                  amount={getCurrencyTotal(runQuery.data.run.totalGross, runCurrency)}
                  currency={runCurrency}
                />
              </p>
              <p className="metric-hint">{t('metrics.grossTotalHint')}</p>
            </article>

            <article className="metric-card">
              <p className="metric-label">{t('metrics.netTotal')}</p>
              <p className="metric-value">
                <CurrencyDisplay
                  amount={getCurrencyTotal(runQuery.data.run.totalNet, runCurrency)}
                  currency={runCurrency}
                />
              </p>
              <p className="metric-hint">{t('metrics.netTotalHint')}</p>
            </article>

            <article className="metric-card">
              <p className="metric-label">{t('metrics.employees')}</p>
              <p className="metric-value numeric">{runQuery.data.run.employeeCount}</p>
              <p className="metric-hint">{t('metrics.employeesHint')}</p>
            </article>
          </section>

          <section className="settings-card payroll-approval-card" aria-label={t('approval.title')}>
            <div className="payroll-approval-header">
              <h2 className="section-title">{t('approval.title')}</h2>
              <StatusBadge tone={toneForPayrollRunStatus(runQuery.data.run.status)}>
                {td(`statusTimeline.${runQuery.data.run.status}`)}
              </StatusBadge>
            </div>

            <div className="payroll-approval-steps">
              <article className="payroll-approval-step">
                <p className="payroll-approval-step-title">{t('approval.step1Title')}</p>
                {runQuery.data.run.firstApprovedAt ? (
                  <>
                    <StatusBadge tone="success">{tCommon('status.approved')}</StatusBadge>
                    <p className="settings-card-description">
                      {t.rich('approval.approvedByAt', {
                        name: runQuery.data.run.firstApprovedBy ?? "--",
                        date: formatDate(runQuery.data.run.firstApprovedAt, locale),
                        time: (chunks) => (
                          <time
                            dateTime={runQuery.data?.run.firstApprovedAt ?? ""}
                            title={formatDateTimeTooltip(runQuery.data?.run.firstApprovedAt ?? "", locale)}
                          >
                            {chunks}
                          </time>
                        )
                      })}
                    </p>
                  </>
                ) : (
                  <StatusBadge tone={isPendingFirst ? "pending" : "draft"}>
                    {isPendingFirst ? t('approval.awaitingFirst') : t('approval.notApprovedYet')}
                  </StatusBadge>
                )}
              </article>

              <article className="payroll-approval-step">
                <p className="payroll-approval-step-title">{t('approval.step2Title')}</p>
                {runQuery.data.run.finalApprovedAt ? (
                  <>
                    <StatusBadge tone="success">{tCommon('status.approved')}</StatusBadge>
                    <p className="settings-card-description">
                      {t.rich('approval.approvedByAt', {
                        name: runQuery.data.run.finalApprovedBy ?? "--",
                        date: formatDate(runQuery.data.run.finalApprovedAt, locale),
                        time: (chunks) => (
                          <time
                            dateTime={runQuery.data?.run.finalApprovedAt ?? ""}
                            title={formatDateTimeTooltip(runQuery.data?.run.finalApprovedAt ?? "", locale)}
                          >
                            {chunks}
                          </time>
                        )
                      })}
                    </p>
                  </>
                ) : (
                  <StatusBadge tone={isPendingFinal ? "pending" : "draft"}>
                    {isPendingFinal ? t('approval.awaitingFinal') : t('approval.notApprovedYet')}
                  </StatusBadge>
                )}
              </article>
            </div>

            <div className="settings-actions payroll-approval-actions">
              {canSubmitForApproval ? (
                <button
                  type="button"
                  className="button"
                  disabled={activeRunAction !== null || isCalculating}
                  onClick={() => {
                    void performRunAction("submit");
                  }}
                >
                  {activeRunAction === "submit" ? t('actions.submitting') : t('actions.submitForApproval')}
                </button>
              ) : null}

              {canApproveFirst ? (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={activeRunAction !== null}
                  onClick={() => {
                    void performRunAction("approve_first");
                  }}
                >
                  {activeRunAction === "approve_first" ? t('actions.approving') : t('actions.approveStep1')}
                </button>
              ) : null}

              {canApproveFinal ? (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={activeRunAction !== null}
                  onClick={() => {
                    void performRunAction("approve_final");
                  }}
                >
                  {activeRunAction === "approve_final" ? t('actions.approving') : t('actions.approveFinal')}
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
                  {tCommon('status.rejected')}
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
                  {activeRunAction === "cancel" ? t('actions.cancelling') : t('actions.cancelRun')}
                </button>
              ) : null}
            </div>
          </section>

          {isApproved ? (
            <section className="payroll-lock-banner" aria-label={t('locked.title')}>
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
                <p className="section-title">{t('locked.title')}</p>
                <p className="settings-card-description">
                  {t('locked.description')}
                </p>
              </div>
            </section>
          ) : null}

          {runQuery.data.flaggedCount > 0 ? (
            <section className="payroll-flag-banner">
              <StatusBadge tone="warning">
                {td('flagged.flaggedItems', { count: runQuery.data.flaggedCount })}
              </StatusBadge>
              <p className="settings-card-description">
                {t('flagged.reviewFlagged')}
              </p>
            </section>
          ) : null}

          {sortedItems.length === 0 ? (
            <EmptyState
              title={t('emptyState.title')}
              description={t('emptyState.description')}
              ctaLabel={t('emptyState.backToPayroll')}
              ctaHref="/payroll"
            />
          ) : (
            <section className="data-table-container" aria-label={t('title')}>
              <p className="settings-card-description">
                {t('disbursementNotice')}
              </p>
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
                        {t('table.name')}
                        <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      </button>
                    </th>
                    <th>{t('table.dept')}</th>
                    <th>{t('table.country')}</th>
                    <th>{t('table.gross')}</th>
                    <th>{t('table.deductions')}</th>
                    <th>{t('table.net')}</th>
                    <th>{t('table.withholding')}</th>
                    <th>{t('table.disbursement')}</th>
                    <th className="table-action-column">{t('table.actionsColumn')}</th>
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
                              <StatusBadge tone="warning">{td('flagged.flaggedItems', { count: 1 })}</StatusBadge>
                            </p>
                          ) : null}
                        </td>
                        <td>{item.department ?? "--"}</td>
                        <td>
                          <p className="country-chip">
                            <span>{countryFlagFromCode(item.countryCode)}</span>
                            <span>{countryNameFromCode(item.countryCode, locale)}</span>
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
                              {" "}{t('breakdown.vsPrevious')}
                            </p>
                          ) : null}
                        </td>
                        <td>
                          {item.withholdingApplied ? (
                            <StatusBadge tone="success">{t('withholding.applied')}</StatusBadge>
                          ) : (
                            <StatusBadge tone="info">{t('withholding.none')}</StatusBadge>
                          )}
                        </td>
                        <td>
                          <span className="payment-status-inline">
                            <StatusBadge tone={paymentStatusTone(item.paymentStatus)}>
                              {t('disbursementStatus')}
                            </StatusBadge>
                          </span>
                        </td>
                        <td className="table-row-action-cell">
                          <div className="payroll-row-actions">
                            <button
                              type="button"
                              className="table-row-action"
                              onClick={() =>
                                setExpandedItemId((current) =>
                                  current === item.id ? null : item.id
                                )
                              }
                            >
                              {expandedItemId === item.id ? t('table.collapse') : t('table.expand')}
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
                                  <StatusBadge tone="warning">{t('flagged.flagReason')}</StatusBadge>
                                  <p>{item.flagReason}</p>
                                </article>
                              ) : null}

                              <div className="payroll-item-detail-grid">
                                <article className="settings-card">
                                  <h3 className="section-title">{t('breakdown.title')}</h3>
                                  <p>
                                    {t('breakdown.baseSalary')}{" "}
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
                                      <li>{t('breakdown.noAllowances')}</li>
                                    )}
                                  </ul>
                                  {item.withholdingApplied ? (
                                    <div className="payroll-deduction-section">
                                      <p className="form-label">{t('breakdown.deductionsLabel')}</p>
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
                                      {item.deductions.length === 0 ? <li>{t('breakdown.noDeductions')}</li> : null}
                                      </ul>
                                    </div>
                                  ) : (
                                    <p className="settings-card-description">{t('breakdown.contractorNote')}</p>
                                  )}
                                  <p>
                                    {t('breakdown.disbursementExecution')}{" "}
                                    <StatusBadge tone={paymentStatusTone(item.paymentStatus)}>
                                      {t('disbursementStatus')}
                                    </StatusBadge>
                                  </p>
                                  <p className="settings-card-description">
                                    {t('breakdown.noLivePayoutRails')}
                                  </p>
                                  <p>
                                    {t('breakdown.netPay')}{" "}
                                    <CurrencyDisplay amount={item.netAmount} currency={item.payCurrency} />
                                  </p>
                                  {item.previousNetAmount !== null ? (
                                    <>
                                      <p className="settings-card-description">
                                        {t('breakdown.previousPeriodNet')}{" "}
                                        {item.previousPayPeriodEnd
                                          ? `(${formatDate(item.previousPayPeriodEnd, locale)})`
                                          : ""}{" "}
                                        <CurrencyDisplay
                                          amount={item.previousNetAmount}
                                          currency={item.payCurrency}
                                        />
                                      </p>
                                      <p className="payroll-variance-line">
                                        <span className="numeric">{t('breakdown.netChange')}</span>{" "}
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
                                      {t('breakdown.noPreviousPeriod')}
                                    </p>
                                  )}
                                </article>

                                <article className="settings-card">
                                  <h3 className="section-title">{t('adjustments.title')}</h3>
                                  <ul className="payroll-adjustment-list">
                                    {item.adjustments.length > 0 ? (
                                      item.adjustments.map((adjustment) => (
                                        <li key={adjustment.id}>
                                          <span>
                                            {adjustment.label} ({td(`adjustments.${adjustment.type}`)})
                                          </span>
                                          <CurrencyDisplay
                                            amount={adjustment.amount}
                                            currency={item.payCurrency}
                                          />
                                        </li>
                                      ))
                                    ) : (
                                      <li>{t('adjustments.noAdjustments')}</li>
                                    )}
                                  </ul>

                                  {canAdjustItems ? (
                                    adjustmentItemId === item.id ? (
                                      <form className="settings-form" onSubmit={submitAdjustment} noValidate>
                                        <label className="form-field" htmlFor={`adjustment-type-${item.id}`}>
                                          <span className="form-label">{t('adjustments.typeLabel')}</span>
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
                                            <option value="bonus">{t('adjustments.bonus')}</option>
                                            <option value="deduction">{t('adjustments.deduction')}</option>
                                            <option value="correction">{t('adjustments.correction')}</option>
                                          </select>
                                          {adjustmentErrors.adjustmentType ? (
                                            <p className="form-field-error">
                                              {adjustmentErrors.adjustmentType}
                                            </p>
                                          ) : null}
                                        </label>

                                        <label className="form-field" htmlFor={`adjustment-label-${item.id}`}>
                                          <span className="form-label">{t('adjustments.labelField')}</span>
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
                                          <span className="form-label">{t('adjustments.amountField')}</span>
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
                                          <span className="form-label">{t('adjustments.notesField')}</span>
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
                                            className="button"
                                            disabled={isSubmittingAdjustment}
                                          >
                                            {isSubmittingAdjustment ? t('adjustments.applying') : t('adjustments.applyAdjustment')}
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
                                            {tCommon('cancel')}
                                          </button>
                                        </div>
                                      </form>
                                    ) : (
                                      <button
                                        type="button"
                                        className="button"
                                        onClick={() => openAdjustmentPanel(item)}
                                      >
                                        {t('adjustments.addAdjustment')}
                                      </button>
                                    )
                                  ) : (
                                    <p className="settings-card-description">
                                      {t('adjustments.unavailable')}
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
        <section className="payroll-reject-dialog" aria-label={t('rejectDialog.title')}>
          <button
            type="button"
            className="payroll-reject-backdrop"
            aria-label={tCommon('close')}
            onClick={() => {
              if (activeRunAction) {
                return;
              }

              setIsRejectDialogOpen(false);
              setRejectReasonError(null);
            }}
          />
          <article className="payroll-reject-panel">
            <h2 className="section-title">{t('rejectDialog.title')}</h2>
            <p className="settings-card-description">
              {t('rejectDialog.description')}
            </p>

            <form className="settings-form" onSubmit={submitRejectReason} noValidate>
              <label className="form-field" htmlFor="reject-reason">
                <span className="form-label">{t('rejectDialog.rejectionReason')}</span>
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
                  className="button button-danger"
                  disabled={activeRunAction === "reject"}
                >
                  {activeRunAction === "reject" ? t('rejectDialog.rejecting') : t('rejectDialog.confirmReject')}
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
                  {tCommon('cancel')}
                </button>
              </div>
            </form>
          </article>
        </section>
      ) : null}

      {confirmDialog}

      {toasts.length > 0 ? (
        <section className="toast-region" aria-live="polite" aria-label={t('title')}>
          {toasts.map((toast) => (
            <article key={toast.id} className={`toast-message toast-message-${toast.variant}`}>
              <p>{toast.message}</p>
              <button
                type="button"
                className="toast-dismiss"
                onClick={() => dismissToast(toast.id)}
                aria-label={t('dismissToast')}
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
