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

import { CsvImportDialog } from "../../../../../components/payroll/csv-import-dialog";
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
  CreateAmendmentRunResponse,
  EditPayrollItemResponse,
  MarkCyclePaidResponse,
  PayrollAdjustmentType,
  PayrollCycle,
  PayrollRunAllowance,
  PayrollRunItem,
  PayrollRunActionResponse,
  PayrollRunStatus,
  PreparePayoutResponse
} from "../../../../../types/payroll-runs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../../components/ui/select";
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
  "submitted",
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

type EditFormAllowance = {
  key: string;
  label: string;
  amount: string;
  isTaxable: boolean;
};

type EditFormValues = {
  baseSalaryAmount: string;
  currency: string;
  allowances: EditFormAllowance[];
  reason: string;
};

type EditFormErrors = {
  baseSalaryAmount?: string;
  currency?: string;
  allowances?: string;
  reason?: string;
};

function createEditFormKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function editFormFromItem(item: PayrollRunItem): EditFormValues {
  return {
    baseSalaryAmount: String(item.baseSalaryAmount),
    currency: item.currency,
    allowances: item.allowances.map((a) => ({
      key: createEditFormKey(),
      label: a.label,
      amount: String(a.amount),
      isTaxable: a.isTaxable
    })),
    reason: ""
  };
}

const CURRENCY_REGEX = /^[A-Z]{3}$/;

