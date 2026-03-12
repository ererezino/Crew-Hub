import {
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  type ExpenseCategory,
  type ExpenseRecord,
  type ExpenseStatus,
  type ExpensesSummary
} from "../types/expenses";

export const RECEIPTS_BUCKET_NAME = "receipts";
export const MAX_RECEIPT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_EXPENSE_COMMENT_ATTACHMENTS = 8;

export const ALLOWED_RECEIPT_EXTENSIONS = ["pdf", "png", "jpg", "jpeg"] as const;
export const ALLOWED_RECEIPT_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg"
] as const;

const categoryLabelByValue: Record<ExpenseCategory, string> = {
  travel: "Travel",
  lodging: "Lodging",
  meals: "Meals",
  transport: "Transport",
  internet: "Internet",
  office_supplies: "Office Supplies",
  software: "Software",
  wellness: "Wellness",
  marketing: "Marketing",
  other: "Other"
};

type ExpenseCategoryGuidance = {
  summary: string;
  documentation: string;
  policyNote: string;
};

export const EXPENSE_CATEGORY_GUIDANCE: Record<ExpenseCategory, ExpenseCategoryGuidance> = {
  travel: {
    summary: "Work travel costs like flights, intercity buses, and approved ride bookings are reimbursable.",
    documentation: "Upload tickets, booking confirmations, and travel receipts.",
    policyNote: "Pre-approval is required before booking travel."
  },
  lodging: {
    summary: "Hotel and short-stay accommodation for approved work travel can be reimbursed.",
    documentation: "Upload the hotel invoice with dates and guest name.",
    policyNote: "Pre-approval is required and nightly limits apply per policy."
  },
  meals: {
    summary: "Meals during approved work travel or approved client meetings may be reimbursed.",
    documentation: "Upload itemized receipts showing date, location, and amount.",
    policyNote: "Per-diem and category caps apply."
  },
  transport: {
    summary: "Local transport costs for approved work activity are reimbursable.",
    documentation: "Upload ride receipts or transit tickets with trip date.",
    policyNote: "Use the most cost-effective option available."
  },
  internet: {
    summary: "Approved internet costs for work continuity can be reimbursed.",
    documentation: "Upload provider invoices or recharge receipts.",
    policyNote: "Only work-related usage is eligible."
  },
  office_supplies: {
    summary: "Small office purchases required for work can be reimbursed.",
    documentation: "Upload store receipts listing purchased items.",
    policyNote: "Non-work and personal items are not eligible."
  },
  software: {
    summary: "Approved software subscriptions and tools used for work can be reimbursed.",
    documentation: "Upload invoices or subscription receipts with plan details.",
    policyNote: "Pre-approval is required before purchase."
  },
  wellness: {
    summary: "Wellness reimbursements are limited to approved wellness benefits and programs.",
    documentation: "Upload receipts and provider confirmation where applicable.",
    policyNote: "Claim limits and eligibility rules apply."
  },
  marketing: {
    summary: "Approved campaign, event, and media spend can be reimbursed.",
    documentation: "Upload campaign invoices, ad receipts, or event bills.",
    policyNote: "Budget owner approval is required before spend."
  },
  other: {
    summary: "Use this category only when no listed category applies.",
    documentation: "Upload full proof of payment and add a clear business justification.",
    policyNote: "Finance may request additional clarification before payment confirmation."
  }
};

export function isExpenseCategory(value: string): value is ExpenseCategory {
  return EXPENSE_CATEGORIES.includes(value as ExpenseCategory);
}

export function isExpenseStatus(value: string): value is ExpenseStatus {
  return EXPENSE_STATUSES.includes(value as ExpenseStatus);
}

export function getExpenseCategoryLabel(category: ExpenseCategory): string {
  return categoryLabelByValue[category];
}

export function getExpenseStatusLabel(status: ExpenseStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "manager_approved":
      return "Awaiting Finance";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "finance_rejected":
      return "Finance Rejected";
    case "reimbursed":
      return "Reimbursed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Draft";
  }
}

