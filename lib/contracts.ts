// ── Contract Document Constants & Helpers ────────────────────────────────────

export const CONTRACT_DOCUMENTS_BUCKET = "contract-documents";
export const MAX_CONTRACT_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_CONTRACT_EXTENSIONS = ["pdf"] as const;
export const ALLOWED_CONTRACT_MIME_TYPE = "application/pdf";
export const CONTRACT_SIGNED_URL_TTL_SECONDS = 60;

function normalizeFileExtension(fileName: string): string {
  const parts = fileName.trim().toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] ?? "" : "";
}

export function isAllowedContractUpload(fileName: string, mimeType: string): boolean {
  const extension = normalizeFileExtension(fileName);
  return extension === "pdf" && mimeType === ALLOWED_CONTRACT_MIME_TYPE;
}

export function sanitizeFileName(fileName: string): string {
  return fileName
    .normalize("NFKD")
    .replace(/[^\w.-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 180);
}