function isManuallyEdited(item: PayrollRunItem): boolean {
  return item.flagged && (item.flagReason?.includes("Manually edited") ?? false);
}

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
  switch (status) {
    case "paid":
      return "success";
    case "processing":
      return "processing";
    case "failed":
      return "error";
    case "cancelled":
      return "warning";
    case "pending":
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

/** Map snake_case PayrollRunStatus → camelCase i18n key under statusTimeline */
function statusToTimelineKey(status: PayrollRunStatus): string {
  const map: Record<string, string> = {
    draft: "draft",
    calculated: "calculated",
    submitted: "submitted",
    rejected: "rejected",
    approved: "approved",
    processing: "processing",
    completed: "completed",
  };
  return map[status] ?? status;
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
  canApprove
}: {
  runId: string;
  viewerUserId: string;
  canManage: boolean;
  canApprove: boolean;
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
    null | "submit" | "approve" | "reject" | "cancel" | "reopen" | "mark_processing" | "mark_completed"
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
  const [isReopenDialogOpen, setIsReopenDialogOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenReasonError, setReopenReasonError] = useState<string | null>(null);
  const [isCsvImportOpen, setIsCsvImportOpen] = useState(false);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [editFormValues, setEditFormValues] = useState<EditFormValues | null>(null);
  const [editFormErrors, setEditFormErrors] = useState<EditFormErrors>({});
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isPreparingPayout, setIsPreparingPayout] = useState(false);
  const [activeCycleActionId, setActiveCycleActionId] = useState<string | null>(null);
  const [markingPaidCycleId, setMarkingPaidCycleId] = useState<string | null>(null);
  const [isCreatingAmendment, setIsCreatingAmendment] = useState(false);
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
  const isProcessing = run?.status === "processing";
  const isCompleted = run?.status === "completed";
  const isCalculated = run?.status === "calculated";
  const isSubmitted = run?.status === "submitted";
  const isRejected = run?.status === "rejected";
  const canCalculateRun = canManage && (run?.status === "draft" || isCalculated || isRejected);
  const canImportCsv = canManage && (run?.status === "draft" || isCalculated || isRejected);
  const canGenerateStatements = canManage && isApproved;
  const canAdjustItems = canManage && (isCalculated || isRejected);
  const canSubmitForApproval = canManage && (isCalculated || isRejected);
  /** Resolve who submitted the run for separation-of-duties checks. */
  const runSubmittedBy: string | null = run?.submittedBy ?? run?.initiatedBy ?? null;
  const canApproveRun =
    canApprove &&
    isSubmitted &&
    runSubmittedBy !== viewerUserId;
  const canRejectRun =
    canApprove &&
    isSubmitted &&
    runSubmittedBy !== viewerUserId;
  const canCancelRun =
    canManage &&
    (run ? run.status !== "approved" && run.status !== "cancelled" && run.status !== "processing" && run.status !== "completed" : false);
  const canReopenRun = canApprove && (isApproved || isProcessing);
  const canMarkProcessing = canManage && isApproved;
  const canMarkCompleted = canManage && isProcessing;
  const canEditItems = canManage && (run?.status === "draft" || isCalculated || isRejected);
  const cycles: PayrollCycle[] = runQuery.data?.cycles ?? [];
  const activeCycles = cycles.filter((c) => c.status !== "cancelled");
  const canPreparePayout = canManage && (isApproved || isProcessing);
  const hasCycles = activeCycles.length > 0;
  const allCyclesPaid = activeCycles.length > 0 && activeCycles.every((c) => c.status === "paid");
  const canCreateAmendment = canApprove && isCompleted && allCyclesPaid;

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
    action: "submit" | "approve" | "reject" | "cancel" | "reopen" | "mark_processing" | "mark_completed",
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
      } else if (action === "approve") {
        showToast("success", td("toast.approvalComplete"));
      } else if (action === "reject") {
        showToast("info", td("toast.runRejected"));
      } else if (action === "cancel") {
        showToast("info", td("toast.runCancelled"));
      } else if (action === "reopen") {
        showToast("info", td("toast.runReopened"));
      } else if (action === "mark_processing") {
        showToast("success", td("toast.runMarkedProcessing"));
      } else if (action === "mark_completed") {
        showToast("success", td("toast.runMarkedCompleted"));
      }

      if (action === "approve") {
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

  const openEditPanel = (item: PayrollRunItem) => {
    setEditItemId(item.id);
    setEditFormValues(editFormFromItem(item));
    setEditFormErrors({});
  };

  const closeEditPanel = () => {
    setEditItemId(null);
    setEditFormValues(null);
    setEditFormErrors({});
  };

  const submitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!editItemId || !editFormValues) {
      return;
    }

    /* Validate */
    const errors: EditFormErrors = {};
    const trimmedReason = editFormValues.reason.trim();

    if (!trimmedReason) {
      errors.reason = td("editItem.reasonRequired");
    } else if (trimmedReason.length > 500) {
      errors.reason = td("editItem.reasonTooLong");
    }

    const baseSalaryInt = /^-?\d+$/.test(editFormValues.baseSalaryAmount.trim())
      ? Number.parseInt(editFormValues.baseSalaryAmount.trim(), 10)
      : null;

    if (baseSalaryInt === null || baseSalaryInt <= 0 || !Number.isSafeInteger(baseSalaryInt)) {
      errors.baseSalaryAmount = td("editItem.baseSalaryPositive");
    }

    if (!CURRENCY_REGEX.test(editFormValues.currency.trim().toUpperCase())) {
      errors.currency = td("editItem.currencyInvalid");
    }

    for (const allowance of editFormValues.allowances) {
      if (!allowance.label.trim()) {
        errors.allowances = td("editItem.allowanceLabelRequired");
        break;
      }
      const aInt = /^-?\d+$/.test(allowance.amount.trim())
        ? Number.parseInt(allowance.amount.trim(), 10)
        : null;
      if (aInt === null || aInt < 0 || !Number.isSafeInteger(aInt)) {
        errors.allowances = td("editItem.allowanceAmountInvalid");
        break;
      }
    }

    setEditFormErrors(errors);

    if (Object.values(errors).some(Boolean)) {
      return;
    }

    /* Build payload — only send changed fields */
    const currentItem = sortedItems.find((item) => item.id === editItemId);
    if (!currentItem) return;

    const payload: Record<string, unknown> = {
      reason: trimmedReason
    };

    if (baseSalaryInt !== currentItem.baseSalaryAmount) {
      payload.baseSalaryAmount = baseSalaryInt;
    }

    const normalizedCurrency = editFormValues.currency.trim().toUpperCase();
    if (normalizedCurrency !== currentItem.currency) {
      payload.currency = normalizedCurrency;
    }

    const newAllowances = editFormValues.allowances.map((a) => ({
      label: a.label.trim(),
      amount: Number.parseInt(a.amount.trim(), 10),
      currency: normalizedCurrency,
      isTaxable: a.isTaxable
    }));

    const allowancesChanged =
      newAllowances.length !== currentItem.allowances.length ||
      newAllowances.some(
        (a, i) =>
          a.label !== currentItem.allowances[i]?.label ||
          a.amount !== currentItem.allowances[i]?.amount ||
          a.isTaxable !== currentItem.allowances[i]?.isTaxable
      );

    if (allowancesChanged) {
      payload.allowances = newAllowances;
    }

    /* Must have at least one changed field */
    if (!payload.baseSalaryAmount && !payload.currency && !payload.allowances) {
      setEditFormErrors({ reason: td("editItem.noFieldsChanged") });
      return;
    }

    setIsSubmittingEdit(true);

    try {
      const response = await fetch(
        `/api/v1/payroll/runs/${runId}/items/${editItemId}/edit`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }
      );

      const result = (await response.json()) as EditPayrollItemResponse;

      if (!response.ok || !result.data) {
        showToast("error", result.error?.message ?? td("toast.editItemFailed"));
        return;
      }

      showToast("success", td("toast.editItemSuccess"));
      closeEditPanel();
      runQuery.refresh();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : td("toast.editItemFailed")
      );
    } finally {
      setIsSubmittingEdit(false);
    }
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

  const submitReopenReason = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedReason = reopenReason.trim();

    if (!trimmedReason) {
      setReopenReasonError(td("reopenDialog.reasonRequired"));
      return;
    }

    if (trimmedReason.length > 500) {
      setReopenReasonError(td("reopenDialog.reasonTooLong"));
      return;
    }

    setReopenReasonError(null);
    const success = await performRunAction("reopen", trimmedReason);

    if (success) {
      setIsReopenDialogOpen(false);
      setReopenReason("");
      setReopenReasonError(null);
    }
  };

  const markProcessing = async () => {
    const confirmed = await confirm({
      title: td("confirmMarkProcessing.title"),
      description: td("confirmMarkProcessing.description"),
      confirmLabel: td("confirmMarkProcessing.confirmLabel"),
      tone: "default"
    });

    if (!confirmed) return;
    await performRunAction("mark_processing");
  };

  const markCompleted = async () => {
    const confirmed = await confirm({
      title: td("confirmMarkCompleted.title"),
      description: td("confirmMarkCompleted.description"),
      confirmLabel: td("confirmMarkCompleted.confirmLabel"),
      tone: "danger"
    });

    if (!confirmed) return;
    await performRunAction("mark_completed");
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

  const preparePayout = async () => {
    const confirmed = await confirm({
      title: td("confirmPreparePayout.title"),
      description: td("confirmPreparePayout.description"),
      confirmLabel: td("confirmPreparePayout.confirmLabel"),
      tone: "default"
    });
    if (!confirmed) return;

    setIsPreparingPayout(true);
    try {
      const response = await fetch(`/api/v1/payroll/runs/${runId}/cycles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });

      const payload = (await response.json()) as PreparePayoutResponse;

      if (!response.ok || !payload.data) {
        // Handle held payment details — prompt for override
        if (payload.error?.code === "PAYMENT_DETAILS_HELD" && payload.error.details?.heldEmployeeIds) {
          const heldIds = payload.error.details.heldEmployeeIds as string[];
          const overrideConfirmed = await confirm({
            title: td("confirmHoldOverride.title"),
            description: td("confirmHoldOverride.description", { count: heldIds.length }),
            confirmLabel: td("confirmHoldOverride.confirmLabel"),
            tone: "danger"
          });

          if (!overrideConfirmed) return;

          // Prompt for reason
          const reason = window.prompt(td("confirmHoldOverride.reasonPrompt"));
          if (!reason?.trim()) return;

          // Re-send with hold overrides
          const overrideResponse = await fetch(`/api/v1/payroll/runs/${runId}/cycles`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              holdOverrides: heldIds.map((id) => ({ employeeId: id, reason: reason.trim() }))
            })
          });

          const overridePayload = (await overrideResponse.json()) as PreparePayoutResponse;

          if (!overrideResponse.ok || !overridePayload.data) {
            showToast("error", overridePayload.error?.message ?? td("toast.payoutPrepFailed"));
            return;
          }

          showToast("success", td("toast.payoutPrepared"));
          runQuery.refresh();
          return;
        }

        showToast("error", payload.error?.message ?? td("toast.payoutPrepFailed"));
        return;
      }

      showToast("success", td("toast.payoutPrepared"));
      runQuery.refresh();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : td("toast.payoutPrepFailed"));
    } finally {
      setIsPreparingPayout(false);
    }
  };

  const performCycleAction = async (
    cycleId: string,
    action: "mark_ready" | "mark_processing" | "mark_paid",
    successMessage: string,
    failMessage: string
  ) => {
    setActiveCycleActionId(cycleId);
    if (action === "mark_paid") setMarkingPaidCycleId(cycleId);
    try {
      const response = await fetch(`/api/v1/payroll/runs/${runId}/cycles/${cycleId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });

      const payload = (await response.json()) as MarkCyclePaidResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? failMessage);
        return;
      }

      showToast("success", successMessage);
      runQuery.refresh();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : failMessage);
    } finally {
      setActiveCycleActionId(null);
      if (action === "mark_paid") setMarkingPaidCycleId(null);
    }
  };

  const markCycleReady = async (cycleId: string) => {
    const confirmed = await confirm({
      title: td("confirmMarkReady.title"),
      description: td("confirmMarkReady.description"),
      confirmLabel: td("confirmMarkReady.confirmLabel"),
      tone: "default"
    });
    if (!confirmed) return;
    await performCycleAction(cycleId, "mark_ready", td("toast.cycleReady"), td("toast.cycleReadyFailed"));
  };

  const markCycleProcessing = async (cycleId: string) => {
    const confirmed = await confirm({
      title: td("confirmMarkProcessing.title"),
      description: td("confirmMarkProcessing.description"),
      confirmLabel: td("confirmMarkProcessing.confirmLabel"),
      tone: "default"
    });
    if (!confirmed) return;
    await performCycleAction(cycleId, "mark_processing", td("toast.cycleProcessing"), td("toast.cycleProcessingFailed"));
  };

  const markCyclePaid = async (cycleId: string) => {
    const confirmed = await confirm({
      title: td("confirmMarkPaid.title"),
      description: td("confirmMarkPaid.description"),
      confirmLabel: td("confirmMarkPaid.confirmLabel"),
      tone: "danger"
    });
    if (!confirmed) return;
    await performCycleAction(cycleId, "mark_paid", td("toast.cyclePaid"), td("toast.cyclePaidFailed"));
  };

  const createAmendment = async () => {
    const confirmed = await confirm({
      title: td("confirmAmendment.title"),
      description: td("confirmAmendment.description"),
      confirmLabel: td("confirmAmendment.confirmLabel"),
      tone: "default"
    });
    if (!confirmed) return;

    setIsCreatingAmendment(true);
    try {
      const response = await fetch(`/api/v1/payroll/runs/${runId}/amend`, {
        method: "POST"
      });

      const payload = (await response.json()) as CreateAmendmentRunResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? td("toast.amendmentFailed"));
        return;
      }

      showToast("success", td("toast.amendmentCreated"));
      // Navigate to the new amendment run
      window.location.href = `/payroll/runs/${payload.data.run.id}`;
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : td("toast.amendmentFailed"));
    } finally {
      setIsCreatingAmendment(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canCalculateRun || canImportCsv || canGenerateStatements ? (
            <>
              {canImportCsv ? (
                <button
                  type="button"
                  className="button"
                  onClick={() => setIsCsvImportOpen(true)}
                  disabled={
                    isCalculating ||
                    isGeneratingStatements ||
                    activeRunAction !== null
                  }
                >
                  {t('actions.importCsv')}
                </button>
              ) : null}

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
                <p className="payroll-status-step-label">{td(`statusTimeline.${statusToTimelineKey(step.step)}`)}</p>
              </article>
            ))}
          </section>

          <section className="payroll-run-summary-grid" aria-label={t('title')}>
            <article className="metric-card">
              <p className="metric-label">{t('metrics.status')}</p>
              <p className="metric-value">
                <StatusBadge tone={toneForPayrollRunStatus(runQuery.data.run.status)}>
                  {td(`statusTimeline.${statusToTimelineKey(runQuery.data.run.status)}`)}
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
                {td(`statusTimeline.${statusToTimelineKey(runQuery.data.run.status)}`)}
              </StatusBadge>
            </div>

            <div className="payroll-approval-steps">
              <article className="payroll-approval-step">
                <p className="payroll-approval-step-title">{t('approval.approvalTitle')}</p>
                {runQuery.data.run.finalApprovedAt ? (
                  <>
                    <StatusBadge tone="success">{tCommon('status.approved')}</StatusBadge>
                    <p className="settings-card-description">
                      {t.rich('approval.approvedByAt', {
                        name: runQuery.data.run.finalApprovedByName ?? "--",
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
                ) : runQuery.data.run.rejectedAt ? (
                  <>
                    <StatusBadge tone="warning">{t('approval.rejected')}</StatusBadge>
                    {runQuery.data.run.rejectionReason ? (
                      <p className="settings-card-description">{runQuery.data.run.rejectionReason}</p>
                    ) : null}
                  </>
                ) : (
                  <StatusBadge tone={isSubmitted ? "pending" : "draft"}>
                    {isSubmitted ? t('approval.awaitingApproval') : t('approval.notApprovedYet')}
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
                  onClick={async () => {
                    const confirmed = await confirm({
                      title: td("confirmSubmit.title"),
                      description: td("confirmSubmit.description"),
                      confirmLabel: td("confirmSubmit.confirmLabel"),
                      tone: "default"
                    });
                    if (confirmed) void performRunAction("submit");
                  }}
                >
                  {activeRunAction === "submit" ? t('actions.submitting') : t('actions.submitForApproval')}
                </button>
              ) : null}

              {canApproveRun ? (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={activeRunAction !== null}
                  onClick={async () => {
                    const confirmed = await confirm({
                      title: td("confirmApprove.title"),
                      description: td("confirmApprove.description"),
                      confirmLabel: td("confirmApprove.confirmLabel"),
                      tone: "danger"
                    });
                    if (confirmed) void performRunAction("approve");
                  }}
                >
                  {activeRunAction === "approve" ? t('actions.approving') : t('actions.approve')}
                </button>
              ) : null}

              {canRejectRun ? (
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

              {canMarkProcessing ? (
                <button
                  type="button"
                  className="button"
                  disabled={activeRunAction !== null}
                  onClick={() => {
                    void markProcessing();
                  }}
                >
                  {activeRunAction === "mark_processing" ? td('actions.marking') : td('actions.markProcessing')}
                </button>
              ) : null}

              {canMarkCompleted ? (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={activeRunAction !== null}
                  onClick={() => {
                    void markCompleted();
                  }}
                >
                  {activeRunAction === "mark_completed" ? td('actions.marking') : td('actions.markCompleted')}
                </button>
              ) : null}

              {canReopenRun ? (
                <button
                  type="button"
                  className="button button-subtle button-danger"
                  disabled={activeRunAction !== null}
                  onClick={() => {
                    setReopenReasonError(null);
                    setReopenReason("");
                    setIsReopenDialogOpen(true);
                  }}
                >
                  {td('actions.reopenRun')}
                </button>
              ) : null}
            </div>
          </section>

          {(isApproved || isProcessing || isCompleted) ? (
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
                  {isCompleted ? t('locked.completedDescription') : isProcessing ? t('locked.processingDescription') : t('locked.description')}
                </p>
              </div>
            </section>
          ) : null}

          {run?.amendmentOf ? (
            <section className="payroll-amendment-banner">
              <StatusBadge tone="info">
                {td("amendmentBadge", { id: run.amendmentOf.slice(0, 8) })}
              </StatusBadge>
            </section>
          ) : null}

          {(isApproved || isProcessing || isCompleted) ? (
            <section className="settings-card payroll-cycles-card" aria-label={td("cycles.title")}>
              <div className="payroll-approval-header">
                <h2 className="section-title">{td("cycles.title")}</h2>
              </div>

              {activeCycles.length === 0 ? (
                <p className="settings-card-description">{td("cycles.noCycles")}</p>
              ) : (
                <div className="payroll-cycles-grid">
                  {activeCycles.map((cycle) => (
                    <article key={cycle.id} className="payroll-cycle-card settings-card">
                      <p className="section-title">{cycle.label}</p>
                      <StatusBadge
                        tone={
                          cycle.status === "paid" ? "success"
                            : cycle.status === "ready" ? "pending"
                            : cycle.status === "failed" ? "error"
                            : cycle.status === "draft" ? "draft"
                            : "processing"
                        }
                      >
                        {td(`cycles.status${cycle.status.charAt(0).toUpperCase()}${cycle.status.slice(1)}`)}
                      </StatusBadge>
                      <p className="settings-card-description">
                        {td("cycles.employeeCount", { count: cycle.employeeCount })}
                        {" · "}
                        <CurrencyDisplay amount={cycle.totalNet} currency={cycle.currency} />
                      </p>
                      {cycle.paidAt ? (
                        <p className="settings-card-description">
                          {td("cycles.paidAt", { date: formatDate(cycle.paidAt, locale) })}
                        </p>
                      ) : cycle.preparedAt ? (
                        <p className="settings-card-description">
                          {td("cycles.preparedAt", { date: formatDate(cycle.preparedAt, locale) })}
                        </p>
                      ) : null}
                      {canManage && cycle.status === "draft" ? (
                        <div className="settings-actions">
                          <button
                            type="button"
                            className="button button-primary"
                            disabled={activeCycleActionId !== null}
                            onClick={() => void markCycleReady(cycle.id)}
                          >
                            {activeCycleActionId === cycle.id ? td("cycles.markingReady") : td("cycles.markReady")}
                          </button>
                        </div>
                      ) : canManage && cycle.status === "ready" ? (
                        <div className="settings-actions">
                          <button
                            type="button"
                            className="button"
                            disabled={activeCycleActionId !== null}
                            onClick={() => void markCycleProcessing(cycle.id)}
                          >
                            {activeCycleActionId === cycle.id ? td("cycles.markingProcessing") : td("cycles.markProcessing")}
                          </button>
                          <button
                            type="button"
                            className="button button-primary"
                            disabled={activeCycleActionId !== null}
                            onClick={() => void markCyclePaid(cycle.id)}
                          >
                            {markingPaidCycleId === cycle.id ? td("cycles.markingPaid") : td("cycles.markPaid")}
                          </button>
                        </div>
                      ) : canManage && cycle.status === "processing" ? (
                        <div className="settings-actions">
                          <button
                            type="button"
                            className="button button-primary"
                            disabled={activeCycleActionId !== null}
                            onClick={() => void markCyclePaid(cycle.id)}
                          >
                            {markingPaidCycleId === cycle.id ? td("cycles.markingPaid") : td("cycles.markPaid")}
                          </button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}

              <div className="settings-actions payroll-cycle-actions">
                {canPreparePayout ? (
                  <button
                    type="button"
                    className="button button-accent"
                    disabled={isPreparingPayout || activeRunAction !== null}
                    onClick={() => void preparePayout()}
                  >
                    {isPreparingPayout
                      ? td("cycles.preparingPayout")
                      : hasCycles
                        ? td("cycles.addPayoutCycle")
                        : td("cycles.preparePayout")}
                  </button>
                ) : null}

                {canCreateAmendment ? (
                  <button
                    type="button"
                    className="button"
                    disabled={isCreatingAmendment}
                    onClick={() => void createAmendment()}
                  >
                    {isCreatingAmendment ? td("cycles.creatingAmendment") : td("cycles.createAmendment")}
                  </button>
                ) : null}
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
                          {isManuallyEdited(item) ? (
                            <p className="settings-card-description">
                              <span className="payroll-edited-badge">
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path
                                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 1 1 3.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                                {td('editItem.manuallyEdited')}
                              </span>
                            </p>
                          ) : item.flagged ? (
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
                              {td(`paymentStatus.${item.paymentStatus}`)}
                            </StatusBadge>
                          </span>
                        </td>
                        <td className="table-row-action-cell">
                          <div className="payroll-row-actions">
                            {canEditItems ? (
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => {
                                  if (editItemId === item.id) {
                                    closeEditPanel();
                                  } else {
                                    openEditPanel(item);
                                    setExpandedItemId(item.id);
                                  }
                                }}
                              >
                                {td('editItem.editButton')}
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
                                        <div className="form-field">
                                          <span className="form-label">{t('adjustments.typeLabel')}</span>
                                          <Select
                                            value={adjustmentValues.adjustmentType}
                                            onValueChange={(value) =>
                                              setAdjustmentValues((current) => ({
                                                ...current,
                                                adjustmentType: value as PayrollAdjustmentType
                                              }))
                                            }
                                          >
                                            <SelectTrigger>
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="bonus">{t('adjustments.bonus')}</SelectItem>
                                              <SelectItem value="deduction">{t('adjustments.deduction')}</SelectItem>
                                              <SelectItem value="correction">{t('adjustments.correction')}</SelectItem>
                                            </SelectContent>
                                          </Select>
                                          {adjustmentErrors.adjustmentType ? (
                                            <p className="form-field-error">
                                              {adjustmentErrors.adjustmentType}
                                            </p>
                                          ) : null}
                                        </div>

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

                              {editItemId === item.id && editFormValues ? (
                                <form
                                  className="payroll-item-edit-form settings-form"
                                  onSubmit={submitEdit}
                                  noValidate
                                >
                                  <h3 className="section-title">{td('editItem.title')}</h3>
                                  <p className="settings-card-description">{td('editItem.description')}</p>

                                  <label className="form-field" htmlFor={`edit-base-salary-${item.id}`}>
                                    <span className="form-label">{td('editItem.baseSalaryField')}</span>
                                    <input
                                      id={`edit-base-salary-${item.id}`}
                                      className={editFormErrors.baseSalaryAmount ? "form-input form-input-error" : "form-input"}
                                      value={editFormValues.baseSalaryAmount}
                                      onChange={(event) =>
                                        setEditFormValues((current) =>
                                          current ? { ...current, baseSalaryAmount: event.currentTarget.value } : current
                                        )
                                      }
                                    />
                                    {editFormErrors.baseSalaryAmount ? (
                                      <p className="form-field-error">{editFormErrors.baseSalaryAmount}</p>
                                    ) : null}
                                  </label>

                                  <label className="form-field" htmlFor={`edit-currency-${item.id}`}>
                                    <span className="form-label">{td('editItem.currencyField')}</span>
                                    <input
                                      id={`edit-currency-${item.id}`}
                                      className={editFormErrors.currency ? "form-input form-input-error" : "form-input"}
                                      value={editFormValues.currency}
                                      maxLength={3}
                                      onChange={(event) =>
                                        setEditFormValues((current) =>
                                          current ? { ...current, currency: event.currentTarget.value.toUpperCase() } : current
                                        )
                                      }
                                    />
                                    {editFormErrors.currency ? (
                                      <p className="form-field-error">{editFormErrors.currency}</p>
                                    ) : null}
                                  </label>

                                  <div className="payroll-item-edit-allowances">
                                    <p className="form-label">{td('editItem.allowancesTitle')}</p>
                                    {editFormValues.allowances.map((allowance, allowanceIndex) => (
                                      <div key={allowance.key} className="payroll-item-edit-allowance-row">
                                        <input
                                          className="form-input"
                                          placeholder={td('editItem.allowanceLabel')}
                                          value={allowance.label}
                                          onChange={(event) =>
                                            setEditFormValues((current) => {
                                              if (!current) return current;
                                              const updated = [...current.allowances];
                                              updated[allowanceIndex] = { ...updated[allowanceIndex], label: event.currentTarget.value };
                                              return { ...current, allowances: updated };
                                            })
                                          }
                                        />
                                        <input
                                          className="form-input"
                                          placeholder={td('editItem.allowanceAmount')}
                                          value={allowance.amount}
                                          onChange={(event) =>
                                            setEditFormValues((current) => {
                                              if (!current) return current;
                                              const updated = [...current.allowances];
                                              updated[allowanceIndex] = { ...updated[allowanceIndex], amount: event.currentTarget.value };
                                              return { ...current, allowances: updated };
                                            })
                                          }
                                        />
                                        <label className="payroll-item-edit-taxable-label">
                                          <input
                                            type="checkbox"
                                            checked={allowance.isTaxable}
                                            onChange={(event) =>
                                              setEditFormValues((current) => {
                                                if (!current) return current;
                                                const updated = [...current.allowances];
                                                updated[allowanceIndex] = { ...updated[allowanceIndex], isTaxable: event.currentTarget.checked };
                                                return { ...current, allowances: updated };
                                              })
                                            }
                                          />
                                          {td('editItem.allowanceTaxable')}
                                        </label>
                                        <button
                                          type="button"
                                          className="button button-subtle"
                                          onClick={() =>
                                            setEditFormValues((current) => {
                                              if (!current) return current;
                                              return {
                                                ...current,
                                                allowances: current.allowances.filter(
                                                  (_, idx) => idx !== allowanceIndex
                                                )
                                              };
                                            })
                                          }
                                        >
                                          {td('editItem.removeAllowance')}
                                        </button>
                                      </div>
                                    ))}
                                    {editFormErrors.allowances ? (
                                      <p className="form-field-error">{editFormErrors.allowances}</p>
                                    ) : null}
                                    <button
                                      type="button"
                                      className="button button-subtle"
                                      onClick={() =>
                                        setEditFormValues((current) => {
                                          if (!current) return current;
                                          return {
                                            ...current,
                                            allowances: [
                                              ...current.allowances,
                                              {
                                                key: createEditFormKey(),
                                                label: "",
                                                amount: "0",
                                                isTaxable: true
                                              }
                                            ]
                                          };
                                        })
                                      }
                                    >
                                      {td('editItem.addAllowance')}
                                    </button>
                                  </div>

                                  <label className="form-field" htmlFor={`edit-reason-${item.id}`}>
                                    <span className="form-label">{td('editItem.reasonField')}</span>
                                    <textarea
                                      id={`edit-reason-${item.id}`}
                                      className={editFormErrors.reason ? "form-input form-input-error" : "form-input"}
                                      rows={3}
                                      value={editFormValues.reason}
                                      onChange={(event) =>
                                        setEditFormValues((current) =>
                                          current ? { ...current, reason: event.currentTarget.value } : current
                                        )
                                      }
                                    />
                                    {editFormErrors.reason ? (
                                      <p className="form-field-error">{editFormErrors.reason}</p>
                                    ) : null}
                                  </label>

                                  <div className="settings-actions">
                                    <button
                                      type="submit"
                                      className="button button-accent"
                                      disabled={isSubmittingEdit}
                                    >
                                      {isSubmittingEdit ? td('editItem.saving') : td('editItem.saveChanges')}
                                    </button>
                                    <button
                                      type="button"
                                      className="button button-subtle"
                                      disabled={isSubmittingEdit}
                                      onClick={closeEditPanel}
                                    >
                                      {tCommon('cancel')}
                                    </button>
                                  </div>
                                </form>
                              ) : null}
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

      {isReopenDialogOpen ? (
        <section className="payroll-reject-dialog" aria-label={td('reopenDialog.title')}>
          <button
            type="button"
            className="payroll-reject-backdrop"
            aria-label={tCommon('close')}
            onClick={() => {
              if (activeRunAction) {
                return;
              }

              setIsReopenDialogOpen(false);
              setReopenReasonError(null);
            }}
          />
          <article className="payroll-reject-panel">
            <h2 className="section-title">{td('reopenDialog.title')}</h2>
            <p className="settings-card-description">
              {td('reopenDialog.description')}
            </p>

            <form className="settings-form" onSubmit={submitReopenReason} noValidate>
              <label className="form-field" htmlFor="reopen-reason">
                <span className="form-label">{td('reopenDialog.reasonLabel')}</span>
                <textarea
                  id="reopen-reason"
                  className={reopenReasonError ? "form-input form-input-error" : "form-input"}
                  value={reopenReason}
                  onChange={(event) => {
                    setReopenReason(event.currentTarget.value);
                    if (reopenReasonError) {
                      setReopenReasonError(null);
                    }
                  }}
                  rows={4}
                />
                {reopenReasonError ? (
                  <p className="form-field-error">{reopenReasonError}</p>
                ) : null}
              </label>

              <div className="settings-actions">
                <button
                  type="submit"
                  className="button button-danger"
                  disabled={activeRunAction === "reopen"}
                >
                  {activeRunAction === "reopen" ? td('reopenDialog.reopening') : td('reopenDialog.confirmReopen')}
                </button>
                <button
                  type="button"
                  className="button button-subtle"
                  disabled={activeRunAction === "reopen"}
                  onClick={() => {
                    setIsReopenDialogOpen(false);
                    setReopenReasonError(null);
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

      <CsvImportDialog
        isOpen={isCsvImportOpen}
        runId={runId}
        onClose={() => setIsCsvImportOpen(false)}
        onImportComplete={() => {
          runQuery.refresh();
          showToast("success", td("toast.csvImportComplete"));
        }}
      />

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
