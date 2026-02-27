import type { ApiResponse } from "./auth";
import type { PaymentMethod } from "./payment-details";

export const PAYMENT_BATCH_STATUSES = ["processing", "completed", "failed", "cancelled"] as const;

export type PaymentBatchStatus = (typeof PAYMENT_BATCH_STATUSES)[number];

export const PAYMENT_LEDGER_STATUSES = ["processing", "completed", "failed", "cancelled"] as const;

export type PaymentLedgerStatus = (typeof PAYMENT_LEDGER_STATUSES)[number];

export const PAYMENT_PROVIDERS = ["mock", "cashramp", "wise"] as const;

export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export type PaymentBatchRecord = {
  id: string;
  orgId: string;
  payrollRunId: string;
  totalAmount: Record<string, number>;
  paymentCount: number;
  status: PaymentBatchStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaymentLedgerRecord = {
  id: string;
  orgId: string;
  payrollItemId: string;
  employeeId: string;
  batchId: string;
  amount: number;
  currency: string;
  paymentMethod: PaymentMethod;
  provider: PaymentProvider;
  providerReference: string | null;
  idempotencyKey: string;
  status: PaymentLedgerStatus;
  failureReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CreatePaymentBatchPayload = {
  payrollRunId: string;
};

export type PaymentBatchSummary = {
  createdCount: number;
  reusedCount: number;
  retriedCount: number;
  completedCount: number;
  failedCount: number;
};

export type CreatePaymentBatchResponseData = {
  batch: PaymentBatchRecord;
  payments: PaymentLedgerRecord[];
  summary: PaymentBatchSummary;
};

export type GetPaymentBatchResponseData = {
  batch: PaymentBatchRecord;
  payments: PaymentLedgerRecord[];
};

export type GetPaymentResponseData = {
  payment: PaymentLedgerRecord;
};

export type RetryPaymentResponseData = {
  payment: PaymentLedgerRecord;
  batchStatus: PaymentBatchStatus;
};

export type PaymentsWebhookResponseData = {
  received: boolean;
  provider: PaymentProvider;
};

export type CreatePaymentBatchResponse = ApiResponse<CreatePaymentBatchResponseData>;
export type GetPaymentBatchResponse = ApiResponse<GetPaymentBatchResponseData>;
export type GetPaymentResponse = ApiResponse<GetPaymentResponseData>;
export type RetryPaymentResponse = ApiResponse<RetryPaymentResponseData>;
export type PaymentsWebhookResponse = ApiResponse<PaymentsWebhookResponseData>;
