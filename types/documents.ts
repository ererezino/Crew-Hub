import type { ApiResponse } from "./auth";

export const DOCUMENT_CATEGORIES = [
  "policy",
  "contract",
  "id_document",
  "tax_form",
  "compliance",
  "payroll_statement",
  "other"
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const SELF_SERVICE_DOCUMENT_CATEGORIES = [
  "id_document",
  "tax_form"
] as const;

export type SelfServiceDocumentCategory = (typeof SELF_SERVICE_DOCUMENT_CATEGORIES)[number];

export type DocumentRecord = {
  id: string;
  ownerUserId: string | null;
  ownerName: string;
  category: DocumentCategory;
  title: string;
  description: string | null;
  filePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  expiryDate: string | null;
  countryCode: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  latestVersion: number;
};

export type DocumentsResponseData = {
  documents: DocumentRecord[];
};

export type DocumentsResponse = ApiResponse<DocumentsResponseData>;

export type DocumentUploadResponseData = {
  document: DocumentRecord;
};

export type DocumentUploadResponse = ApiResponse<DocumentUploadResponseData>;

export type DocumentSignedUrlResponseData = {
  url: string;
  expiresInSeconds: number;
};

export type DocumentSignedUrlResponse = ApiResponse<DocumentSignedUrlResponseData>;
