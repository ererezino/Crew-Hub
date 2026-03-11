import type { ApiResponse } from "./auth";

export const VENDOR_BENEFICIARY_PAYMENT_METHODS = ["bank_transfer", "mobile_money", "crew_tag", "international_wire"] as const;
export type VendorBeneficiaryPaymentMethod = (typeof VENDOR_BENEFICIARY_PAYMENT_METHODS)[number];

export type VendorBeneficiary = {
  id: string;
  orgId: string;
  employeeId: string;
  vendorName: string;
  paymentMethod: VendorBeneficiaryPaymentMethod;
  bankAccountName: string;
  bankAccountNumber: string;
  mobileMoneyProvider: string | null;
  mobileMoneyNumber: string | null;
  crewTag: string | null;
  wireBankName: string | null;
  wireAccountNumber: string | null;
  wireSwiftBic: string | null;
  wireIban: string | null;
  wireBankCountry: string | null;
  wireCurrency: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VendorBeneficiaryCreatePayload = {
  vendorName: string;
  paymentMethod?: VendorBeneficiaryPaymentMethod;
  bankAccountName?: string;
  bankAccountNumber?: string;
  mobileMoneyProvider?: string;
  mobileMoneyNumber?: string;
  crewTag?: string;
  wireBankName?: string;
  wireAccountNumber?: string;
  wireSwiftBic?: string;
  wireIban?: string;
  wireBankCountry?: string;
  wireCurrency?: string;
};

export type VendorBeneficiariesListResponseData = {
  vendors: VendorBeneficiary[];
};

export type VendorBeneficiaryCreateResponseData = {
  vendor: VendorBeneficiary;
};

export type VendorBeneficiariesListResponse = ApiResponse<VendorBeneficiariesListResponseData>;
export type VendorBeneficiaryCreateResponse = ApiResponse<VendorBeneficiaryCreateResponseData>;
