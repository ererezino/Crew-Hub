import type { ApiResponse } from "./auth";

export const PAYMENT_METHODS = ["bank_transfer", "mobile_money", "wise"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type PaymentDetailMasked = {
  id: string;
  employeeId: string;
  paymentMethod: PaymentMethod;
  currency: string;
  maskedDestination: string;
  last4: string | null;
  wiseRecipientIdMasked: string | null;
  isPrimary: boolean;
  isVerified: boolean;
  changeEffectiveAt: string;
  holdSecondsRemaining: number;
  createdAt: string;
  updatedAt: string;
};

export type MePaymentDetailsResponseData = {
  paymentDetail: PaymentDetailMasked | null;
  holdActive: boolean;
  holdEndsAt: string | null;
  holdSecondsRemaining: number;
};

export type MePaymentDetailsResponse = ApiResponse<MePaymentDetailsResponseData>;

export type PaymentDetailsUpdatePayload =
  | {
      paymentMethod: "bank_transfer";
      currency: string;
      bankName: string;
      bankAccountName: string;
      bankAccountNumber: string;
      bankRoutingNumber?: string | null;
    }
  | {
      paymentMethod: "mobile_money";
      currency: string;
      mobileMoneyProvider: string;
      mobileMoneyNumber: string;
    }
  | {
      paymentMethod: "wise";
      currency: string;
      wiseRecipientId: string;
    };

export type MePaymentDetailsMutationData = {
  paymentDetail: PaymentDetailMasked;
  holdActive: boolean;
  holdEndsAt: string;
  holdSecondsRemaining: number;
};

export type MePaymentDetailsMutationResponse = ApiResponse<MePaymentDetailsMutationData>;

export type HrPaymentDetailsRow = {
  employeeId: string;
  fullName: string;
  email: string;
  countryCode: string | null;
  status: "active" | "inactive" | "onboarding" | "offboarding";
  paymentMethod: PaymentMethod | null;
  currency: string | null;
  maskedDestination: string | null;
  last4: string | null;
  isVerified: boolean | null;
  changeEffectiveAt: string | null;
  holdSecondsRemaining: number;
  missingDetails: boolean;
};

export type HrPaymentDetailsResponseData = {
  rows: HrPaymentDetailsRow[];
};

export type HrPaymentDetailsResponse = ApiResponse<HrPaymentDetailsResponseData>;
