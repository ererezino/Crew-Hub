import type { ApiResponse } from "./auth";

export const SIGNATURE_REQUEST_STATUSES = [
  "pending",
  "partially_signed",
  "completed",
  "voided",
  "expired"
] as const;

export type SignatureRequestStatus = (typeof SIGNATURE_REQUEST_STATUSES)[number];

export const SIGNATURE_SIGNER_STATUSES = [
  "pending",
  "viewed",
  "signed",
  "declined"
] as const;

export type SignatureSignerStatus = (typeof SIGNATURE_SIGNER_STATUSES)[number];

export type SignatureSignerRecord = {
  id: string;
  requestId: string;
  signerUserId: string;
  signerName: string;
  signerOrder: number;
  status: SignatureSignerStatus;
  viewedAt: string | null;
  signedAt: string | null;
};

export type SignatureRequestRecord = {
  id: string;
  orgId: string;
  documentId: string;
  documentTitle: string;
  title: string;
  message: string | null;
  status: SignatureRequestStatus;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  signers: SignatureSignerRecord[];
  pendingSignerCount: number;
  isCurrentUserSigner: boolean;
  currentUserSignerStatus: SignatureSignerStatus | null;
};

export type SignaturesResponseData = {
  requests: SignatureRequestRecord[];
};

export type CreateSignatureRequestPayload = {
  documentId: string;
  title: string;
  message?: string;
  signerUserIds: string[];
};

export type CreateSignatureRequestResponseData = {
  requestId: string;
};

export type SignSignatureResponseData = {
  requestId: string;
  status: SignatureRequestStatus;
  signerStatus: SignatureSignerStatus;
  signedAt: string;
};

export type SignaturesResponse = ApiResponse<SignaturesResponseData>;
export type CreateSignatureRequestResponse = ApiResponse<CreateSignatureRequestResponseData>;
export type SignSignatureResponse = ApiResponse<SignSignatureResponseData>;
