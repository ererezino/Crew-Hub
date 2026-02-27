import type { ApiResponse } from "./auth";

export type PaymentStatementRecord = {
  id: string;
  payrollItemId: string;
  payPeriod: string;
  filePath: string;
  generatedAt: string;
  emailedAt: string | null;
  viewedAt: string | null;
  grossAmount: number;
  deductionsAmount: number;
  netAmount: number;
  currency: string;
  paymentReference: string | null;
  withholdingApplied: boolean;
};

export type PaymentStatementSummary = {
  grossAmount: number;
  deductionsAmount: number;
  netAmount: number;
  monthsPaid: number;
  currency: string;
};

export type MePayslipsResponseData = {
  year: number;
  availableYears: number[];
  summary: PaymentStatementSummary;
  statements: PaymentStatementRecord[];
};

export type GeneratePayslipsResultItem = {
  payslipId: string;
  payrollItemId: string;
  employeeId: string;
  payPeriod: string;
};

export type GeneratePayslipsResponseData = {
  runId: string;
  generatedCount: number;
  skippedCount: number;
  statements: GeneratePayslipsResultItem[];
};

export type PaymentStatementSignedUrlResponseData = {
  url: string;
  expiresInSeconds: number;
};

export type MePayslipsResponse = ApiResponse<MePayslipsResponseData>;
export type GeneratePayslipsResponse = ApiResponse<GeneratePayslipsResponseData>;
export type PaymentStatementSignedUrlResponse = ApiResponse<PaymentStatementSignedUrlResponseData>;
