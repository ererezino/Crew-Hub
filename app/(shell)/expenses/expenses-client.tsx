"use client";

import Link from "next/link";
import {
  Fragment,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { z } from "zod";
import { useLocale, useTranslations } from "next-intl";

import { EmptyState } from "../../../components/shared/empty-state";
import { ContextualHelp } from "../../../components/shared/contextual-help";
import { PageHeader } from "../../../components/shared/page-header";
import { SlidePanel } from "../../../components/shared/slide-panel";
import { StatusBadge } from "../../../components/shared/status-badge";
import { FileAttachmentPicker } from "../../../components/shared/file-attachment-picker";
import { CurrencyDisplay } from "../../../components/ui/currency-display";
import { MoneyInput } from "../../../components/ui/money-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { useExpenses } from "../../../hooks/use-expenses";
import { useUnsavedGuard } from "../../../hooks/use-unsaved-guard";
import { countryFlagFromCode, countryNameFromCode } from "../../../lib/countries";
import {
  formatDateTimeTooltip,
  formatRelativeTime,
  formatSingleDateHuman,
  todayIsoDate
} from "../../../lib/datetime";
import {
  ALLOWED_RECEIPT_EXTENSIONS,
  currentMonthKey,
  EXPENSE_CATEGORY_GUIDANCE,
  formatMonthLabel,
  getExpenseCategoryLabel,
  getExpenseStatusLabel,
  isAllowedReceiptUpload,
  MAX_EXPENSE_ATTACHMENTS,
  MAX_RECEIPT_FILE_BYTES,
  toneForExpenseStatus
} from "../../../lib/expenses";
import {
  buildExpenseImportTemplateCsv,
  parseExpenseImportCsv,
  type ExpenseCsvImportRow
} from "../../../lib/expenses/csv-import";
import { useVendorBeneficiaries } from "../../../hooks/use-vendor-beneficiaries";
import { useMePaymentDetails } from "../../../hooks/use-payment-details";
import { ChevronLeft, ChevronRight, Receipt, X } from "lucide-react";
import type {
  ExpenseAttachmentsListResponse,
  ExpenseCommentAttachmentSignedUrlResponse,
  CreateExpenseCommentResponse,
  CreateExpenseResponse,
  ExpenseCommentRecord,
  ExpenseCategory,
  ExpenseCommentsResponse,
  ExpenseReceiptSignedUrlResponse,
  ExpenseRecord,
  ExpensesListResponseData,
  ExpenseType,
  UpdateExpenseResponse
} from "../../../types/expenses";
import { humanizeError } from "@/lib/errors";

type AppLocale = "en" | "fr";

type SortDirection = "asc" | "desc";
type ToastVariant = "success" | "error" | "info";

type ToastMessage = {
  id: string;
  variant: ToastVariant;
  message: string;
};

type VendorPaymentMethodOption = "bank_transfer" | "mobile_money" | "crew_tag" | "international_wire";

type ExpenseFormValues = {
  expenseType: ExpenseType;
  category: ExpenseCategory;
  customCategory: string;
  description: string;
  amount: string;
  expenseDate: string;
  currency: string;
  vendorName: string;
  vendorPaymentMethod: VendorPaymentMethodOption;
  vendorBankAccountName: string;
  vendorBankAccountNumber: string;
  vendorMobileMoneyProvider: string;
  vendorMobileMoneyNumber: string;
  vendorCrewTag: string;
  vendorWireBankName: string;
  vendorWireAccountNumber: string;
  vendorWireSwiftBic: string;
  vendorWireIban: string;
  vendorWireBankCountry: string;
  vendorWireCurrency: string;
  saveVendor: boolean;
};

type ExpenseFormField = keyof ExpenseFormValues | "receipt";
type ExpenseFormErrors = Partial<Record<ExpenseFormField, string>>;
type ExpenseFormTouched = Record<ExpenseFormField, boolean>;

type ImportedExpensePreview = {
  rowNumber: number;
  values: ExpenseFormValues | null;
  error: string | null;
};

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
    "marketing",
    "other"
  ]),
  description: z.string().trim().min(1, "validation.descriptionRequired").max(3000, "validation.descriptionTooLong"),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "validation.amountInvalid"),
  expenseDate: z.iso.date(),
  currency: z.string().trim().length(3, "validation.currencyLength")
});

const INITIAL_FORM_VALUES: ExpenseFormValues = {
  expenseType: "work_expense",
  category: "travel",
  customCategory: "",
  description: "",
  amount: "",
  expenseDate: todayIsoDate(),
  currency: "USD",
  vendorName: "",
  vendorPaymentMethod: "bank_transfer",
  vendorBankAccountName: "",
  vendorBankAccountNumber: "",
  vendorMobileMoneyProvider: "",
  vendorMobileMoneyNumber: "",
  vendorCrewTag: "",
  vendorWireBankName: "",
  vendorWireAccountNumber: "",
  vendorWireSwiftBic: "",
  vendorWireIban: "",
  vendorWireBankCountry: "",
  vendorWireCurrency: "",
  saveVendor: false
};

const INITIAL_TOUCHED: ExpenseFormTouched = {
  expenseType: false,
  category: false,
  customCategory: false,
  description: false,
  amount: false,
  expenseDate: false,
  currency: false,
  receipt: false,
  vendorName: false,
  vendorPaymentMethod: false,
  vendorBankAccountName: false,
  vendorBankAccountNumber: false,
  vendorMobileMoneyProvider: false,
  vendorMobileMoneyNumber: false,
  vendorCrewTag: false,
  vendorWireBankName: false,
  vendorWireAccountNumber: false,
  vendorWireSwiftBic: false,
  vendorWireIban: false,
  vendorWireBankCountry: false,
  vendorWireCurrency: false,
  saveVendor: false
};

const ALL_TOUCHED: ExpenseFormTouched = {
  expenseType: true,
  category: true,
  customCategory: true,
  description: true,
  amount: true,
  expenseDate: true,
  currency: true,
  receipt: true,
  vendorName: true,
  vendorPaymentMethod: true,
  vendorBankAccountName: true,
  vendorBankAccountNumber: true,
  vendorMobileMoneyProvider: true,
  vendorMobileMoneyNumber: true,
  vendorCrewTag: true,
  vendorWireBankName: true,
  vendorWireAccountNumber: true,
  vendorWireSwiftBic: true,
  vendorWireIban: true,
  vendorWireBankCountry: true,
  vendorWireCurrency: true,
  saveVendor: true
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
  "marketing",
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

function buildExpenseSubmissionFormData(values: ExpenseFormValues, receiptFiles: File[]): FormData {
  const amountMinorUnits = parseMoneyToMinorUnits(values.amount);

  if (amountMinorUnits === null) {
    throw new Error("Amount must be a positive value with up to 2 decimals.");
  }

  const formData = new FormData();
  formData.set("expenseType", values.expenseType);
  formData.set("category", values.category);
  if (values.category === "other" && values.customCategory.trim()) {
    formData.set("customCategory", values.customCategory.trim());
  }
  formData.set("description", values.description.trim());
  formData.set("amount", String(amountMinorUnits));
  formData.set("expenseDate", values.expenseDate);
  formData.set("currency", values.currency.trim().toUpperCase());
  for (const file of receiptFiles) {
    formData.append("receipts", file);
  }

  if (values.expenseType === "work_expense") {
    formData.set("vendorName", values.vendorName.trim());
    formData.set("vendorPaymentMethod", values.vendorPaymentMethod);
    formData.set("vendorBankAccountName", values.vendorBankAccountName.trim());
    formData.set("vendorBankAccountNumber", values.vendorBankAccountNumber.trim());
    formData.set("vendorMobileMoneyProvider", values.vendorMobileMoneyProvider.trim());
    formData.set("vendorMobileMoneyNumber", values.vendorMobileMoneyNumber.trim());
    formData.set("vendorCrewTag", values.vendorCrewTag.trim());
    formData.set("vendorWireBankName", values.vendorWireBankName.trim());
    formData.set("vendorWireAccountNumber", values.vendorWireAccountNumber.trim());
    formData.set("vendorWireSwiftBic", values.vendorWireSwiftBic.trim());
    formData.set("vendorWireIban", values.vendorWireIban.trim());
    formData.set("vendorWireBankCountry", values.vendorWireBankCountry.trim());
    formData.set("vendorWireCurrency", values.vendorWireCurrency.trim());
    if (values.saveVendor) {
      formData.set("saveVendor", "true");
    }
  }

  return formData;
}

function hasFormErrors(errors: ExpenseFormErrors): boolean {
  return Object.values(errors).some((error) => Boolean(error));
}

function validateReceipt(files: File[], td: (key: string) => string): string | undefined {
  if (files.length === 0) {
    return td("validation.receiptRequired");
  }

  for (const file of files) {
    if (file.size > MAX_RECEIPT_FILE_BYTES) {
      return td("validation.receiptTooLarge");
    }

    if (!isAllowedReceiptUpload(file.name, file.type)) {
      return td("validation.receiptUnsupportedType");
    }
  }

  return undefined;
}

function getFormErrors(
  values: ExpenseFormValues,
  touched: ExpenseFormTouched,
  receipt: File[],
  td: (key: string) => string
): ExpenseFormErrors {
  const parsed = expenseFormSchema.safeParse(values);
  const errors: ExpenseFormErrors = {};

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    errors.category = touched.category ? (fieldErrors.category?.[0] ? td(fieldErrors.category[0]) : undefined) : undefined;
    errors.description = touched.description ? (fieldErrors.description?.[0] ? td(fieldErrors.description[0]) : undefined) : undefined;
    errors.amount = touched.amount ? (fieldErrors.amount?.[0] ? td(fieldErrors.amount[0]) : undefined) : undefined;
    errors.expenseDate = touched.expenseDate ? (fieldErrors.expenseDate?.[0] ? td(fieldErrors.expenseDate[0]) : undefined) : undefined;
    errors.currency = touched.currency ? (fieldErrors.currency?.[0] ? td(fieldErrors.currency[0]) : undefined) : undefined;
  }

  if (touched.amount && parseMoneyToMinorUnits(values.amount) === null) {
    errors.amount = td("validation.amountPositive");
  }

  if (touched.receipt) {
    errors.receipt = validateReceipt(receipt, td);
  }

  if (values.category === "other" && touched.customCategory && !values.customCategory.trim()) {
    errors.customCategory = td("validation.customCategoryRequired");
  }

  if (values.expenseType === "work_expense") {
    if (touched.vendorName && !values.vendorName.trim()) {
      errors.vendorName = td("validation.vendorNameRequired");
    }

    // Bank fields only required when vendor payment method is bank_transfer
    if (values.vendorPaymentMethod === "bank_transfer") {
      if (touched.vendorBankAccountName && !values.vendorBankAccountName.trim()) {
        errors.vendorBankAccountName = td("validation.bankAccountNameRequired");
      }

      if (touched.vendorBankAccountNumber && !values.vendorBankAccountNumber.trim()) {
        errors.vendorBankAccountNumber = td("validation.bankAccountNumberRequired");
      }
    }
  }

  return errors;
}

