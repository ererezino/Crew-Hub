import "server-only";

import {
  ALLOWED_RECEIPT_EXTENSIONS,
  isAllowedReceiptUpload,
  MAX_EXPENSE_ATTACHMENTS,
  MAX_RECEIPT_FILE_BYTES
} from "../expenses";
import { validateUploadMagicBytes } from "../security/upload-signatures";

export type ReceiptFileCollection = { files: File[] } | { error: string };

/**
 * Collect and validate receipt/document files from a multipart submission.
 * Accepts one or more files under the "receipts" field (and the legacy
 * "receipt" field for backward compatibility), de-duplicating across both.
 *
 * @param options.maxFiles cap on the number of files (defaults to the per-expense limit)
 */
export async function collectAndValidateReceiptFiles(
  formData: FormData,
  options: { maxFiles?: number } = {}
): Promise<ReceiptFileCollection> {
  const maxFiles = options.maxFiles ?? MAX_EXPENSE_ATTACHMENTS;
  const seen = new Set<string>();
  const files: File[] = [];

  for (const entry of [...formData.getAll("receipts"), ...formData.getAll("receipt")]) {
    if (!(entry instanceof File) || entry.size <= 0) {
      continue;
    }

    const dedupeKey = `${entry.name}:${entry.size}:${entry.lastModified}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    files.push(entry);
  }

  if (files.length === 0) {
    return { error: "At least one receipt or invoice file is required." };
  }

  if (files.length > maxFiles) {
    return { error: `You can attach up to ${MAX_EXPENSE_ATTACHMENTS} documents per expense.` };
  }

  for (const file of files) {
    if (file.size > MAX_RECEIPT_FILE_BYTES) {
      return { error: "Each receipt/invoice must be 10MB or smaller." };
    }

    if (!isAllowedReceiptUpload(file.name, file.type)) {
      return { error: "Unsupported file type. Allowed formats for receipt/invoice: pdf, png, jpg." };
    }

    const magicBytesResult = await validateUploadMagicBytes({
      file,
      fileName: file.name,
      allowedExtensions: ALLOWED_RECEIPT_EXTENSIONS
    });

    if (!magicBytesResult.valid) {
      return {
        error:
          "A receipt/invoice failed signature validation. Upload files whose binary format matches the selected extension."
      };
    }
  }

  return { files };
}
