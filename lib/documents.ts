import {
  DOCUMENT_CATEGORIES,
  SELF_SERVICE_DOCUMENT_CATEGORIES,
  type DocumentCategory
} from "../types/documents";

export const DOCUMENT_BUCKET_NAME = "documents";
export const MAX_DOCUMENT_FILE_BYTES = 25 * 1024 * 1024;

export const ALLOWED_DOCUMENT_EXTENSIONS = [
  "pdf",
  "docx",
  "doc",
  "xlsx",
  "xls",
  "png",
  "jpg",
  "jpeg"
] as const;

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "image/png",
  "image/jpeg"
] as const;

const categoryLabelByValue: Record<DocumentCategory, string> = {
  policy: "Policy",
  contract: "Contract",
  id_document: "ID Document",
  tax_form: "Tax Form",
  compliance: "Compliance",
  payroll_statement: "Payroll Statement",
  other: "Other"
};

export function isDocumentCategory(value: string): value is DocumentCategory {
  return DOCUMENT_CATEGORIES.includes(value as DocumentCategory);
}

export function isSelfServiceDocumentCategory(value: string): boolean {
  return SELF_SERVICE_DOCUMENT_CATEGORIES.includes(
    value as (typeof SELF_SERVICE_DOCUMENT_CATEGORIES)[number]
  );
}

export function normalizeDocumentCategory(value: string): DocumentCategory | null {
  return isDocumentCategory(value) ? value : null;
}

export function getDocumentCategoryLabel(category: DocumentCategory): string {
  return categoryLabelByValue[category];
}

export function normalizeCountryCode(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return normalized.length === 2 ? normalized : null;
}

function normalizeFileExtension(fileName: string): string {
  const parts = fileName.trim().toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] ?? "" : "";
}

export function isAllowedDocumentUpload(fileName: string, mimeType: string): boolean {
  const extension = normalizeFileExtension(fileName);

  return (
    ALLOWED_DOCUMENT_EXTENSIONS.includes(
      extension as (typeof ALLOWED_DOCUMENT_EXTENSIONS)[number]
    ) &&
    ALLOWED_DOCUMENT_MIME_TYPES.includes(
      mimeType as (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number]
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

export function formatFileSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return "--";
  }

  const units = ["B", "KB", "MB", "GB"] as const;
  let value = sizeBytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const displayValue = unitIndex === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${displayValue} ${units[unitIndex]}`;
}

export function daysUntilExpiry(expiryDate: string | null): number | null {
  if (!expiryDate) {
    return null;
  }

  const expiry = new Date(`${expiryDate}T00:00:00.000Z`);

  if (Number.isNaN(expiry.getTime())) {
    return null;
  }

  const now = new Date();
  const nowAtMidnightUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );

  const differenceMs = expiry.getTime() - nowAtMidnightUtc;
  return Math.floor(differenceMs / (1000 * 60 * 60 * 24));
}
