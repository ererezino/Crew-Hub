import type { ApiResponse } from "./auth";

export type VendorBeneficiary = {
  id: string;
  orgId: string;
  employeeId: string;
  vendorName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  createdAt: string;
  updatedAt: string;
};

export type VendorBeneficiaryCreatePayload = {
  vendorName: string;
  bankAccountName: string;
  bankAccountNumber: string;
};

export type VendorBeneficiariesListResponseData = {
  vendors: VendorBeneficiary[];
};

export type VendorBeneficiaryCreateResponseData = {
  vendor: VendorBeneficiary;
};

export type VendorBeneficiariesListResponse = ApiResponse<VendorBeneficiariesListResponseData>;
export type VendorBeneficiaryCreateResponse = ApiResponse<VendorBeneficiaryCreateResponseData>;
