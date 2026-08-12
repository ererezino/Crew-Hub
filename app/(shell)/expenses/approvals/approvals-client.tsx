"use client";

import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";

import { ConfirmDialog } from "../../../../components/shared/confirm-dialog";
import { EmptyState } from "../../../../components/shared/empty-state";
import { FileAttachmentPicker } from "../../../../components/shared/file-attachment-picker";
import { PageHeader } from "../../../../components/shared/page-header";
import { SlidePanel } from "../../../../components/shared/slide-panel";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { CurrencyDisplay } from "../../../../components/ui/currency-display";
import { useExpenseApprovals } from "../../../../hooks/use-expenses";
import { invalidateApprovalSurfaces } from "../../../../lib/approval-invalidation";
import { countryFlagFromCode, countryNameFromCode } from "../../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime, formatSingleDateHuman } from "../../../../lib/datetime";
import {
  formatMonthLabel,
  getExpenseCategoryLabel,
  getExpenseStatusLabel,
  toneForExpenseStatus
} from "../../../../lib/expenses";
import { EXPENSE_CATEGORIES } from "../../../../types/expenses";
import type {
  ExpenseCommentAttachmentSignedUrlResponse,
  CreateExpenseCommentResponse,
  ExpenseCategory,
  ExpenseApprovalStage,
  ExpenseBulkApproveResponse,
  ExpenseCommentRecord,
  ExpenseCommentsResponse,
  ExpenseAttachmentsListResponse,
  ExpenseReceiptSignedUrlResponse,
  ExpenseRecord,
  UpdateExpenseResponse
} from "../../../../types/expenses";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { humanizeError } from "@/lib/errors";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";

type AppLocale = "en" | "fr";
type SortDirection = "asc" | "desc";
type ToastVariant = "success" | "error" | "info";

type ToastMessage = {
  id: string;
  variant: ToastVariant;
  message: string;
};

type RejectMode = "manager" | "additional" | "finance";

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

/* ─── Receipt lightbox ─── */

type ReceiptLightboxItem = {
  url: string;
  fileName: string;
};

type ReceiptLightboxData = {
  items: ReceiptLightboxItem[];
  index: number;
  label: string;
};