export function toneForExpenseStatus(
  status: ExpenseStatus
): "pending" | "success" | "error" | "warning" | "info" | "draft" {
  switch (status) {
    case "pending":
      return "pending";
    case "manager_approved":
      return "warning";
    case "approved":
      return "info";
    case "rejected":
      return "error";
    case "finance_rejected":
      return "error";
    case "reimbursed":
      return "success";
    case "cancelled":
      return "warning";
    default:
      return "draft";
  }
}

function normalizeFileExtension(fileName: string): string {
  const segments = fileName.trim().toLowerCase().split(".");
  return segments.length > 1 ? segments[segments.length - 1] ?? "" : "";
}

export function isAllowedReceiptUpload(fileName: string, mimeType: string): boolean {
  const extension = normalizeFileExtension(fileName);

  return (
    ALLOWED_RECEIPT_EXTENSIONS.includes(
      extension as (typeof ALLOWED_RECEIPT_EXTENSIONS)[number]
    ) &&
    ALLOWED_RECEIPT_MIME_TYPES.includes(
      mimeType as (typeof ALLOWED_RECEIPT_MIME_TYPES)[number]
    )
  );
}

export function sanitizeFileName(fileName: string): string {
  return fileName
    .normalize("NFKD")
    .replace(/[^\w.-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 180);
}

export function normalizeCurrency(value: string | null | undefined): string {
  if (!value) {
    return "USD";
  }

  const normalized = value.trim().toUpperCase();
  return normalized.length === 3 ? normalized : "USD";
}

export function parseIntegerAmount(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed)) {
    return 0;
  }

  return Math.trunc(parsed);
}

export function summarizeExpenses(expenses: readonly ExpenseRecord[]): ExpensesSummary {
  return expenses.reduce<ExpensesSummary>(
    (summary, expense) => {
      summary.totalCount += 1;
      summary.totalAmount += expense.amount;

      if (expense.status === "pending") {
        summary.pendingCount += 1;
        summary.pendingAmount += expense.amount;
      }

      if (expense.status === "manager_approved") {
        summary.managerApprovedCount += 1;
        summary.pendingAmount += expense.amount;
      }

      if (expense.status === "approved") {
        summary.approvedCount += 1;
      }

      if (expense.status === "reimbursed") {
        summary.reimbursedCount += 1;
        summary.reimbursedAmount += expense.amount;
      }

      if (expense.status === "rejected") {
        summary.rejectedCount += 1;
      }

      if (expense.status === "finance_rejected") {
        summary.financeRejectedCount += 1;
      }

      if (expense.status === "cancelled") {
        summary.cancelledCount += 1;
      }

      return summary;
    },
    {
      totalCount: 0,
      totalAmount: 0,
      pendingCount: 0,
      pendingAmount: 0,
      approvedCount: 0,
      managerApprovedCount: 0,
      reimbursedCount: 0,
      reimbursedAmount: 0,
      rejectedCount: 0,
      financeRejectedCount: 0,
      cancelledCount: 0
    }
  );
}

export function receiptFileNameFromPath(filePath: string): string {
  if (!filePath) {
    return "Receipt";
  }

  const segments = filePath.split("/");
  return segments[segments.length - 1] ?? "Receipt";
}

export function isIsoMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function monthDateRange(month: string): { startDate: string; endDate: string } | null {
  if (!isIsoMonth(month)) {
    return null;
  }

  const [yearText, monthText] = month.split("-");
  const year = Number.parseInt(yearText, 10);
  const monthIndex = Number.parseInt(monthText, 10) - 1;

  if (!Number.isInteger(year) || !Number.isInteger(monthIndex)) {
    return null;
  }

  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));

  const startDate = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}-${String(start.getUTCDate()).padStart(2, "0")}`;
  const endDate = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}-${String(end.getUTCDate()).padStart(2, "0")}`;

  return {
    startDate,
    endDate
  };
}

export function currentMonthKey(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function formatMonthLabel(month: string): string {
  const range = monthDateRange(month);

  if (!range) {
    return month;
  }

  const date = new Date(`${range.startDate}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return month;
  }

  return date.toLocaleString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
}
