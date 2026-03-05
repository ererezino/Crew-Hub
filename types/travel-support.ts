import type { ApiResponse } from "./auth";

export const TRAVEL_LETTER_STATUSES = ["pending", "approved", "rejected"] as const;

export type TravelLetterStatus = (typeof TRAVEL_LETTER_STATUSES)[number];

export type TravelSupportRequest = {
  id: string;
  orgId: string;
  employeeId: string;
  employeeName: string | null;
  destinationCountry: string;
  embassyName: string;
  embassyAddress: string | null;
  travelStartDate: string;
  travelEndDate: string;
  purpose: string;
  additionalNotes: string | null;
  status: TravelLetterStatus;
  approvedBy: string | null;
  approverName: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  documentPath: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TravelSupportCreatePayload = {
  destinationCountry: string;
  embassyName: string;
  embassyAddress?: string;
  travelStartDate: string;
  travelEndDate: string;
  purpose: string;
  additionalNotes?: string;
};

export type TravelSupportListResponseData = {
  requests: TravelSupportRequest[];
};

export type TravelSupportListResponse = ApiResponse<TravelSupportListResponseData>;

export type TravelSupportCreateResponseData = {
  request: TravelSupportRequest;
};

export type TravelSupportCreateResponse = ApiResponse<TravelSupportCreateResponseData>;

export type TravelSupportUpdateResponseData = {
  request: TravelSupportRequest;
};

export type TravelSupportUpdateResponse = ApiResponse<TravelSupportUpdateResponseData>;

export type TravelSupportDownloadResponseData = {
  url: string;
  expiresIn: number;
};

export type TravelSupportDownloadResponse = ApiResponse<TravelSupportDownloadResponseData>;

/* ── Letterhead Entities ── */

export type LetterheadEntity = {
  id: string;
  orgId: string;
  country: string;
  address: string;
  createdAt: string;
  updatedAt: string;
};

export type LetterheadEntityListResponseData = {
  entities: LetterheadEntity[];
};

export type LetterheadEntityListResponse = ApiResponse<LetterheadEntityListResponseData>;

export type LetterheadEntityUpsertResponseData = {
  entity: LetterheadEntity;
};

export type LetterheadEntityUpsertResponse = ApiResponse<LetterheadEntityUpsertResponseData>;

export type TravelSupportApprovePayload = {
  action: "approve";
  entityCountry: string;
  entityAddress: string;
};