function ReceiptLightbox({
  data,
  downloadLabel,
  onClose
}: {
  data: ReceiptLightboxData;
  downloadLabel: string;
  onClose: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(data.index);
  const total = data.items.length;
  const current = data.items[Math.min(activeIndex, total - 1)] ?? data.items[0];
  const isPdf = (current?.fileName ?? "").toLowerCase().endsWith(".pdf");
  const [imageLoaded, setImageLoaded] = useState(isPdf);

  const goTo = useCallback((next: number) => {
    if (total === 0) return;
    const wrapped = (next + total) % total;
    setActiveIndex(wrapped);
    setImageLoaded(false);
  }, [total]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goTo(activeIndex + 1);
      if (e.key === "ArrowLeft") goTo(activeIndex - 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, goTo, activeIndex]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  if (!current) {
    return null;
  }

  return (
    <div className="lightbox-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={data.label}>
      <div className={isPdf ? "lightbox-inner lightbox-inner-doc" : "lightbox-inner"} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="lightbox-close" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>

        {total > 1 ? (
          <>
            <button
              type="button"
              className="lightbox-nav lightbox-nav-prev"
              onClick={() => goTo(activeIndex - 1)}
              aria-label="Previous document"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              className="lightbox-nav lightbox-nav-next"
              onClick={() => goTo(activeIndex + 1)}
              aria-label="Next document"
            >
              <ChevronRight size={22} />
            </button>
          </>
        ) : null}

        <div className={isPdf ? "lightbox-stage lightbox-stage-doc" : "lightbox-stage"}>
          {isPdf ? (
            <iframe
              key={current.url}
              src={`${current.url}#toolbar=1&navpanes=0`}
              title={current.fileName}
              className="lightbox-pdf"
            />
          ) : (
            <>
              {!imageLoaded ? (
                <div className="lightbox-spinner">
                  <div className="lightbox-spinner-ring" />
                </div>
              ) : null}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={current.url}
                src={current.url}
                alt={current.fileName}
                className="lightbox-img lightbox-img-expense"
                loading="eager"
                onLoad={() => setImageLoaded(true)}
                onError={() => setImageLoaded(true)}
                style={imageLoaded ? undefined : { display: "none" }}
              />
            </>
          )}
        </div>

        <div className="lightbox-filename">
          {current.fileName}
          {total > 1 ? <span className="lightbox-counter"> · {activeIndex + 1} / {total}</span> : null}
          {" · "}
          <a href={current.url} target="_blank" rel="noopener noreferrer" className="lightbox-download">
            <Download size={13} aria-hidden="true" /> {downloadLabel}
          </a>
        </div>
      </div>
    </div>
  );
}

export function ExpenseApprovalsClient({
  canManagerApprove,
  canAdditionalApprove,
  canFinanceApprove,
  managerCount,
  additionalCount,
  financeCount,
  embedded = false
}: {
  canManagerApprove: boolean;
  canAdditionalApprove?: boolean;
  canFinanceApprove: boolean;
  /** Number of expenses awaiting manager approval (for sub-tab badge) */
  managerCount?: number;
  /** Number of expenses awaiting additional approval (for sub-tab badge) */
  additionalCount?: number;
  /** Number of expenses awaiting finance payment (for sub-tab badge) */
  financeCount?: number;
  embedded?: boolean;
}) {
  const t = useTranslations('expenseApprovals');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;

  const rejectSchema = z.object({
    reason: z.string().trim().min(1, t('validation.rejectionReasonRequired')).max(2000, t('validation.reasonTooLong'))
  });

  const disburseSchema = z.object({
    reimbursementReference: z
      .string()
      .trim()
      .min(1, t('validation.reimbursementReferenceRequired'))
      .max(120, t('validation.referenceTooLong')),
    reimbursementNotes: z.string().trim().max(2000, t('validation.notesTooLong'))
  });

  const queryClient = useQueryClient();
  const availableStages = useMemo<ExpenseApprovalStage[]>(() => {
    const stages: ExpenseApprovalStage[] = [];

    if (canManagerApprove) {
      stages.push("manager");
    }

    if (canAdditionalApprove) {
      stages.push("additional");
    }

    if (canFinanceApprove) {
      stages.push("finance");
    }

    return stages;
  }, [canAdditionalApprove, canFinanceApprove, canManagerApprove]);
  /* The queue must show everything awaiting action by default — the tab
   * badges count ALL months, so a month-scoped default made them disagree
   * (badge "3", empty list) whenever submissions carried older expense
   * dates. Empty month = no date filter; the picker narrows on demand. */
  const [month, setMonth] = useState("");
  /* Land on the queue matching the user's primary role: manager stage for
   * managers, payment stage for finance — never the rarely-used additional
   * queue just because it sorts first. */
  const [stage, setStage] = useState<ExpenseApprovalStage>(
    canManagerApprove ? "manager" : canFinanceApprove ? "finance" : availableStages[0] ?? "manager"
  );
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
  const [receiptLightbox, setReceiptLightbox] = useState<ReceiptLightboxData | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ExpenseRecord | null>(null);
  const [rejectMode, setRejectMode] = useState<RejectMode>("manager");
  const [rejectValues, setRejectValues] = useState<RejectFormValues>({ reason: "" });
  const [rejectErrors, setRejectErrors] = useState<RejectFormErrors>({});
  const [isRejecting, setIsRejecting] = useState(false);
  const [requestInfoTarget, setRequestInfoTarget] = useState<ExpenseRecord | null>(null);
  const [requestInfoMessage, setRequestInfoMessage] = useState("");
  const [requestInfoFiles, setRequestInfoFiles] = useState<File[]>([]);
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

  const coveringForNames = useMemo(() => {
    const names = new Set<string>();
    for (const exp of expenses) {
      if (exp.managerActingForName) names.add(exp.managerActingForName);
    }
    return [...names];
  }, [expenses]);

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

  const getDisplayStatusLabel = (expense: ExpenseRecord) => {
    if (expense.infoRequestState === "requested") {
      return t('table.infoRequestedBadge');
    }

    return getExpenseStatusLabel(expense.status);
  };

  const getDisplayStatusTone = (expense: ExpenseRecord) => {
    if (expense.infoRequestState === "requested") {
      return "warning" as const;
    }

    return toneForExpenseStatus(expense.status);
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
          action: stage === "additional" ? "additional_approve" : "approve"
        })
      });

      const payload = (await response.json()) as UpdateExpenseResponse;

      if (!response.ok || !payload.data?.expense) {
        showToast("error", payload.error?.message ?? t('toast.approveError'));
        return;
      }

      setSelectedIds((current) => current.filter((id) => id !== expense.id));
      void invalidateApprovalSurfaces(queryClient);
      showToast("success", t('toast.approveSuccess'));
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : t('toast.approveError'));
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
        showToast("error", payload.error?.message ?? t('toast.loadConversationError'));
        setRequestInfoThread([]);
        return;
      }

      setRequestInfoThread(payload.data.comments);
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : t('toast.loadConversationError')
      );
      setRequestInfoThread([]);
    } finally {
      setIsLoadingRequestInfoThread(false);
    }
  };

  const openCommentAttachment = async (expenseId: string, attachmentId: string, fileName: string) => {
    const loadingKey = `comment-${attachmentId}`;
    setIsOpeningReceiptById((current) => ({
      ...current,
      [loadingKey]: true
    }));

    try {
      const response = await fetch(
        `/api/v1/expenses/${expenseId}/comments/attachments/${attachmentId}`,
        { method: "GET" }
      );
      const payload = (await response.json()) as ExpenseCommentAttachmentSignedUrlResponse;

      if (!response.ok || !payload.data?.url) {
        showToast("error", payload.error?.message ?? t('toast.openAttachmentError'));
        return;
      }

      setReceiptLightbox({
        items: [{ url: payload.data.url, fileName: payload.data.fileName || fileName }],
        index: 0,
        label: payload.data.fileName || fileName
      });
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : t('toast.openAttachmentError'));
    } finally {
      setIsOpeningReceiptById((current) => {
        const next = { ...current };
        delete next[loadingKey];
        return next;
      });
    }
  };

  const openRequestInfoPanel = (expense: ExpenseRecord) => {
    setRequestInfoTarget(expense);
    setRequestInfoMessage("");
    setRequestInfoFiles([]);
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
    setRequestInfoFiles([]);
    setRequestInfoErrors({});
    setRequestInfoThread([]);
  };

  const handleRequestInfoMessageChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.currentTarget.value;
    setRequestInfoMessage(value);

    if (value.trim().length === 0) {
      setRequestInfoErrors({ message: t('validation.messageRequired') });
      return;
    }

    if (value.trim().length > 2000) {
      setRequestInfoErrors({ message: t('validation.messageTooLong') });
      return;
    }

    setRequestInfoErrors({});
  };

  const handleRequestInfoFilesSelected = (files: File[]) => {
    setRequestInfoFiles(files);

    if (files.length > 0) {
      setRequestInfoErrors({});
    }
  };

  const removeRequestInfoFile = (index: number) => {
    setRequestInfoFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const submitRequestInfo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!requestInfoTarget) {
      return;
    }

    const trimmedMessage = requestInfoMessage.trim();
    if (!trimmedMessage && requestInfoFiles.length === 0) {
      setRequestInfoErrors({ message: t('validation.messageOrAttachmentRequired') });
      return;
    }

    if (trimmedMessage.length > 2000) {
      setRequestInfoErrors({ message: t('validation.messageTooLong') });
      return;
    }

    setIsRequestingInfo(true);
    setIsMutatingId(requestInfoTarget.id);

    try {
      const formData = new FormData();
      formData.set("action", "request_info");
      formData.set("message", trimmedMessage);
      requestInfoFiles.forEach((file) => {
        formData.append("attachments", file);
      });

      const response = await fetch(`/api/v1/expenses/${requestInfoTarget.id}/comments`, {
        method: "POST",
        body: formData
      });

      const payload = (await response.json()) as CreateExpenseCommentResponse;

      if (!response.ok || !payload.data?.comment) {
        showToast("error", payload.error?.message ?? t('toast.requestInfoError'));
        return;
      }
      const createdComment = payload.data.comment;

      setRequestInfoThread((current) => [...current, createdComment]);
      setRequestInfoMessage("");
      setRequestInfoFiles([]);
      setRequestInfoErrors({});
      void invalidateApprovalSurfaces(queryClient);
      showToast("info", t('toast.requestInfoSuccess'));
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : t('toast.requestInfoError'));
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
        paymentProof: t('validation.paymentProofRequired')
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
            t('toast.uploadPaymentProofError')
        );
        return;
      }

      const uploadResult = (await uploadResponse.json()) as { data?: { path?: string } };
      const receiptPath = uploadResult.data?.path;

      if (!receiptPath) {
        showToast("error", t('toast.uploadPaymentProofError'));
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
        showToast("error", payload.error?.message ?? t('toast.markPaidError'));
        return;
      }

      closeDisbursePanel();
      setSelectedIds((current) => current.filter((id) => id !== disburseTarget.id));
      void invalidateApprovalSurfaces(queryClient);
      showToast("success", t('toast.markPaidSuccess'));
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : t('toast.markPaidError'));
    } finally {
      setIsDisbursing(false);
      setIsMutatingId(null);
    }
  };

  const handleBulkApprove = async () => {
    if (stage !== "manager" && stage !== "additional") {
      showToast("error", t('toast.bulkOnlyManager'));
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
        showToast("error", payload.error?.message ?? t('toast.bulkApproveError'));
        return;
      }

      setSelectedIds([]);
      void invalidateApprovalSurfaces(queryClient);
      showToast(
        "success",
        t('toast.bulkApproveSuccess', { count: payload.data.approvedCount })
      );
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : t('toast.bulkApproveError'));
    } finally {
      setIsBulkApproving(false);
    }
  };

  const openBulkApproveConfirm = () => {
    if (stage !== "manager" && stage !== "additional") {
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
            : rejectMode === "additional"
              ? {
                  action: "additional_reject",
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
        showToast("error", payload.error?.message ?? t('toast.rejectError'));
        return;
      }

      closeRejectPanel();
      setSelectedIds((current) => current.filter((id) => id !== rejectTarget.id));
      void invalidateApprovalSurfaces(queryClient);
      showToast(
        rejectMode === "manager" ? "info" : "error",
        rejectMode === "manager" ? t('toast.rejectSuccess') : t('toast.financeRejectSuccess')
      );
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : t('toast.rejectError'));
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
      /* Approvers must see EVERY document on the expense, not just the first
       * receipt — reviewing an invoice that sits in attachment #2 is the
       * whole job. Legacy single-receipt endpoint stays as the fallback. */
      const response = await fetch(`/api/v1/expenses/${expense.id}/attachments`, {
        method: "GET"
      });
      const payload = (await response.json()) as ExpenseAttachmentsListResponse;
      const items = (payload.data?.attachments ?? [])
        .filter((attachment) => attachment.url)
        .map((attachment) => ({ url: attachment.url, fileName: attachment.fileName }));

      if (response.ok && items.length > 0) {
        setReceiptLightbox({ items, index: 0, label: expense.receiptFileName });
        return;
      }

      const legacyResponse = await fetch(`/api/v1/expenses/${expense.id}/receipt`, { method: "GET" });
      const legacyPayload = (await legacyResponse.json()) as ExpenseReceiptSignedUrlResponse;

      if (!legacyResponse.ok || !legacyPayload.data?.url) {
        showToast("error", legacyPayload.error?.message ?? t('toast.openReceiptError'));
        return;
      }

      setReceiptLightbox({
        items: [{ url: legacyPayload.data.url, fileName: expense.receiptFileName }],
        index: 0,
        label: expense.receiptFileName
      });
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : t('toast.openReceiptError'));
    } finally {
      setIsOpeningReceiptById((current) => {
        const next = { ...current };
        delete next[expense.id];
        return next;
      });
    }
  };

  const stageTitle = stage === "manager"
    ? t('tabs.pendingMyApproval')
    : stage === "additional"
      ? t('tabs.pendingAdditionalApproval')
      : t('tabs.pendingPayment');
  const stageDescription =
    stage === "manager"
      ? t('stageDescription.manager')
      : stage === "additional"
        ? t('stageDescription.additional')
        : t('stageDescription.finance');
  const hasActiveFilters =
    employeeFilter.trim().length > 0 ||
    categoryFilter !== "all" ||
    fromDateFilter.length > 0 ||
    toDateFilter.length > 0;
  const canBulkProcess = stage === "manager" || stage === "additional";

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
          title={t('pageTitle')}
          description={t('pageDescription')}
          actions={
            canBulkProcess ? (
              <button
                type="button"
                className="button button-accent"
                onClick={openBulkApproveConfirm}
                disabled={selectedIds.length === 0 || isBulkApproving}
              >
                {isBulkApproving ? tCommon('working') : t('actions.bulkApprove', { count: selectedIds.length })}
              </button>
            ) : null
          }
        />
      ) : null}

      {availableStages.length > 1 ? (
        <section className="page-tabs" aria-label={t('tabs.ariaLabel')}>
          {availableStages.includes("manager") ? (
            <button
              type="button"
              className={stage === "manager" ? "page-tab page-tab-active" : "page-tab"}
              onClick={() => setStage("manager")}
            >
              {t('tabs.pendingMyApproval')}
              {typeof managerCount === "number" && managerCount > 0 ? (
                <span className="page-tab-badge numeric">{managerCount}</span>
              ) : null}
            </button>
          ) : null}
          {availableStages.includes("additional") ? (
            <button
              type="button"
              className={stage === "additional" ? "page-tab page-tab-active" : "page-tab"}
              onClick={() => setStage("additional")}
            >
              {t('tabs.pendingAdditionalApproval')}
              {typeof additionalCount === "number" && additionalCount > 0 ? (
                <span className="page-tab-badge numeric">{additionalCount}</span>
              ) : null}
            </button>
          ) : null}
          {availableStages.includes("finance") ? (
            <button
              type="button"
              className={stage === "finance" ? "page-tab page-tab-active" : "page-tab"}
              onClick={() => setStage("finance")}
            >
              {t('tabs.pendingPayment')}
              {typeof financeCount === "number" && financeCount > 0 ? (
                <span className="page-tab-badge numeric">{financeCount}</span>
              ) : null}
            </button>
          ) : null}
        </section>
      ) : null}

      <section className="expenses-toolbar" aria-label={t('toolbar.ariaLabel')}>
        <div className="expenses-toolbar-copy">
          <label className="form-field">
            <span className="form-label">{t('toolbar.month')}</span>
            <input
              className="form-input numeric"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.currentTarget.value)}
            />
          </label>
          <p className="settings-card-description">
            {stageTitle}: {month ? formatMonthLabel(month, locale) : t('toolbar.allMonths')}.
          </p>
        </div>
        <div className="expenses-toolbar-actions">
          <p className="settings-card-description">
            {t('toolbar.filterHint')}
          </p>
          {embedded && canBulkProcess ? (
            <button
              type="button"
              className="button button-accent"
              onClick={openBulkApproveConfirm}
              disabled={selectedIds.length === 0 || isBulkApproving}
            >
              {isBulkApproving ? tCommon('working') : t('actions.bulkApprove', { count: selectedIds.length })}
            </button>
          ) : null}
          <button type="button" className="button" onClick={clearFilters} disabled={!hasActiveFilters}>
            {t('toolbar.clearFilters')}
          </button>
        </div>
      </section>

      <section className="expenses-approvals-filter-bar" aria-label={t('filters.ariaLabel')}>
        <label className="form-field">
          <span className="form-label">{t('filters.employee')}</span>
          <input
            type="search"
            className="form-input"
            value={employeeFilter}
            onChange={(event) => setEmployeeFilter(event.currentTarget.value)}
            placeholder={t('filters.employeePlaceholder')}
          />
        </label>
        <div className="form-field">
          <span className="form-label">{t('filters.category')}</span>
          <Select
            value={categoryFilter}
            onValueChange={(value) =>
              setCategoryFilter(value as ExpenseCategory | "all")
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filters.allCategories')}</SelectItem>
              {EXPENSE_CATEGORIES.map((category) => (
                <SelectItem key={category} value={category}>
                  {getExpenseCategoryLabel(category)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="form-field">
          <span className="form-label">{t('filters.fromDate')}</span>
          <input
            type="date"
            className="form-input numeric"
            value={fromDateFilter}
            onChange={(event) => setFromDateFilter(event.currentTarget.value)}
          />
        </label>
        <label className="form-field">
          <span className="form-label">{t('filters.toDate')}</span>
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
        <EmptyState
          title={t('emptyState.errorTitle')}
          description={approvalsQuery.errorMessage}
          ctaLabel={tCommon('retry')}
          onCtaClick={() => approvalsQuery.refresh()}
        />
      ) : null}

      {!approvalsQuery.isLoading && !approvalsQuery.errorMessage && approvalsQuery.data ? (
        <>
          <section className="expenses-metric-grid" aria-label={t('metrics.ariaLabel')}>
            <article className="metric-card">
              <p className="metric-label">{stage === "manager" ? t('metrics.pendingManagerApproval') : stage === "additional" ? t('metrics.pendingAdditionalApproval') : t('metrics.pendingPayment')}</p>
              <p className="metric-value numeric">{approvalsQuery.data.pendingCount}</p>
              <p className="metric-hint">{stageDescription}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t('metrics.queueAmount')}</p>
              <p className="metric-value">
                <CurrencyDisplay amount={approvalsQuery.data.pendingAmount} currency={queueCurrency} />
              </p>
              <p className="metric-hint">{t('metrics.queueAmountHint')}</p>
            </article>
          </section>

          {filteredExpenses.length === 0 ? (
            <EmptyState
              title={
                hasActiveFilters
                  ? t('emptyState.noMatchTitle')
                  : stage === "manager"
                    ? t('emptyState.noPendingManagerTitle')
                    : stage === "additional"
                      ? t('emptyState.noPendingAdditionalTitle')
                      : t('emptyState.noPendingPaymentTitle')
              }
              description={
                hasActiveFilters
                  ? t('emptyState.noMatchDescription')
                  : t('emptyState.allProcessedDescription')
              }
              ctaLabel={t('emptyState.openExpenses')}
              ctaHref="/expenses"
            />
          ) : (
            <>
            {stage === "manager" && coveringForNames.length > 0 ? (
              <p className="delegation-banner">
                {coveringForNames.length === 1
                  ? t('coveringForBanner', { name: coveringForNames[0] })
                  : t('coveringForMultipleBanner', { names: coveringForNames.join(", ") })}
              </p>
            ) : null}
            <section className="data-table-container" aria-label={t('table.ariaLabel')}>
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
                            aria-label={t('table.selectAllAria', { stage: stageTitle.toLowerCase() })}
                          />
                        </label>
                      ) : null}
                    </th>
                    <th>{t('table.employee')}</th>
                    <th>{t('table.category')}</th>
                    <th>{t('table.description')}</th>
                    <th>{t('table.vendor')}</th>
                    <th>{t('table.amount')}</th>
                    <th>{t('table.country')}</th>
                    <th>
                      <button
                        type="button"
                        className="table-sort-trigger"
                        onClick={() =>
                          setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
                        }
                      >
                        {t('table.expenseDate')}
                        <span className="numeric">{sortDirection === "asc" ? "\u2191" : "\u2193"}</span>
                      </button>
                    </th>
                    <th>{t('table.status')}</th>
                    <th>{t('table.submitted')}</th>
                    <th className="table-action-column">{t('table.actions')}</th>
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
                              aria-label={t('table.selectExpenseAria', { name: expense.employeeName })}
                            />
                          </label>
                        ) : null}
                      </td>
                      <td>
                        <div className="documents-cell-copy">
                          <p className="documents-cell-title">{expense.employeeName}</p>
                          <p className="documents-cell-description">
                            {expense.managerActingForName
                              ? t('delegatedTag', { name: expense.managerActingForName })
                              : expense.employeeDepartment ?? ""}
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
                                  ? ` \u2022\u2022${expense.vendorBankAccountNumber.slice(-4)}`
                                  : ""}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-muted">{"\u2014"}</span>
                        )}
                      </td>
                      <td>
                        <CurrencyDisplay amount={expense.amount} currency={expense.currency} />
                      </td>
                      <td>
                        <span className="country-chip">
                          <span>{countryFlagFromCode(expense.employeeCountryCode)}</span>
                          <span>{countryNameFromCode(expense.employeeCountryCode, locale)}</span>
                        </span>
                      </td>
                      <td>
                        {/* expenseDate is date-only: a datetime tooltip would
                            fabricate a local-tz time (or the previous day), so
                            pin the title to the UTC date formatter. */}
                        <time
                          dateTime={expense.expenseDate}
                          title={formatSingleDateHuman(expense.expenseDate, locale)}
                        >
                          {formatSingleDateHuman(expense.expenseDate, locale)}
                        </time>
                      </td>
                      <td>
                        <StatusBadge tone={getDisplayStatusTone(expense)}>
                          {getDisplayStatusLabel(expense)}
                        </StatusBadge>
                        {expense.infoRequestState === "requested" && expense.infoRequestUpdatedByName ? (
                          <p className="documents-cell-description">
                            {t('table.infoRequestedBy', { name: expense.infoRequestUpdatedByName })}
                          </p>
                        ) : expense.infoRequestState === "requested" ? (
                          <p className="documents-cell-description">
                            {t('table.awaitingEmployeeReply')}
                          </p>
                        ) : null}
                        {expense.infoRequestState === "responded" ? (
                          <p className="documents-cell-description">
                            {t('table.employeeReplied')}
                          </p>
                        ) : null}
                      </td>
                      <td>
                        <time
                          dateTime={expense.createdAt}
                          title={formatDateTimeTooltip(expense.createdAt, locale)}
                        >
                          {formatRelativeTime(expense.createdAt, locale)}
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
                            {isOpeningReceiptById[expense.id] ? t('actions.opening') : t('actions.receipt')}
                          </button>
                          {stage === "manager" ? (
                            <>
                              <button
                                type="button"
                                className="table-row-action table-row-action-success"
                                onClick={() => openApproveConfirm(expense)}
                                disabled={isMutatingId === expense.id}
                              >
                                {isMutatingId === expense.id ? tCommon('working') : t('actions.approve')}
                              </button>
                              <button
                                type="button"
                                className="table-row-action table-row-action-warning"
                                onClick={() => openRequestInfoPanel(expense)}
                                disabled={isMutatingId === expense.id}
                              >
                                {t('actions.requestInfo')}
                              </button>
                              <button
                                type="button"
                                className="table-row-action table-row-action-danger"
                                onClick={() => openRejectPanel(expense, "manager")}
                                disabled={isMutatingId === expense.id}
                              >
                                {t('actions.reject')}
                              </button>
                            </>
                          ) : stage === "additional" ? (
                            <>
                              <button
                                type="button"
                                className="table-row-action table-row-action-success"
                                onClick={() => openApproveConfirm(expense)}
                                disabled={isMutatingId === expense.id}
                              >
                                {isMutatingId === expense.id ? tCommon('working') : t('actions.approve')}
                              </button>
                              <button
                                type="button"
                                className="table-row-action table-row-action-danger"
                                onClick={() => openRejectPanel(expense, "additional")}
                                disabled={isMutatingId === expense.id}
                              >
                                {t('actions.reject')}
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="table-row-action table-row-action-success"
                                onClick={() => openDisbursePanel(expense)}
                                disabled={isMutatingId === expense.id}
                              >
                                {isMutatingId === expense.id ? tCommon('working') : t('actions.markPaid')}
                              </button>
                              <button
                                type="button"
                                className="table-row-action table-row-action-warning"
                                onClick={() => openRequestInfoPanel(expense)}
                                disabled={isMutatingId === expense.id}
                              >
                                {t('actions.requestInfo')}
                              </button>
                              <button
                                type="button"
                                className="table-row-action table-row-action-danger"
                                onClick={() => openRejectPanel(expense, "finance")}
                                disabled={isMutatingId === expense.id}
                              >
                                {t('actions.reject')}
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
            </>
          )}
        </>
      ) : null}

      <SlidePanel
        isOpen={Boolean(rejectTarget)}
        title={rejectMode === "manager" ? t('rejectPanel.title') : t('rejectPanel.financeTitle')}
        description={
          rejectTarget
            ? rejectMode === "manager"
              ? t('rejectPanel.description', { name: rejectTarget.employeeName })
              : t('rejectPanel.financeDescription', { name: rejectTarget.employeeName })
            : undefined
        }
        onClose={closeRejectPanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={submitReject}>
          <label className="form-field">
            <span className="form-label">{t('rejectPanel.reasonLabel')}</span>
            <textarea
              className={rejectErrors.reason ? "form-input form-input-error" : "form-input"}
              rows={4}
              value={rejectValues.reason}
              onChange={handleRejectReasonChange}
              placeholder={t('rejectPanel.reasonPlaceholder')}
              disabled={isRejecting}
            />
            {rejectErrors.reason ? <p className="form-field-error">{rejectErrors.reason}</p> : null}
          </label>
          <div className="slide-panel-actions">
            <button type="button" className="button" onClick={closeRejectPanel} disabled={isRejecting}>
              {tCommon('cancel')}
            </button>
            <button type="submit" className="button button-accent" disabled={isRejecting}>
              {isRejecting ? tCommon('working') : t('rejectPanel.submitButton')}
            </button>
          </div>
        </form>
      </SlidePanel>

      <SlidePanel
        isOpen={Boolean(disburseTarget)}
        title={t('disbursePanel.title')}
        description={
          disburseTarget
            ? t('disbursePanel.description', { name: disburseTarget.employeeName })
            : undefined
        }
        onClose={closeDisbursePanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={submitDisbursement}>
          <label className="form-field">
            <span className="form-label">{t('disbursePanel.referenceLabel')}</span>
            <input
              className={disburseErrors.reimbursementReference ? "form-input form-input-error" : "form-input"}
              value={disburseValues.reimbursementReference}
              onChange={handleDisburseFieldChange("reimbursementReference")}
              placeholder={t('disbursePanel.referencePlaceholder')}
              disabled={isDisbursing}
            />
            {disburseErrors.reimbursementReference ? (
              <p className="form-field-error">{disburseErrors.reimbursementReference}</p>
            ) : null}
          </label>
          <label className="form-field">
            <span className="form-label">{t('disbursePanel.notesLabel')}</span>
            <textarea
              className="form-input"
              rows={3}
              value={disburseValues.reimbursementNotes}
              onChange={handleDisburseFieldChange("reimbursementNotes")}
              placeholder={t('disbursePanel.notesPlaceholder')}
              disabled={isDisbursing}
            />
          </label>
          <div className="form-field">
            <span className="form-label">{t('disbursePanel.paymentProofLabel')}</span>
            <p className="form-hint">{t('disbursePanel.paymentProofHint')}</p>
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
                        paymentProof: t('validation.paymentProofRequired')
                      }));
                      if (paymentProofInputRef.current) {
                        paymentProofInputRef.current.value = "";
                      }
                    }}
                    disabled={isDisbursing}
                  >
                    {t('disbursePanel.removeFile')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="button"
                  onClick={() => paymentProofInputRef.current?.click()}
                  disabled={isDisbursing}
                >
                  {t('disbursePanel.chooseFile')}
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
              {tCommon('cancel')}
            </button>
            <button type="submit" className="button button-accent" disabled={isDisbursing}>
              {isDisbursing ? tCommon('working') : t('disbursePanel.submitButton')}
            </button>
          </div>
        </form>
      </SlidePanel>

      <SlidePanel
        isOpen={Boolean(requestInfoTarget)}
        title={t('requestInfoPanel.title')}
        description={
          requestInfoTarget
            ? stage === "finance"
              ? t('requestInfoPanel.descriptionFinance', { name: requestInfoTarget.employeeName })
              : t('requestInfoPanel.description', { name: requestInfoTarget.employeeName })
            : undefined
        }
        onClose={closeRequestInfoPanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={submitRequestInfo}>
          <section className="settings-card" aria-label={t('requestInfoPanel.conversationAriaLabel')}>
            <h3 className="section-title">{t('requestInfoPanel.conversationTitle')}</h3>
            {isLoadingRequestInfoThread ? (
              <p className="settings-card-description">{t('requestInfoPanel.loadingConversation')}</p>
            ) : requestInfoThread.length === 0 ? (
              <p className="settings-card-description">{t('requestInfoPanel.noMessages')}</p>
            ) : (
              <ul className="compensation-history-list">
                {requestInfoThread.map((comment) => (
                  <li key={comment.id} className="compensation-history-item">
                    <div className="compensation-history-item-title">
                      <span>{comment.authorName}</span>
                      <StatusBadge tone={comment.commentType === "request_info" ? "warning" : "info"}>
                        {comment.commentType === "request_info" ? t('requestInfoPanel.requestedInfoBadge') : t('requestInfoPanel.responseBadge')}
                      </StatusBadge>
                    </div>
                    {comment.message ? <p>{comment.message}</p> : null}
                    {comment.attachments.length > 0 ? (
                      <ul className="expense-comment-attachments">
                        {comment.attachments.map((attachment) => {
                          const loadingKey = `comment-${attachment.id}`;
                          return (
                            <li key={attachment.id} className="expense-comment-attachments-item">
                              <div className="expense-comment-attachment-meta">
                                <span className="expense-comment-attachment-name">{attachment.fileName}</span>
                                <span className="expense-comment-attachment-type">
                                  {attachment.mimeType.startsWith("image/") ? t('requestInfoPanel.imageAttachment') : t('requestInfoPanel.fileAttachment')}
                                </span>
                              </div>
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => {
                                  void openCommentAttachment(requestInfoTarget?.id ?? "", attachment.id, attachment.fileName);
                                }}
                                disabled={Boolean(isOpeningReceiptById[loadingKey]) || !requestInfoTarget}
                              >
                                {isOpeningReceiptById[loadingKey] ? t('actions.opening') : t('requestInfoPanel.openAttachment')}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                    <p className="compensation-history-item-meta" title={formatDateTimeTooltip(comment.createdAt, locale)}>
                      {formatRelativeTime(comment.createdAt, locale)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <label className="form-field">
            <span className="form-label">{t('requestInfoPanel.messageLabel')}</span>
            <textarea
              className={requestInfoErrors.message ? "form-input form-input-error" : "form-input"}
              rows={4}
              value={requestInfoMessage}
              onChange={handleRequestInfoMessageChange}
              placeholder={t('requestInfoPanel.messagePlaceholder')}
              disabled={isRequestingInfo}
            />
            {requestInfoErrors.message ? (
              <p className="form-field-error">{requestInfoErrors.message}</p>
            ) : null}
          </label>
          <div className="form-field">
            <span className="form-label">{t('requestInfoPanel.attachmentsLabel')}</span>
            <FileAttachmentPicker
              files={requestInfoFiles}
              accept=".pdf,.png,.jpg,.jpeg"
              disabled={isRequestingInfo}
              buttonLabel={t('requestInfoPanel.chooseAttachments')}
              hint={t('requestInfoPanel.attachmentsHint')}
              emptyLabel={t('requestInfoPanel.noAttachmentsSelected')}
              removeLabel={t('requestInfoPanel.removeAttachment')}
              onFilesSelected={handleRequestInfoFilesSelected}
              onRemoveFile={removeRequestInfoFile}
            />
          </div>
          <div className="slide-panel-actions">
            <button
              type="button"
              className="button"
              onClick={closeRequestInfoPanel}
              disabled={isRequestingInfo}
            >
              {tCommon('cancel')}
            </button>
            <button type="submit" className="button button-accent" disabled={isRequestingInfo}>
              {isRequestingInfo ? t('requestInfoPanel.sending') : t('requestInfoPanel.submitButton')}
            </button>
          </div>
        </form>
      </SlidePanel>

      <ConfirmDialog
        isOpen={Boolean(confirmApproveTarget)}
        title={t('confirmApprove.title')}
        description={
          confirmApproveTarget
            ? t('confirmApprove.description', { name: confirmApproveTarget.employeeName })
            : undefined
        }
        confirmLabel={t('confirmApprove.confirmLabel')}
        cancelLabel={tCommon('cancel')}
        isConfirming={Boolean(isMutatingId)}
        onCancel={closeApproveConfirm}
        onConfirm={() => {
          void confirmSingleApprove();
        }}
      />

      <ConfirmDialog
        isOpen={showBulkConfirm}
        title={t('confirmBulkApprove.title')}
        description={t('confirmBulkApprove.description', { count: selectedIds.length })}
        confirmLabel={t('confirmBulkApprove.confirmLabel')}
        cancelLabel={tCommon('cancel')}
        isConfirming={isBulkApproving}
        onCancel={closeBulkApproveConfirm}
        onConfirm={() => {
          void confirmBulkApprove();
        }}
      />

      {receiptLightbox ? (
        <ReceiptLightbox
          key={receiptLightbox.items[0]?.url ?? receiptLightbox.label}
          data={receiptLightbox}
          downloadLabel={tCommon('download')}
          onClose={() => setReceiptLightbox(null)}
        />
      ) : null}

      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast-message toast-message-${toast.variant}`}>
            <span>{toast.message}</span>
            <button
              type="button"
              className="toast-dismiss"
              aria-label={t('dismissNotification')}
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