function firstExpenseFormError(errors: ExpenseFormErrors): string | null {
  const orderedFields: ExpenseFormField[] = [
    "expenseType",
    "category",
    "customCategory",
    "description",
    "amount",
    "expenseDate",
    "currency",
    "vendorName",
    "vendorPaymentMethod",
    "vendorBankAccountName",
    "vendorBankAccountNumber",
    "vendorMobileMoneyProvider",
    "vendorMobileMoneyNumber",
    "vendorCrewTag",
    "vendorWireBankName",
    "vendorWireAccountNumber",
    "vendorWireSwiftBic",
    "vendorWireIban",
    "vendorWireBankCountry",
    "vendorWireCurrency",
    "receipt"
  ];

  for (const field of orderedFields) {
    const error = errors[field];
    if (error) {
      return error;
    }
  }

  return null;
}

function normalizeImportedExpenseRow(
  row: ExpenseCsvImportRow,
  td: (key: string, params?: Record<string, unknown>) => string
): ImportedExpensePreview {
  const expenseType = row.expenseType === "work_expense" || row.expenseType === "personal_reimbursement"
    ? row.expenseType
    : null;
  if (!expenseType) {
    return {
      rowNumber: row.rowNumber,
      values: null,
      error: td("validation.csvInvalidExpenseType", {
        row: row.rowNumber,
        value: row.expenseType
      })
    };
  }

  const category = categoryOptions.includes(row.category as ExpenseCategory)
    ? (row.category as ExpenseCategory)
    : null;
  if (!category) {
    return {
      rowNumber: row.rowNumber,
      values: null,
      error: td("validation.csvInvalidCategory", {
        row: row.rowNumber,
        value: row.category
      })
    };
  }

  const vendorPaymentMethod = (
    ["bank_transfer", "mobile_money", "crew_tag", "international_wire"] as const
  ).includes(row.vendorPaymentMethod as VendorPaymentMethodOption)
    ? (row.vendorPaymentMethod as VendorPaymentMethodOption)
    : null;
  if (!vendorPaymentMethod) {
    return {
      rowNumber: row.rowNumber,
      values: null,
      error: td("validation.csvInvalidVendorPaymentMethod", {
        row: row.rowNumber,
        value: row.vendorPaymentMethod
      })
    };
  }

  const values: ExpenseFormValues = {
    expenseType,
    category,
    customCategory: row.customCategory,
    description: row.description,
    amount: row.amount,
    expenseDate: row.expenseDate,
    currency: row.currency.toUpperCase(),
    vendorName: row.vendorName,
    vendorPaymentMethod,
    vendorBankAccountName: row.vendorBankAccountName,
    vendorBankAccountNumber: row.vendorBankAccountNumber,
    vendorMobileMoneyProvider: row.vendorMobileMoneyProvider,
    vendorMobileMoneyNumber: row.vendorMobileMoneyNumber,
    vendorCrewTag: row.vendorCrewTag,
    vendorWireBankName: row.vendorWireBankName,
    vendorWireAccountNumber: row.vendorWireAccountNumber,
    vendorWireSwiftBic: row.vendorWireSwiftBic,
    vendorWireIban: row.vendorWireIban,
    vendorWireBankCountry: row.vendorWireBankCountry,
    vendorWireCurrency: row.vendorWireCurrency.toUpperCase(),
    saveVendor: false
  };

  const validationErrors = getFormErrors(
    values,
    { ...ALL_TOUCHED, receipt: false },
    [],
    td
  );
  const firstError = firstExpenseFormError(validationErrors);

  return {
    rowNumber: row.rowNumber,
    values,
    error: firstError
      ? td("validation.csvRowError", { row: row.rowNumber, message: firstError })
      : null
  };
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

  if (category === "marketing") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M19 4L10 8H5v8h5l9 4V4zM22 12h-2M22 8h-3M22 16h-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
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
      <div className="table-skeleton">
        <div className="table-skeleton-header" />
        {Array.from({ length: 8 }, (_, index) => (
          <div key={`table-skeleton-${index}`} className="table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

function ExpenseTimelineItem({
  title,
  timestamp,
  description,
  tone,
  locale,
  pendingLabel
}: {
  title: string;
  timestamp: string | null;
  description: string;
  tone: "pending" | "success" | "error" | "info";
  locale: AppLocale;
  pendingLabel: string;
}) {
  return (
    <li className={`expenses-timeline-item expenses-timeline-item-${tone}`}>
      <div className="expenses-timeline-marker" aria-hidden="true" />
      <div className="expenses-timeline-main">
        <p className="expenses-timeline-title">{title}</p>
        <p className="expenses-timeline-description">{description}</p>
      </div>
      <p className="expenses-timeline-time" title={timestamp ? formatDateTimeTooltip(timestamp, locale) : undefined}>
        {timestamp ? formatRelativeTime(timestamp, locale) : pendingLabel}
      </p>
    </li>
  );
}

/* ─── Receipt / payment-proof lightbox ─── */

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
  onClose
}: {
  data: ReceiptLightboxData;
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
        </div>
      </div>
    </div>
  );
}

export function ExpensesClient({
  currentUserId,
  canViewReports,
  showEmployeeColumn,
  initialExpensesData
}: {
  currentUserId: string;
  canViewReports: boolean;
  showEmployeeColumn: boolean;
  initialExpensesData?: ExpensesListResponseData;
}) {
  const t = useTranslations('expenses');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const td = t as (key: string, params?: Record<string, unknown>) => string;

  const [month, setMonth] = useState(currentMonthKey());
  const expensesQuery = useExpenses({ month, initialData: initialExpensesData });
  const vendorBeneficiaries = useVendorBeneficiaries();
  const mePaymentDetails = useMePaymentDetails();
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isDraggingReceipt, setIsDraggingReceipt] = useState(false);
  const [formValues, setFormValues] = useState<ExpenseFormValues>(INITIAL_FORM_VALUES);
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [formTouched, setFormTouched] = useState<ExpenseFormTouched>(INITIAL_TOUCHED);
  const [formErrors, setFormErrors] = useState<ExpenseFormErrors>({});
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const [importedExpenseRows, setImportedExpenseRows] = useState<ExpenseCsvImportRow[]>([]);
  const [importedExpenseFileName, setImportedExpenseFileName] = useState<string | null>(null);
  const [importCsvError, setImportCsvError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [, setUploadProgress] = useState(0);
  const [isOpeningReceiptById, setIsOpeningReceiptById] = useState<Record<string, boolean>>({});
  const [receiptLightbox, setReceiptLightbox] = useState<ReceiptLightboxData | null>(null);
  const [isMutatingExpenseId, setIsMutatingExpenseId] = useState<string | null>(null);
  const [expandedExpenseId, setExpandedExpenseId] = useState<string | null>(null);
  const [commentsByExpenseId, setCommentsByExpenseId] = useState<Record<string, ExpenseCommentRecord[]>>({});
  const [canReplyByExpenseId, setCanReplyByExpenseId] = useState<Record<string, boolean>>({});
  const [isLoadingCommentsByExpenseId, setIsLoadingCommentsByExpenseId] = useState<Record<string, boolean>>({});
  const [commentDraftByExpenseId, setCommentDraftByExpenseId] = useState<Record<string, string>>({});
  const [commentFilesByExpenseId, setCommentFilesByExpenseId] = useState<Record<string, File[]>>({});
  const [commentErrorByExpenseId, setCommentErrorByExpenseId] = useState<Record<string, string | null>>({});
  const [isSubmittingCommentByExpenseId, setIsSubmittingCommentByExpenseId] = useState<Record<string, boolean>>({});
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const receiptInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const importCsvInputRef = useRef<HTMLInputElement | null>(null);
  const [expenseFormDirty, setExpenseFormDirty] = useState(false);
  useUnsavedGuard(expenseFormDirty);

  const selectedCategoryGuidance = EXPENSE_CATEGORY_GUIDANCE[formValues.category];

  const contextualHelpItems = [
    {
      title: t('contextualHelp.receiptChecklistTitle'),
      description: t('contextualHelp.receiptChecklistDescription')
    },
    {
      title: t('contextualHelp.approvalFlowTitle'),
      description: t('contextualHelp.approvalFlowDescription')
    },
    {
      title: t('contextualHelp.policyReferenceTitle'),
      description: t('contextualHelp.policyReferenceDescription'),
      ctaLabel: t('contextualHelp.policyReferenceCta'),
      ctaHref: "/documents"
    }
  ] as const;

  const summaryCurrency = useMemo(() => {
    const rows = expensesQuery.data?.expenses ?? [];
    return rows.length > 0 ? rows[0].currency : "USD";
  }, [expensesQuery.data?.expenses]);

  const importedExpensePreviews = useMemo(
    () => importedExpenseRows.map((row) => normalizeImportedExpenseRow(row, td)),
    [importedExpenseRows, td]
  );

  const importedExpenseRowErrorCount = useMemo(
    () => importedExpensePreviews.filter((row) => row.error).length,
    [importedExpensePreviews]
  );

  const importedExpenseTotalByCurrency = useMemo(() => {
    return importedExpensePreviews.reduce<Record<string, number>>((totals, row) => {
      if (!row.values) {
        return totals;
      }

      const amount = parseMoneyToMinorUnits(row.values.amount);
      if (amount === null) {
        return totals;
      }

      const currency = row.values.currency.toUpperCase();
      return {
        ...totals,
        [currency]: (totals[currency] ?? 0) + amount
      };
    }, {});
  }, [importedExpensePreviews]);

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

  const showToast = (variant: ToastVariant, rawMessage: string) => {
    const message = variant === "error" ? humanizeError(rawMessage) : rawMessage;
    const toastId = createToastId();
    setToasts((currentToasts) => [...currentToasts, { id: toastId, variant, message }]);

    window.setTimeout(() => {
      dismissToast(toastId);
    }, 4000);
  };

  const getDisplayStatusLabel = (expense: ExpenseRecord) => {
    if (expense.infoRequestState === "requested") {
      return t('infoRequests.actionNeeded');
    }

    return getExpenseStatusLabel(expense.status);
  };

  const getDisplayStatusTone = (expense: ExpenseRecord) => {
    if (expense.infoRequestState === "requested") {
      return "warning" as const;
    }

    return toneForExpenseStatus(expense.status);
  };

  const openPanel = () => {
    setIsPanelOpen(true);
    setFormValues({
      ...INITIAL_FORM_VALUES,
      expenseDate: todayIsoDate()
    });
    setSelectedVendorId("");
    setFormTouched(INITIAL_TOUCHED);
    setFormErrors({});
    setReceiptFiles([]);
    setImportedExpenseRows([]);
    setImportedExpenseFileName(null);
    setImportCsvError(null);
    setSubmitError(null);
    setUploadProgress(0);
  };

  const closePanel = () => {
    if (isSubmitting) {
      return;
    }

    setIsPanelOpen(false);
    setFormValues(INITIAL_FORM_VALUES);
    setSelectedVendorId("");
    setFormTouched(INITIAL_TOUCHED);
    setFormErrors({});
    setReceiptFiles([]);
    setImportedExpenseRows([]);
    setImportedExpenseFileName(null);
    setImportCsvError(null);
    setSubmitError(null);
    setUploadProgress(0);
    setIsDraggingReceipt(false);
    setExpenseFormDirty(false);
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
      setExpenseFormDirty(true);

      if (formTouched[field]) {
        setFormErrors(getFormErrors(nextValues, formTouched, receiptFiles, td));
      }

      if (submitError) {
        setSubmitError(null);
      }
    };

  const handleFormChange = (field: keyof ExpenseFormValues, value: string | boolean) => {
    const nextValues = {
      ...formValues,
      [field]: value
    };

    setFormValues(nextValues);
    setExpenseFormDirty(true);

    if (formTouched[field as ExpenseFormField]) {
      setFormErrors(getFormErrors(nextValues, formTouched, receiptFiles, td));
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
    setFormErrors(getFormErrors(formValues, nextTouched, receiptFiles, td));
  };

  const handleVendorInputChange =
    (field: "vendorName" | "vendorBankAccountName" | "vendorBankAccountNumber" | "vendorMobileMoneyProvider" | "vendorMobileMoneyNumber" | "vendorCrewTag" | "vendorWireBankName" | "vendorWireAccountNumber" | "vendorWireSwiftBic" | "vendorWireIban" | "vendorWireBankCountry" | "vendorWireCurrency") =>
    (value: string) => {
      const nextValues = {
        ...formValues,
        [field]: value,
        saveVendor: selectedVendorId ? false : formValues.saveVendor
      };

      setFormValues(nextValues);
      if (selectedVendorId) {
        setSelectedVendorId("");
      }
      setExpenseFormDirty(true);

      if (formTouched[field]) {
        setFormErrors(getFormErrors(nextValues, formTouched, receiptFiles, td));
      }

      if (submitError) {
        setSubmitError(null);
      }
    };

  const handleReceiptSelection = (incoming: File[]) => {
    const nextTouched = {
      ...formTouched,
      receipt: true
    };

    const merged = [...receiptFiles, ...incoming].slice(0, MAX_EXPENSE_ATTACHMENTS);
    setReceiptFiles(merged);
    setFormTouched(nextTouched);
    setFormErrors(getFormErrors(formValues, nextTouched, merged, td));
    setSubmitError(null);
    setUploadProgress(0);
  };

  const removeReceiptAt = (index: number) => {
    const merged = receiptFiles.filter((_, fileIndex) => fileIndex !== index);
    setReceiptFiles(merged);
    setFormErrors(getFormErrors(formValues, { ...formTouched, receipt: true }, merged, td));
    setSubmitError(null);
  };

  const handleReceiptInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    if (files.length > 0) {
      handleReceiptSelection(files);
    }
    // Allow re-selecting the same file after removal.
    event.currentTarget.value = "";
  };

  const clearImportedExpenses = () => {
    setImportedExpenseRows([]);
    setImportedExpenseFileName(null);
    setImportCsvError(null);
    setSubmitError(null);
    setExpenseFormDirty(receiptFiles.length > 0);
    if (importCsvInputRef.current) {
      importCsvInputRef.current.value = "";
    }
  };

  const handleImportCsvSelection = async (file: File | null) => {
    if (!file) {
      clearImportedExpenses();
      return;
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportCsvError(td("validation.csvUnsupportedType"));
      return;
    }

    try {
      const csvText = await file.text();
      const parsed = parseExpenseImportCsv(csvText);

      if (parsed.errors.length > 0) {
        setImportedExpenseRows([]);
        setImportedExpenseFileName(file.name);
        setImportCsvError(parsed.errors[0] ?? td("toast.unableToImportCsv"));
        return;
      }

      setImportedExpenseRows(parsed.rows);
      setImportedExpenseFileName(file.name);
      setImportCsvError(null);
      setSubmitError(null);
      setExpenseFormDirty(true);
      showToast("success", td("toast.csvImportedReady", { count: parsed.rows.length }));
    } catch {
      setImportedExpenseRows([]);
      setImportedExpenseFileName(file.name);
      setImportCsvError(td("toast.unableToImportCsv"));
    }
  };

  const handleImportCsvInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    await handleImportCsvSelection(file);
  };

  const downloadCsvTemplate = () => {
    const csv = buildExpenseImportTemplateCsv();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "crew-hub-expense-import-template.csv";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
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
    const droppedFiles = Array.from(event.dataTransfer.files ?? []);
    if (droppedFiles.length > 0) {
      handleReceiptSelection(droppedFiles);
    }
  };

  const handleSubmitExpense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (importedExpenseRows.length > 0) {
      if (receiptFiles.length === 0) {
        setFormTouched((currentTouched) => ({
          ...currentTouched,
          receipt: true
        }));
        setFormErrors((currentErrors) => ({
          ...currentErrors,
          receipt: td("validation.receiptRequired")
        }));
        return;
      }

      if (importedExpenseRowErrorCount > 0) {
        setSubmitError(td("toast.csvImportHasErrors", { count: importedExpenseRowErrorCount }));
        return;
      }

      const validRows = importedExpensePreviews
        .map((row) => row.values)
        .filter((row): row is ExpenseFormValues => row !== null);

      if (validRows.length === 0) {
        setSubmitError(td("validation.csvNoRows"));
        return;
      }

      setIsSubmitting(true);
      setSubmitError(null);
      setUploadProgress(0);

      let createdCount = 0;
      let shouldRefreshVendors = false;

      try {
        for (const [index, rowValues] of validRows.entries()) {
          const formData = buildExpenseSubmissionFormData(rowValues, receiptFiles);
          const result = await uploadExpenseWithProgress(formData, (progress) => {
            const normalizedProgress = Math.round(
              ((index + progress / 100) / validRows.length) * 100
            );
            setUploadProgress(normalizedProgress);
          });

          if (result.status < 200 || result.status > 299 || !result.payload?.data?.expense) {
            setSubmitError(
              td("toast.csvImportPartialFailure", {
                created: createdCount,
                total: validRows.length,
                row: importedExpensePreviews[index]?.rowNumber ?? index + 2
              })
            );
            expensesQuery.refresh();
            return;
          }

          createdCount += 1;
          shouldRefreshVendors = shouldRefreshVendors || rowValues.saveVendor;
        }

        closePanel();
        expensesQuery.refresh();
        if (shouldRefreshVendors) {
          vendorBeneficiaries.refresh();
        }
        showToast("success", td("toast.csvImportSubmitted", { count: createdCount }));
      } catch {
        setSubmitError(
          td("toast.csvImportPartialFailure", {
            created: createdCount,
            total: validRows.length,
            row: importedExpensePreviews[createdCount]?.rowNumber ?? createdCount + 2
          })
        );
        expensesQuery.refresh();
      } finally {
        setIsSubmitting(false);
      }

      return;
    }

    setFormTouched(ALL_TOUCHED);
    const nextErrors = getFormErrors(formValues, ALL_TOUCHED, receiptFiles, td);
    setFormErrors(nextErrors);
    setSubmitError(null);

    if (hasFormErrors(nextErrors) || receiptFiles.length === 0) {
      return;
    }

    const amountMinorUnits = parseMoneyToMinorUnits(formValues.amount);

    if (amountMinorUnits === null) {
      setFormErrors((currentErrors) => ({
        ...currentErrors,
        amount: td("validation.amountPositive")
      }));
      return;
    }

    setIsSubmitting(true);
    setUploadProgress(0);

    try {
      const formData = buildExpenseSubmissionFormData(
        {
          ...formValues,
          saveVendor: formValues.saveVendor && !selectedVendorId
        },
        receiptFiles
      );
      const result = await uploadExpenseWithProgress(formData, setUploadProgress);

      if (result.status < 200 || result.status > 299 || !result.payload?.data?.expense) {
        setSubmitError(result.payload?.error?.message ?? td("toast.unableToSubmit"));
        return;
      }

      closePanel();
      expensesQuery.refresh();
      if (formValues.saveVendor) {
        vendorBeneficiaries.refresh();
      }
      showToast("success", td("toast.expenseSubmitted"));
    } catch {
      setSubmitError(td("toast.unableToSubmit"));
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

      // Fallback to the legacy single-receipt endpoint.
      const legacyResponse = await fetch(`/api/v1/expenses/${expense.id}/receipt`, { method: "GET" });
      const legacyPayload = (await legacyResponse.json()) as ExpenseReceiptSignedUrlResponse;

      if (!legacyResponse.ok || !legacyPayload.data?.url) {
        showToast("error", legacyPayload.error?.message ?? td("toast.unableToOpenReceipt"));
        return;
      }

      setReceiptLightbox({
        items: [{ url: legacyPayload.data.url, fileName: expense.receiptFileName }],
        index: 0,
        label: expense.receiptFileName
      });
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : td("toast.unableToOpenReceipt"));
    } finally {
      setIsOpeningReceiptById((currentMap) => {
        const nextMap = { ...currentMap };
        delete nextMap[expense.id];
        return nextMap;
      });
    }
  };

  const openPaymentProof = async (expense: ExpenseRecord) => {
    setIsOpeningReceiptById((currentMap) => ({
      ...currentMap,
      [`proof-${expense.id}`]: true
    }));

    try {
      const response = await fetch(`/api/v1/expenses/${expense.id}/payment-proof`, {
        method: "GET"
      });

      const payload = (await response.json()) as ExpenseReceiptSignedUrlResponse;

      if (!response.ok || !payload.data?.url) {
        showToast("error", payload.error?.message ?? td("toast.paymentProofUnavailable"));
        return;
      }

      const proofPath = expense.reimbursementReceiptPath ?? "";
      const proofFileName = proofPath.split("/").pop() ?? "payment-proof";

      setReceiptLightbox({
        items: [{ url: payload.data.url, fileName: proofFileName }],
        index: 0,
        label: td("transactionDetails.viewPaymentProof")
      });
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : td("toast.unableToOpenPaymentProof"));
    } finally {
      setIsOpeningReceiptById((currentMap) => {
        const nextMap = { ...currentMap };
        delete nextMap[`proof-${expense.id}`];
        return nextMap;
      });
    }
  };

  const openCommentAttachment = async (
    expenseId: string,
    attachmentId: string,
    fileName: string
  ) => {
    const loadingKey = `comment-${attachmentId}`;
    setIsOpeningReceiptById((currentMap) => ({
      ...currentMap,
      [loadingKey]: true
    }));

    try {
      const response = await fetch(`/api/v1/expenses/${expenseId}/comments/attachments/${attachmentId}`, {
        method: "GET"
      });

      const payload = (await response.json()) as ExpenseCommentAttachmentSignedUrlResponse;

      if (!response.ok || !payload.data?.url) {
        showToast("error", payload.error?.message ?? td("toast.unableToOpenAttachment"));
        return;
      }

      setReceiptLightbox({
        items: [{ url: payload.data.url, fileName: payload.data.fileName || fileName }],
        index: 0,
        label: payload.data.fileName || fileName
      });
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : td("toast.unableToOpenAttachment"));
    } finally {
      setIsOpeningReceiptById((currentMap) => {
        const nextMap = { ...currentMap };
        delete nextMap[loadingKey];
        return nextMap;
      });
    }
  };

  const loadExpenseComments = async (expenseId: string) => {
    setIsLoadingCommentsByExpenseId((current) => ({
      ...current,
      [expenseId]: true
    }));

    try {
      const response = await fetch(`/api/v1/expenses/${expenseId}/comments`, {
        method: "GET"
      });

      const payload = (await response.json()) as ExpenseCommentsResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? td("toast.unableToLoadConversation"));
        return;
      }

      setCommentsByExpenseId((current) => ({
        ...current,
        [expenseId]: payload.data?.comments ?? []
      }));
      setCanReplyByExpenseId((current) => ({
        ...current,
        [expenseId]: payload.data?.canReply ?? false
      }));
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : td("toast.unableToLoadConversation"));
    } finally {
      setIsLoadingCommentsByExpenseId((current) => ({
        ...current,
        [expenseId]: false
      }));
    }
  };

  const submitExpenseReply = async (expense: ExpenseRecord) => {
    const message = commentDraftByExpenseId[expense.id]?.trim() ?? "";
    const files = commentFilesByExpenseId[expense.id] ?? [];

    if (!message && files.length === 0) {
      setCommentErrorByExpenseId((current) => ({
        ...current,
        [expense.id]: td("validation.responseOrAttachmentRequired")
      }));
      return;
    }

    if (message.length > 2000) {
      setCommentErrorByExpenseId((current) => ({
        ...current,
        [expense.id]: td("validation.responseTooLong")
      }));
      return;
    }

    setCommentErrorByExpenseId((current) => ({
      ...current,
      [expense.id]: null
    }));
    setIsSubmittingCommentByExpenseId((current) => ({
      ...current,
      [expense.id]: true
    }));

    try {
      const formData = new FormData();
      formData.set("action", "response");
      formData.set("message", message);
      files.forEach((file) => {
        formData.append("attachments", file);
      });

      const response = await fetch(`/api/v1/expenses/${expense.id}/comments`, {
        method: "POST",
        body: formData
      });

      const payload = (await response.json()) as CreateExpenseCommentResponse;

      if (!response.ok || !payload.data?.comment) {
        setCommentErrorByExpenseId((current) => ({
          ...current,
          [expense.id]: payload.error?.message ?? td("toast.unableToSendReply")
        }));
        return;
      }
      const createdComment = payload.data.comment;

      setCommentDraftByExpenseId((current) => ({
        ...current,
        [expense.id]: ""
      }));
      setCommentFilesByExpenseId((current) => ({
        ...current,
        [expense.id]: []
      }));
      setCommentsByExpenseId((current) => ({
        ...current,
        [expense.id]: [...(current[expense.id] ?? []), createdComment]
      }));
      setCanReplyByExpenseId((current) => ({
        ...current,
        [expense.id]: false
      }));

      expensesQuery.refresh();
      showToast("success", td("toast.responseSent"));
    } catch (error) {
      setCommentErrorByExpenseId((current) => ({
        ...current,
        [expense.id]: error instanceof Error ? error.message : td("toast.unableToSendReply")
      }));
    } finally {
      setIsSubmittingCommentByExpenseId((current) => ({
        ...current,
        [expense.id]: false
      }));
    }
  };

  const handleCommentFilesSelected = (expenseId: string, files: File[]) => {
    setCommentFilesByExpenseId((current) => ({
      ...current,
      [expenseId]: files
    }));

    if (files.length > 0) {
      setCommentErrorByExpenseId((current) => ({
        ...current,
        [expenseId]: null
      }));
    }
  };

  const removeCommentFile = (expenseId: string, index: number) => {
    setCommentFilesByExpenseId((current) => ({
      ...current,
      [expenseId]: (current[expenseId] ?? []).filter((_, currentIndex) => currentIndex !== index)
    }));
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
        showToast("error", payload.error?.message ?? td("toast.unableToUpdate"));
        return;
      }

      expensesQuery.refresh();
      showToast("success", td("toast.expenseCancelled"));
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : td("toast.unableToUpdate"));
    } finally {
      setIsMutatingExpenseId(null);
    }
  };

  return (
    <>
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        actions={
          <>
            {canViewReports ? (
              <Link className="button" href="/expenses/reports">
                {t('actions.reports')}
              </Link>
            ) : null}
            <button type="button" className="button button-accent" onClick={openPanel}>
              {t('actions.submitExpense')}
            </button>
          </>
        }
      />

      <ContextualHelp
        title={t('contextualHelp.title')}
        description={t('contextualHelp.description')}
        items={contextualHelpItems}
        ariaLabel={t('contextualHelp.ariaLabel')}
      />

      <section className="expenses-toolbar" aria-label={t('toolbar.ariaLabel')}>
        <div className="expenses-toolbar-copy">
          <label className="form-field">
            <span className="form-label">{t('toolbar.monthLabel')}</span>
            <input
              className="form-input numeric"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.currentTarget.value)}
            />
          </label>
          <p className="settings-card-description">
            {t('toolbar.showingMonth', { month: formatMonthLabel(month) })}
          </p>
        </div>
        <div className="expenses-toolbar-actions">
          <p className="settings-card-description">
            {t('toolbar.reviewTimeline')}
          </p>
          <Link className="button" href="/documents">
            {t('toolbar.viewExpensePolicy')}
          </Link>
        </div>
      </section>

      {expensesQuery.isLoading ? <ExpensesSkeleton /> : null}

      {!expensesQuery.isLoading && expensesQuery.errorMessage ? (
        <>
          <EmptyState
            title={t('emptyState.errorTitle')}
            description={expensesQuery.errorMessage}
            ctaLabel={tCommon('retry')}
            ctaHref="/expenses"
          />
          <button type="button" className="button button-accent" onClick={() => expensesQuery.refresh()}>
            {tCommon('retry')}
          </button>
        </>
      ) : null}

      {!expensesQuery.isLoading && !expensesQuery.errorMessage && expensesQuery.data ? (
        <>
          <section className="expenses-metric-grid" aria-label={t('metrics.ariaLabel')}>
            <article className="metric-card">
              <p className="metric-label">{t('metrics.submittedAmount')}</p>
              <p className="metric-value">
                <CurrencyDisplay amount={expensesQuery.data.summary.totalAmount} currency={summaryCurrency} />
              </p>
              <p className="metric-hint">{t('metrics.submissionCount', { count: expensesQuery.data.summary.totalCount })}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t('metrics.pendingReimbursement')}</p>
              <p className="metric-value">
                <CurrencyDisplay amount={expensesQuery.data.summary.pendingAmount} currency={summaryCurrency} />
              </p>
              <p className="metric-hint">
                {t('metrics.pendingCount', { count: expensesQuery.data.summary.pendingCount + expensesQuery.data.summary.managerApprovedCount })}
              </p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t('metrics.awaitingFinance')}</p>
              <p className="metric-value numeric">
                {expensesQuery.data.summary.managerApprovedCount + expensesQuery.data.summary.approvedCount}
              </p>
              <p className="metric-hint">{t('metrics.awaitingFinanceHint')}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t('metrics.reimbursed')}</p>
              <p className="metric-value numeric">{expensesQuery.data.summary.reimbursedCount}</p>
              <p className="metric-hint">
                <CurrencyDisplay amount={expensesQuery.data.summary.reimbursedAmount} currency={summaryCurrency} />
              </p>
            </article>
          </section>

          {expenses.length === 0 ? (
            <EmptyState
              icon={<Receipt size={32} />}
              title={t('emptyState.title')}
              description={t('emptyState.description')}
              ctaLabel={t('actions.submitExpense')}
              ctaHref="/expenses"
            />
          ) : (
            <section className="data-table-container" aria-label={t('table.ariaLabel')}>
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
                        {t('table.expenseDate')}
                        <span className="numeric">{sortDirection === "asc" ? "\u2191" : "\u2193"}</span>
                      </button>
                    </th>
                    {showEmployeeColumn ? <th>{t('table.employee')}</th> : null}
                    <th>{t('table.category')}</th>
                    <th>{t('table.description')}</th>
                    <th>{t('table.amount')}</th>
                    <th>{t('table.country')}</th>
                    <th>{t('table.status')}</th>
                    <th>{t('table.submitted')}</th>
                    <th className="table-action-column">{t('table.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((expense) => {
                    const isExpanded = expandedExpenseId === expense.id;
                    const commentThread = commentsByExpenseId[expense.id] ?? [];
                    const canReplyToInfoRequest = canReplyByExpenseId[expense.id] ?? false;
                    const commentDraft = commentDraftByExpenseId[expense.id] ?? "";
                    const commentFiles = commentFilesByExpenseId[expense.id] ?? [];
                    const commentError = commentErrorByExpenseId[expense.id] ?? null;
                    const isLoadingComments = isLoadingCommentsByExpenseId[expense.id] ?? false;
                    const isSubmittingComment = isSubmittingCommentByExpenseId[expense.id] ?? false;

                    const managerDescription = expense.managerApprovedByName
                      ? expense.managerActingForName
                        ? td("timeline.approvedByOnBehalf", { name: expense.managerApprovedByName, principal: expense.managerActingForName })
                        : td("timeline.approvedBy", { name: expense.managerApprovedByName })
                      : expense.status === "rejected"
                        ? [
                            expense.managerActingForName
                              ? td("timeline.rejectedByOnBehalf", { name: expense.rejectedByName ?? "Manager", principal: expense.managerActingForName })
                              : td("timeline.rejectedBy", { name: expense.rejectedByName ?? "Manager" }),
                            expense.rejectionReason
                              ? ` ${td("timeline.rejectionReason", { reason: expense.rejectionReason })}`
                              : ""
                          ].join("")
                        : td("timeline.awaitingManager");

                    const additionalDescription = expense.requiresAdditionalApproval
                      ? expense.additionalApprovedByName
                        ? expense.additionalActingForName
                          ? td("timeline.approvedByOnBehalf", { name: expense.additionalApprovedByName, principal: expense.additionalActingForName })
                          : td("timeline.approvedBy", { name: expense.additionalApprovedByName })
                        : expense.additionalRejectedByName
                          ? [
                              td("timeline.rejectedBy", { name: expense.additionalRejectedByName }),
                              expense.additionalRejectionReason
                                ? ` ${td("timeline.rejectionReason", { reason: expense.additionalRejectionReason })}`
                                : ""
                            ].join("")
                          : td("timeline.awaitingAdditional", { name: expense.additionalApproverName ?? "" })
                      : null;

                    const financeDescription = expense.reimbursedAt
                      ? td("timeline.markedPaidBy", {
                          name: expense.reimbursedByName ?? td("timeline.financeFallback"),
                          ref: expense.reimbursementReference
                            ? td("timeline.refSuffix", { ref: expense.reimbursementReference })
                            : ""
                        })
                      : expense.financeRejectedAt
                        ? td("timeline.financeRejectedBy", {
                            name: expense.financeRejectedByName ?? td("timeline.financeFallback"),
                            reason: expense.financeRejectionReason
                              ? td("timeline.reasonSuffix", { reason: expense.financeRejectionReason })
                              : ""
                          })
                        : td("timeline.awaitingFinance");

                    return (
                      <Fragment key={expense.id}>
                        <tr className="data-table-row">
                          <td>
                            <time
                              dateTime={expense.expenseDate}
                              title={formatDateTimeTooltip(expense.expenseDate, locale)}
                            >
                              {formatSingleDateHuman(expense.expenseDate, locale)}
                            </time>
                          </td>
                          {showEmployeeColumn ? (
                            <td>
                              <div className="documents-cell-copy">
                                <p className="documents-cell-title">{expense.employeeName}</p>
                                <p className="documents-cell-description">
                                  {expense.employeeDepartment ?? ""}
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
                              <span>{countryNameFromCode(expense.employeeCountryCode, locale)}</span>
                            </span>
                          </td>
                          <td>
                            <StatusBadge tone={getDisplayStatusTone(expense)}>
                              {getDisplayStatusLabel(expense)}
                            </StatusBadge>
                            {expense.infoRequestState === "requested" && expense.infoRequestUpdatedByName ? (
                              <p className="documents-cell-description">
                                {t('infoRequests.requestedByName', { name: expense.infoRequestUpdatedByName })}
                              </p>
                            ) : expense.infoRequestState === "requested" ? (
                              <p className="documents-cell-description">{t('infoRequests.moreInfoRequested')}</p>
                            ) : null}
                            {expense.infoRequestState === "responded" ? (
                              <p className="documents-cell-description">{t('infoRequests.responseSent')}</p>
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
                            <div className="expenses-row-actions">
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => openReceipt(expense)}
                                disabled={Boolean(isOpeningReceiptById[expense.id])}
                              >
                                {isOpeningReceiptById[expense.id] ? t('tableActions.opening') : t('tableActions.receiptInvoice')}
                              </button>

                              {expense.status === "reimbursed" && expense.reimbursementReceiptPath ? (
                                <button
                                  type="button"
                                  className="table-row-action"
                                  onClick={() => openPaymentProof(expense)}
                                  disabled={Boolean(isOpeningReceiptById[`proof-${expense.id}`])}
                                >
                                  {isOpeningReceiptById[`proof-${expense.id}`] ? t('tableActions.opening') : t('tableActions.paymentProof')}
                                </button>
                              ) : null}

                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => {
                                  setExpandedExpenseId((currentId) => {
                                    const nextId = currentId === expense.id ? null : expense.id;
                                    if (nextId === expense.id) {
                                      void loadExpenseComments(expense.id);
                                    }
                                    return nextId;
                                  });
                                }}
                              >
                                {isExpanded ? t('tableActions.hideDetails') : t('tableActions.details')}
                              </button>

                              {expense.employeeId === currentUserId && expense.status === "pending" ? (
                                <button
                                  type="button"
                                  className="table-row-action"
                                  onClick={() => mutateExpense({ expense, action: "cancel" })}
                                  disabled={isMutatingExpenseId === expense.id}
                                >
                                  {isMutatingExpenseId === expense.id ? tCommon('working') : tCommon('cancel')}
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr className="expenses-detail-row">
                            <td colSpan={showEmployeeColumn ? 10 : 9}>
                              <div className="expenses-detail-card">
                                <h3 className="section-title">{t('timeline.approvalTimeline')}</h3>
                                <ul className="expenses-timeline">
                                  <ExpenseTimelineItem
                                    title={t('timeline.submitted')}
                                    timestamp={expense.createdAt}
                                    description={td("timeline.submittedBy", { name: expense.employeeName })}
                                    tone="success"
                                    locale={locale}
                                    pendingLabel={t('timeline.pending')}
                                  />
                                  <ExpenseTimelineItem
                                    title={t('timeline.managerApproval')}
                                    timestamp={expense.managerApprovedAt}
                                    description={managerDescription}
                                    tone={
                                      expense.managerApprovedAt
                                        ? "success"
                                        : expense.status === "rejected"
                                          ? "error"
                                          : "pending"
                                    }
                                    locale={locale}
                                    pendingLabel={t('timeline.pending')}
                                  />
                                  {expense.requiresAdditionalApproval ? (
                                    <ExpenseTimelineItem
                                      title={t('timeline.additionalApproval')}
                                      timestamp={expense.additionalApprovedAt ?? expense.additionalRejectedAt}
                                      description={additionalDescription ?? ""}
                                      tone={
                                        expense.additionalApprovedAt
                                          ? "success"
                                          : expense.additionalRejectedAt
                                            ? "error"
                                            : "pending"
                                      }
                                      locale={locale}
                                      pendingLabel={t('timeline.pending')}
                                    />
                                  ) : null}
                                  <ExpenseTimelineItem
                                    title={t('timeline.financePayment')}
                                    timestamp={expense.reimbursedAt ?? expense.financeRejectedAt}
                                    description={financeDescription}
                                    tone={
                                      expense.reimbursedAt
                                        ? "success"
                                        : expense.financeRejectedAt
                                          ? "error"
                                          : "info"
                                    }
                                    locale={locale}
                                    pendingLabel={t('timeline.pending')}
                                  />
                                </ul>

                                <div className="expenses-transaction-details">
                                  <h3 className="section-title">{t('infoRequests.title')}</h3>
                                  {isLoadingComments ? (
                                    <p className="settings-card-description">{t('infoRequests.loadingConversation')}</p>
                                  ) : commentThread.length === 0 ? (
                                    <p className="settings-card-description">
                                      {t('infoRequests.noRequests')}
                                    </p>
                                  ) : (
                                    <ul className="compensation-history-list">
                                      {commentThread.map((comment) => (
                                        <li key={comment.id} className="compensation-history-item">
                                          <div className="compensation-history-item-title">
                                            <span>{comment.authorName}</span>
                                            <StatusBadge
                                              tone={comment.commentType === "request_info" ? "warning" : "info"}
                                            >
                                              {comment.commentType === "request_info"
                                                ? t('infoRequests.requestedInfo')
                                                : t('infoRequests.response')}
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
                                                        {attachment.mimeType.startsWith("image/")
                                                          ? t('infoRequests.imageAttachment')
                                                          : t('infoRequests.fileAttachment')}
                                                      </span>
                                                    </div>
                                                    <button
                                                      type="button"
                                                      className="table-row-action"
                                                      onClick={() => {
                                                        void openCommentAttachment(expense.id, attachment.id, attachment.fileName);
                                                      }}
                                                      disabled={Boolean(isOpeningReceiptById[loadingKey])}
                                                    >
                                                      {isOpeningReceiptById[loadingKey]
                                                        ? t('tableActions.opening')
                                                        : t('infoRequests.openAttachment')}
                                                    </button>
                                                  </li>
                                                );
                                              })}
                                            </ul>
                                          ) : null}
                                          <p
                                            className="compensation-history-item-meta"
                                            title={formatDateTimeTooltip(comment.createdAt, locale)}
                                          >
                                            {formatRelativeTime(comment.createdAt, locale)}
                                          </p>
                                        </li>
                                      ))}
                                    </ul>
                                  )}

                                  {canReplyToInfoRequest ? (
                                    <div className="settings-form" style={{ marginTop: "0.75rem" }}>
                                      <label className="form-field">
                                        <span className="form-label">{t('infoRequests.yourResponseLabel')}</span>
                                        <textarea
                                          className={commentError ? "form-input form-input-error" : "form-input"}
                                          rows={3}
                                          value={commentDraft}
                                          onChange={(event) =>
                                            {
                                              setCommentDraftByExpenseId((current) => ({
                                                ...current,
                                                [expense.id]: event.currentTarget.value
                                              }));
                                              setCommentErrorByExpenseId((current) => ({
                                                ...current,
                                                [expense.id]: null
                                              }));
                                            }
                                          }
                                          placeholder={t('infoRequests.replyPlaceholder')}
                                          disabled={isSubmittingComment}
                                        />
                                        {commentError ? (
                                          <p className="form-field-error">{commentError}</p>
                                        ) : null}
                                      </label>
                                      <div className="form-field">
                                        <span className="form-label">{t('infoRequests.attachmentsLabel')}</span>
                                        <FileAttachmentPicker
                                          files={commentFiles}
                                          accept={uploadAcceptValue}
                                          disabled={isSubmittingComment}
                                          buttonLabel={t('infoRequests.chooseAttachments')}
                                          hint={t('infoRequests.attachmentsHint')}
                                          emptyLabel={t('infoRequests.noAttachmentsSelected')}
                                          removeLabel={t('infoRequests.removeAttachment')}
                                          onFilesSelected={(files) => handleCommentFilesSelected(expense.id, files)}
                                          onRemoveFile={(index) => removeCommentFile(expense.id, index)}
                                        />
                                      </div>
                                      <button
                                        type="button"
                                        className="button button-accent"
                                        onClick={() => {
                                          void submitExpenseReply(expense);
                                        }}
                                        disabled={isSubmittingComment}
                                      >
                                        {isSubmittingComment ? t('infoRequests.sending') : t('infoRequests.sendResponse')}
                                      </button>
                                    </div>
                                  ) : null}
                                </div>

                                {(expense.status === "rejected" || expense.status === "finance_rejected") ? (
                                  <div className="expenses-rejection-details">
                                    <h3 className="section-title">{t('rejectionDetails.title')}</h3>
                                    {expense.status === "rejected" && expense.rejectionReason ? (
                                      <p className="expenses-rejection-reason">
                                        <strong>{t('rejectionDetails.reasonLabel')}</strong> {expense.rejectionReason}
                                      </p>
                                    ) : null}
                                    {expense.status === "finance_rejected" && expense.financeRejectionReason ? (
                                      <p className="expenses-rejection-reason">
                                        <strong>{t('rejectionDetails.financeReasonLabel')}</strong> {expense.financeRejectionReason}
                                      </p>
                                    ) : null}
                                  </div>
                                ) : null}

                                {expense.vendorName ? (
                                  <div className="expenses-transaction-details">
                                    <h3 className="section-title">{t('vendorDetails.title')}</h3>
                                    <dl className="expenses-detail-grid">
                                      <dt>{t('vendorDetails.vendor')}</dt>
                                      <dd>{expense.vendorName}</dd>
                                      <dt>{t('paymentRailLabel')}</dt>
                                      <dd>
                                        {expense.vendorPaymentMethod === "mobile_money"
                                          ? t('vendorMobileMoney')
                                          : expense.vendorPaymentMethod === "crew_tag"
                                            ? t('vendorCrewTag')
                                            : expense.vendorPaymentMethod === "international_wire"
                                              ? t('vendorInternationalWire')
                                              : t('vendorBankTransfer')}
                                      </dd>
                                      {(!expense.vendorPaymentMethod || expense.vendorPaymentMethod === "bank_transfer") ? (
                                        <>
                                          {expense.vendorBankAccountName ? (
                                            <>
                                              <dt>{t('vendorDetails.accountName')}</dt>
                                              <dd>{expense.vendorBankAccountName}</dd>
                                            </>
                                          ) : null}
                                          {expense.vendorBankAccountNumber ? (
                                            <>
                                              <dt>{t('vendorDetails.accountNumber')}</dt>
                                              <dd className="numeric">{expense.vendorBankAccountNumber}</dd>
                                            </>
                                          ) : null}
                                        </>
                                      ) : null}
                                      {expense.vendorPaymentMethod === "mobile_money" ? (
                                        <>
                                          {expense.vendorMobileMoneyProvider ? (
                                            <>
                                              <dt>{t('vendorMobileProvider')}</dt>
                                              <dd>{expense.vendorMobileMoneyProvider}</dd>
                                            </>
                                          ) : null}
                                          {expense.vendorMobileMoneyNumber ? (
                                            <>
                                              <dt>{t('vendorMobileNumber')}</dt>
                                              <dd className="numeric">{expense.vendorMobileMoneyNumber}</dd>
                                            </>
                                          ) : null}
                                        </>
                                      ) : null}
                                      {expense.vendorPaymentMethod === "crew_tag" && expense.vendorCrewTag ? (
                                        <>
                                          <dt>{t('vendorCrewTagUsername')}</dt>
                                          <dd>{expense.vendorCrewTag}</dd>
                                        </>
                                      ) : null}
                                      {expense.vendorPaymentMethod === "international_wire" ? (
                                        <>
                                          {expense.vendorWireBankName ? (
                                            <>
                                              <dt>{t('vendorWireBankName')}</dt>
                                              <dd>{expense.vendorWireBankName}</dd>
                                            </>
                                          ) : null}
                                          {expense.vendorWireAccountNumber ? (
                                            <>
                                              <dt>{t('vendorWireAccountNumber')}</dt>
                                              <dd className="numeric">{expense.vendorWireAccountNumber}</dd>
                                            </>
                                          ) : null}
                                          {expense.vendorWireSwiftBic ? (
                                            <>
                                              <dt>{t('vendorWireSwiftBic')}</dt>
                                              <dd className="numeric">{expense.vendorWireSwiftBic}</dd>
                                            </>
                                          ) : null}
                                          {expense.vendorWireIban ? (
                                            <>
                                              <dt>{t('vendorWireIban')}</dt>
                                              <dd className="numeric">{expense.vendorWireIban}</dd>
                                            </>
                                          ) : null}
                                          {expense.vendorWireBankCountry ? (
                                            <>
                                              <dt>{t('vendorWireBankCountry')}</dt>
                                              <dd>{expense.vendorWireBankCountry}</dd>
                                            </>
                                          ) : null}
                                          {expense.vendorWireCurrency ? (
                                            <>
                                              <dt>{t('vendorWireCurrency')}</dt>
                                              <dd className="numeric">{expense.vendorWireCurrency}</dd>
                                            </>
                                          ) : null}
                                        </>
                                      ) : null}
                                    </dl>
                                  </div>
                                ) : null}

                                {expense.status === "reimbursed" ? (
                                  <div className="expenses-transaction-details">
                                    <h3 className="section-title">{t('transactionDetails.title')}</h3>
                                    <dl className="expenses-detail-grid">
                                      {expense.reimbursementReference ? (
                                        <>
                                          <dt>{t('transactionDetails.reference')}</dt>
                                          <dd className="numeric">{expense.reimbursementReference}</dd>
                                        </>
                                      ) : null}
                                      {expense.reimbursedByName ? (
                                        <>
                                          <dt>{t('transactionDetails.markedPaidBy')}</dt>
                                          <dd>{expense.reimbursedByName}</dd>
                                        </>
                                      ) : null}
                                      {expense.reimbursedAt ? (
                                        <>
                                          <dt>{t('transactionDetails.paidOn')}</dt>
                                          <dd>
                                            <time dateTime={expense.reimbursedAt}>
                                              {formatRelativeTime(expense.reimbursedAt, locale)}
                                            </time>
                                          </dd>
                                        </>
                                      ) : null}
                                      {expense.reimbursementNotes ? (
                                        <>
                                          <dt>{t('transactionDetails.notes')}</dt>
                                          <dd>{expense.reimbursementNotes}</dd>
                                        </>
                                      ) : null}
                                    </dl>
                                    {expense.reimbursementReceiptPath ? (
                                      <button
                                        type="button"
                                        className="button button-accent"
                                        style={{ marginTop: "0.75rem" }}
                                        onClick={() => openPaymentProof(expense)}
                                        disabled={Boolean(isOpeningReceiptById[`proof-${expense.id}`])}
                                      >
                                        {isOpeningReceiptById[`proof-${expense.id}`]
                                          ? t('tableActions.opening')
                                          : t('transactionDetails.viewPaymentProof')}
                                      </button>
                                    ) : null}
                                  </div>
                                ) : null}
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
        title={t('submitPanel.title')}
        description={t('submitPanel.description')}
        onClose={closePanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleSubmitExpense}>
          <div className="expenses-type-badge-row">
            <StatusBadge tone={formValues.expenseType === "work_expense" ? "info" : "success"}>
              {formValues.expenseType === "work_expense"
                ? t('submitPanel.workExpense')
                : t('submitPanel.personalReimbursement')}
            </StatusBadge>
          </div>

          <section className="expenses-batch-import-card" aria-label={t('submitPanel.batchImportTitle')}>
            <div className="expenses-batch-import-header">
              <div>
                <h3 className="section-title">{t('submitPanel.batchImportTitle')}</h3>
                <p className="settings-card-description">{t('submitPanel.batchImportDescription')}</p>
              </div>
              <div className="expenses-batch-import-actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => importCsvInputRef.current?.click()}
                  disabled={isSubmitting}
                >
                  {t('submitPanel.uploadCsv')}
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={downloadCsvTemplate}
                  disabled={isSubmitting}
                >
                  {t('submitPanel.downloadCsvTemplate')}
                </button>
                {importedExpenseRows.length > 0 ? (
                  <button
                    type="button"
                    className="button"
                    onClick={clearImportedExpenses}
                    disabled={isSubmitting}
                  >
                    {t('submitPanel.clearCsv')}
                  </button>
                ) : null}
              </div>
            </div>

            <input
              ref={importCsvInputRef}
              type="file"
              className="expenses-hidden-input"
              accept=".csv,text/csv"
              onChange={(event) => { void handleImportCsvInputChange(event); }}
            />

            {importCsvError ? <p className="form-field-error">{importCsvError}</p> : null}

            {importedExpenseRows.length > 0 ? (
              <div className="expenses-batch-import-preview">
                <div className="expenses-info-banner">
                  <p>
                    {t('submitPanel.batchImportLoaded', {
                      count: importedExpenseRows.length,
                      fileName: importedExpenseFileName ?? t('submitPanel.csvFileFallback')
                    })}
                  </p>
                </div>

                <div className="expenses-batch-import-summary">
                  <span className="status-badge status-badge-info">
                    {t('submitPanel.batchImportSummaryRows', { count: importedExpenseRows.length })}
                  </span>
                  {Object.entries(importedExpenseTotalByCurrency).map(([currency, amount]) => (
                    <span key={currency} className="status-badge status-badge-draft">
                      <CurrencyDisplay amount={amount} currency={currency} locale={locale} />
                    </span>
                  ))}
                  {importedExpenseRowErrorCount > 0 ? (
                    <span className="status-badge status-badge-warning">
                      {t('submitPanel.batchImportSummaryErrors', { count: importedExpenseRowErrorCount })}
                    </span>
                  ) : null}
                </div>

                <div className="data-table-container">
                  <table className="data-table" aria-label={t('submitPanel.batchImportPreviewTableAriaLabel')}>
                    <thead>
                      <tr>
                        <th>{t('submitPanel.batchImportColumns.row')}</th>
                        <th>{t('submitPanel.batchImportColumns.type')}</th>
                        <th>{t('submitPanel.batchImportColumns.category')}</th>
                        <th>{t('submitPanel.batchImportColumns.vendor')}</th>
                        <th>{t('submitPanel.batchImportColumns.amount')}</th>
                        <th>{t('submitPanel.batchImportColumns.date')}</th>
                        <th>{t('submitPanel.batchImportColumns.status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importedExpensePreviews.slice(0, 8).map((row) => (
                        <tr key={`expense-csv-row-${row.rowNumber}`}>
                          <td className="numeric">{row.rowNumber}</td>
                          <td>{row.values ? t(`submitPanel.batchImportTypes.${row.values.expenseType}`) : "—"}</td>
                          <td>{row.values ? getExpenseCategoryLabel(row.values.category) : "—"}</td>
                          <td>{row.values?.vendorName || "—"}</td>
                          <td>
                            {row.values ? (
                              <CurrencyDisplay
                                amount={parseMoneyToMinorUnits(row.values.amount) ?? 0}
                                currency={row.values.currency}
                                locale={locale}
                              />
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>{row.values?.expenseDate ?? "—"}</td>
                          <td>
                            {row.error ? (
                              <span className="expenses-batch-import-row-error">{row.error}</span>
                            ) : (
                              <StatusBadge tone="success">{t('submitPanel.batchImportRowReady')}</StatusBadge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {importedExpensePreviews.length > 8 ? (
                  <p className="settings-card-description">
                    {t('submitPanel.batchImportPreviewLimit', {
                      shown: 8,
                      total: importedExpensePreviews.length
                    })}
                  </p>
                ) : null}

                <p className="settings-card-description">
                  {t('submitPanel.batchImportReceiptNote')}
                </p>
              </div>
            ) : null}
          </section>

          {importedExpenseRows.length === 0 ? (
          <>
          <div className="form-field">
            <span className="form-label">{t('submitPanel.expenseTypeLabel')}</span>
            <div className="expenses-type-toggle">
              <button
                type="button"
                className={formValues.expenseType === "work_expense" ? "expenses-type-btn active" : "expenses-type-btn"}
                onClick={() => {
                  setFormValues((prev) => ({ ...prev, expenseType: "work_expense" }));
                  setSubmitError(null);
                }}
                disabled={isSubmitting}
              >
                {t('submitPanel.workExpense')}
              </button>
              <button
                type="button"
                className={formValues.expenseType === "personal_reimbursement" ? "expenses-type-btn active" : "expenses-type-btn"}
                onClick={() => {
                  setFormValues((prev) => ({ ...prev, expenseType: "personal_reimbursement" }));
                  setSubmitError(null);
                }}
                disabled={isSubmitting}
              >
                {t('submitPanel.personalReimbursement')}
              </button>
            </div>
          </div>

          {formValues.expenseType === "personal_reimbursement" ? (
            <>
              <div className="expenses-info-banner">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="expenses-info-icon">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <p>{t('submitPanel.personalReimbursementNote')}</p>
              </div>
              <div className="expenses-payout-display">
                <span className="form-label">{t('payoutAccount')}</span>
                {mePaymentDetails.isLoading ? (
                  <p className="settings-card-description">{tCommon('loading')}</p>
                ) : mePaymentDetails.data?.paymentDetail ? (
                  <dl className="expenses-detail-grid">
                    <dt>{t('vendorPaymentMethod')}</dt>
                    <dd>{mePaymentDetails.data.paymentDetail.paymentMethod === "bank_transfer"
                      ? t('vendorBankTransfer')
                      : mePaymentDetails.data.paymentDetail.paymentMethod === "mobile_money"
                        ? t('vendorMobileMoney')
                        : t('vendorCrewTag')}</dd>
                    <dt>{t('payoutAccount')}</dt>
                    <dd className="numeric">{mePaymentDetails.data.paymentDetail.maskedDestination}</dd>
                  </dl>
                ) : (
                  <div className="expenses-info-banner">
                    <p>{t('noPayoutConfigured')}</p>
                    <Link href="/payment-details" className="button">
                      {t('setupPayment')}
                    </Link>
                  </div>
                )}
              </div>
            </>
          ) : null}

          <div className="form-field">
            <span className="form-label">{t('submitPanel.categoryLabel')}</span>
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

          <section className="expenses-guidance-card" aria-label={t('submitPanel.categoryGuidanceAriaLabel')}>
            <header className="expenses-guidance-header">
              <h3 className="section-title">{t('submitPanel.categoryGuidanceTitle')}</h3>
              <StatusBadge tone="info">{getExpenseCategoryLabel(formValues.category)}</StatusBadge>
            </header>
            <p className="settings-card-description">{selectedCategoryGuidance.summary}</p>
            <p className="settings-card-description">{selectedCategoryGuidance.documentation}</p>
            <p className="settings-card-description">{selectedCategoryGuidance.policyNote}</p>
            <div className="expenses-guidance-actions">
              <Link href="/documents" className="button">
                {t('toolbar.viewExpensePolicy')}
              </Link>
            </div>
          </section>

          {formValues.category === "other" ? (
            <label className="form-field">
              <span className="form-label">{t('submitPanel.customCategoryLabel')}</span>
              <input
                className={formErrors.customCategory ? "form-input form-input-error" : "form-input"}
                type="text"
                value={formValues.customCategory}
                onChange={(e) => setFormValues((prev) => ({ ...prev, customCategory: e.target.value }))}
                onBlur={handleFieldBlur("customCategory")}
                placeholder={t('submitPanel.customCategoryPlaceholder')}
                disabled={isSubmitting}
                maxLength={100}
              />
              {formErrors.customCategory ? (
                <p className="form-field-error">{formErrors.customCategory}</p>
              ) : null}
            </label>
          ) : null}

          <label className="form-field">
            <span className="form-label">{t('submitPanel.descriptionLabel')}</span>
            <textarea
              className={formErrors.description ? "form-input form-input-error" : "form-input"}
              value={formValues.description}
              onChange={handleFormFieldChange("description")}
              onBlur={handleFieldBlur("description")}
              rows={4}
              placeholder={t('submitPanel.descriptionPlaceholder')}
              disabled={isSubmitting}
            />
            {formErrors.description ? (
              <p className="form-field-error">{formErrors.description}</p>
            ) : null}
          </label>

          <div className="expenses-form-grid expenses-form-grid-3col">
            <div className="form-field">
              <span className="form-label">{t('submitPanel.currencyLabel')}</span>
              <Select
                value={formValues.currency}
                onValueChange={(value) => {
                  handleFormFieldChange("currency")(value);
                  handleFieldBlur("currency")();
                }}
                disabled={isSubmitting}
              >
                <SelectTrigger className={formErrors.currency ? "form-input-error" : ""}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">{"\ud83c\uddfa\ud83c\uddf8"} USD</SelectItem>
                  <SelectItem value="NGN">{"\ud83c\uddf3\ud83c\uddec"} NGN</SelectItem>
                  <SelectItem value="GHS">{"\ud83c\uddec\ud83c\udded"} GHS</SelectItem>
                  <SelectItem value="KES">{"\ud83c\uddf0\ud83c\uddea"} KES</SelectItem>
                  <SelectItem value="ZAR">{"\ud83c\uddff\ud83c\udde6"} ZAR</SelectItem>
                  <SelectItem value="XAF">{"\ud83c\udde8\ud83c\uddf2"} XAF</SelectItem>
                  <SelectItem value="XOF">{"\ud83c\udde7\ud83c\uddef"} XOF</SelectItem>
                  <SelectItem value="CAD">{"\ud83c\udde8\ud83c\udde6"} CAD</SelectItem>
                </SelectContent>
              </Select>
              {formErrors.currency ? (
                <p className="form-field-error">{formErrors.currency}</p>
              ) : null}
            </div>

            <label className="form-field">
              <span className="form-label">{t('submitPanel.amountLabel')}</span>
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
              <span className="form-label">{t('submitPanel.dateLabel')}</span>
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

          {formValues.expenseType === "work_expense" ? (
            <div className="expenses-vendor-fields">
              <h4 className="section-title" style={{ marginBottom: "0.5rem" }}>{t('vendorDetails.title')}</h4>

              {vendorBeneficiaries.vendors.length > 0 ? (
                <div className="form-field">
                  <span className="form-label">{t('submitPanel.selectSavedVendorLabel')}</span>
                  <Select
                    value={selectedVendorId || "__none__"}
                    onValueChange={(value) => {
                      const nextVendorId = value === "__none__" ? "" : value;
                      setSelectedVendorId(nextVendorId);
                      const vendor = vendorBeneficiaries.vendors.find((v) => v.id === nextVendorId);
                      if (vendor) {
                        const nextValues = {
                          ...formValues,
                          vendorName: vendor.vendorName,
                          vendorPaymentMethod: (vendor.paymentMethod ?? "bank_transfer") as VendorPaymentMethodOption,
                          vendorBankAccountName: vendor.bankAccountName,
                          vendorBankAccountNumber: vendor.bankAccountNumber,
                          vendorMobileMoneyProvider: vendor.mobileMoneyProvider ?? "",
                          vendorMobileMoneyNumber: vendor.mobileMoneyNumber ?? "",
                          vendorCrewTag: vendor.crewTag ?? "",
                          vendorWireBankName: vendor.wireBankName ?? "",
                          vendorWireAccountNumber: vendor.wireAccountNumber ?? "",
                          vendorWireSwiftBic: vendor.wireSwiftBic ?? "",
                          vendorWireIban: vendor.wireIban ?? "",
                          vendorWireBankCountry: vendor.wireBankCountry ?? "",
                          vendorWireCurrency: vendor.wireCurrency ?? "",
                          saveVendor: false
                        };
                        setFormValues(nextValues);
                        setFormErrors(getFormErrors(nextValues, formTouched, receiptFiles, td));
                        setExpenseFormDirty(true);
                      } else {
                        setExpenseFormDirty(true);
                      }
                    }}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('submitPanel.chooseSavedVendor')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t('submitPanel.chooseSavedVendor')}</SelectItem>
                      {vendorBeneficiaries.vendors.map((vendor) => {
                        const label = vendor.paymentMethod === "mobile_money"
                          ? `${vendor.vendorName} - ${vendor.mobileMoneyNumber ?? ""}`
                          : vendor.paymentMethod === "crew_tag"
                            ? `${vendor.vendorName} - ${vendor.crewTag ?? ""}`
                            : vendor.paymentMethod === "international_wire"
                              ? `${vendor.vendorName} - ${vendor.wireAccountNumber ?? ""}`
                              : `${vendor.vendorName} - ${vendor.bankAccountNumber}`;
                        return (
                          <SelectItem key={vendor.id} value={vendor.id}>
                            {label}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <label className="form-field">
                <span className="form-label">{t('submitPanel.vendorNameLabel')} <span className="form-required">*</span></span>
                <input
                  className={formErrors.vendorName ? "form-input form-input-error" : "form-input"}
                  type="text"
                  value={formValues.vendorName}
                  onChange={(e) => handleVendorInputChange("vendorName")(e.target.value)}
                  onBlur={handleFieldBlur("vendorName")}
                  placeholder={t('submitPanel.vendorNamePlaceholder')}
                  disabled={isSubmitting}
                  maxLength={200}
                />
                {formErrors.vendorName ? (
                  <p className="form-field-error">{formErrors.vendorName}</p>
                ) : null}
              </label>

              <div className="form-field">
                <span className="form-label">{t('vendorPaymentMethod')}</span>
                <Select
                  value={formValues.vendorPaymentMethod}
                  onValueChange={(value) => handleFormChange("vendorPaymentMethod", value)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank_transfer">{t('vendorBankTransfer')}</SelectItem>
                    <SelectItem value="mobile_money">{t('vendorMobileMoney')}</SelectItem>
                    <SelectItem value="crew_tag">{t('vendorCrewTag')}</SelectItem>
                    <SelectItem value="international_wire">{t('vendorInternationalWire')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formValues.vendorPaymentMethod === "bank_transfer" ? (
                <>
                  <label className="form-field">
                    <span className="form-label">{t('submitPanel.bankAccountNameLabel')} <span className="form-required">*</span></span>
                    <input
                      className={formErrors.vendorBankAccountName ? "form-input form-input-error" : "form-input"}
                      type="text"
                      value={formValues.vendorBankAccountName}
                      onChange={(e) => handleVendorInputChange("vendorBankAccountName")(e.target.value)}
                      onBlur={handleFieldBlur("vendorBankAccountName")}
                      placeholder={t('submitPanel.bankAccountNamePlaceholder')}
                      disabled={isSubmitting}
                      maxLength={200}
                    />
                    {formErrors.vendorBankAccountName ? (
                      <p className="form-field-error">{formErrors.vendorBankAccountName}</p>
                    ) : null}
                  </label>
                  <label className="form-field">
                    <span className="form-label">{t('submitPanel.bankAccountNumberLabel')} <span className="form-required">*</span></span>
                    <input
                      className={formErrors.vendorBankAccountNumber ? "form-input form-input-error" : "form-input"}
                      type="text"
                      value={formValues.vendorBankAccountNumber}
                      onChange={(e) => handleVendorInputChange("vendorBankAccountNumber")(e.target.value)}
                      onBlur={handleFieldBlur("vendorBankAccountNumber")}
                      placeholder={t('submitPanel.bankAccountNumberPlaceholder')}
                      disabled={isSubmitting}
                      maxLength={50}
                    />
                    {formErrors.vendorBankAccountNumber ? (
                      <p className="form-field-error">{formErrors.vendorBankAccountNumber}</p>
                    ) : null}
                  </label>
                </>
              ) : null}

              {formValues.vendorPaymentMethod === "mobile_money" ? (
                <>
                  <label className="form-field">
                    <span className="form-label">{t('vendorMobileProvider')} <span className="form-required">*</span></span>
                    <input
                      className="form-input"
                      type="text"
                      value={formValues.vendorMobileMoneyProvider}
                      onChange={(e) => handleVendorInputChange("vendorMobileMoneyProvider")(e.target.value)}
                      onBlur={handleFieldBlur("vendorMobileMoneyProvider")}
                      disabled={isSubmitting}
                      maxLength={100}
                    />
                  </label>
                  <label className="form-field">
                    <span className="form-label">{t('vendorMobileNumber')} <span className="form-required">*</span></span>
                    <input
                      className="form-input"
                      type="text"
                      value={formValues.vendorMobileMoneyNumber}
                      onChange={(e) => handleVendorInputChange("vendorMobileMoneyNumber")(e.target.value)}
                      onBlur={handleFieldBlur("vendorMobileMoneyNumber")}
                      disabled={isSubmitting}
                      maxLength={30}
                    />
                  </label>
                </>
              ) : null}

              {formValues.vendorPaymentMethod === "crew_tag" ? (
                <label className="form-field">
                  <span className="form-label">{t('vendorCrewTagUsername')} <span className="form-required">*</span></span>
                  <input
                    className="form-input"
                    type="text"
                    value={formValues.vendorCrewTag}
                    onChange={(e) => handleVendorInputChange("vendorCrewTag")(e.target.value)}
                    onBlur={handleFieldBlur("vendorCrewTag")}
                    disabled={isSubmitting}
                    maxLength={100}
                  />
                </label>
              ) : null}

              {formValues.vendorPaymentMethod === "international_wire" ? (
                <>
                  <label className="form-field">
                    <span className="form-label">{t('vendorWireBankName')} <span className="form-required">*</span></span>
                    <input
                      className="form-input"
                      type="text"
                      value={formValues.vendorWireBankName}
                      onChange={(e) => handleVendorInputChange("vendorWireBankName")(e.target.value)}
                      onBlur={handleFieldBlur("vendorWireBankName")}
                      disabled={isSubmitting}
                      maxLength={200}
                    />
                  </label>
                  <label className="form-field">
                    <span className="form-label">{t('vendorWireAccountNumber')} <span className="form-required">*</span></span>
                    <input
                      className="form-input"
                      type="text"
                      value={formValues.vendorWireAccountNumber}
                      onChange={(e) => handleVendorInputChange("vendorWireAccountNumber")(e.target.value)}
                      onBlur={handleFieldBlur("vendorWireAccountNumber")}
                      disabled={isSubmitting}
                      maxLength={50}
                    />
                  </label>
                  <div className="expenses-form-grid">
                    <label className="form-field">
                      <span className="form-label">{t('vendorWireSwiftBic')}</span>
                      <input
                        className="form-input"
                        type="text"
                        value={formValues.vendorWireSwiftBic}
                        onChange={(e) => handleVendorInputChange("vendorWireSwiftBic")(e.target.value)}
                        onBlur={handleFieldBlur("vendorWireSwiftBic")}
                        disabled={isSubmitting}
                        maxLength={11}
                      />
                    </label>
                    <label className="form-field">
                      <span className="form-label">{t('vendorWireIban')}</span>
                      <input
                        className="form-input"
                        type="text"
                        value={formValues.vendorWireIban}
                        onChange={(e) => handleVendorInputChange("vendorWireIban")(e.target.value)}
                        onBlur={handleFieldBlur("vendorWireIban")}
                        disabled={isSubmitting}
                        maxLength={34}
                      />
                    </label>
                  </div>
                  <div className="expenses-form-grid">
                    <label className="form-field">
                      <span className="form-label">{t('vendorWireBankCountry')}</span>
                      <input
                        className="form-input"
                        type="text"
                        value={formValues.vendorWireBankCountry}
                        onChange={(e) => handleVendorInputChange("vendorWireBankCountry")(e.target.value)}
                        onBlur={handleFieldBlur("vendorWireBankCountry")}
                        disabled={isSubmitting}
                        maxLength={100}
                      />
                    </label>
                    <label className="form-field">
                      <span className="form-label">{t('vendorWireCurrency')}</span>
                      <input
                        className="form-input"
                        type="text"
                        value={formValues.vendorWireCurrency}
                        onChange={(e) => handleVendorInputChange("vendorWireCurrency")(e.target.value.toUpperCase())}
                        onBlur={handleFieldBlur("vendorWireCurrency")}
                        disabled={isSubmitting}
                        maxLength={3}
                      />
                    </label>
                  </div>
                </>
              ) : null}

              {!selectedVendorId ? (
                <label className="expenses-save-vendor-check">
                  <input
                    type="checkbox"
                    checked={formValues.saveVendor}
                    onChange={(e) => setFormValues((prev) => ({ ...prev, saveVendor: e.target.checked }))}
                    disabled={isSubmitting}
                  />
                  <span>{t('submitPanel.saveVendorLabel')}</span>
                </label>
              ) : null}
            </div>
          ) : null}
          </>
          ) : null}

          <div className="form-field">
            <span className="form-label">{t('submitPanel.receiptLabel')} <span className="form-required">*</span></span>
            <div
              className={isDraggingReceipt ? "document-dropzone document-dropzone-active" : "document-dropzone"}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => receiptInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); receiptInputRef.current?.click(); } }}
              style={{ cursor: "pointer" }}
            >
              <p className="document-dropzone-title">
                {receiptFiles.length > 0
                  ? t('submitPanel.documentsSelected', { count: receiptFiles.length })
                  : t('submitPanel.dropzoneTitle')}
              </p>
              <p className="document-dropzone-hint">
                {t('submitPanel.dropzoneHint')}
              </p>
              {receiptFiles.length > 0 ? (
                <ul
                  className="expenses-receipt-file-list"
                  onClick={(event) => event.stopPropagation()}
                >
                  {receiptFiles.map((file, index) => (
                    <li key={`${file.name}-${file.size}-${index}`} className="expenses-receipt-file">
                      <span className="expenses-receipt-file-name">{file.name}</span>
                      <span className="document-dropzone-hint numeric">{Math.round(file.size / 1024)} KB</span>
                      <button
                        type="button"
                        className="expenses-receipt-file-remove"
                        aria-label={t('submitPanel.removeDocument')}
                        onClick={(event) => { event.stopPropagation(); removeReceiptAt(index); }}
                        disabled={isSubmitting}
                      >
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="expenses-receipt-actions">
              <button
                type="button"
                className="button"
                onClick={() => receiptInputRef.current?.click()}
                disabled={isSubmitting}
              >
                {t('submitPanel.chooseFile')}
              </button>
              <button
                type="button"
                className="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={isSubmitting}
              >
                {t('submitPanel.useCamera')}
              </button>
            </div>
            <input
              ref={receiptInputRef}
              type="file"
              multiple
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
              <div className="expenses-upload-spinner" />
              <span>{t('submitPanel.uploading')}</span>
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
              {tCommon('cancel')}
            </button>
            <button type="submit" className="button button-accent" disabled={isSubmitting}>
              {isSubmitting
                ? t('submitPanel.submitting')
                : importedExpenseRows.length > 0
                  ? t('actions.submitImportedExpenses')
                  : t('actions.submitExpense')}
            </button>
          </div>
        </form>
      </SlidePanel>

      {receiptLightbox ? (
        <ReceiptLightbox
          key={receiptLightbox.items[0]?.url ?? receiptLightbox.label}
          data={receiptLightbox}
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
