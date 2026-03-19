import type { ApiResponse } from "./auth";

/**
 * Payment status from the payroll_items table.
 * Reflects the actual disbursement state of the underlying payroll item.
 */
export type ItemPaymentStatus =
  | "pending"
  | "processing"
  | "partially_paid"
  | "paid"
  | "failed"
  | "cancelled";

/**
 * A single pay statement (payslip document) belonging to an employee.
 */
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
  statementType: "native" | "historical";
  paymentStatus: ItemPaymentStatus;
  amountDisbursed: number;
  isAmendment: boolean;
  previousPayPeriod: string | null;
  previousNetAmount: number | null;
  netVarianceAmount: number | null;
  netVariancePercent: number | null;
};

/**
 * A single pay month groups all statements for a given YYYY-MM period.
 *
 * A month with one native payslip and one amendment will have two entries
 * in `statements`. The month-level totals reflect the effective amounts
 * (latest statement wins for display, but both are accessible).
 */
export type PayMonth = {
  payPeriod: string;
  /** Effective net (sum of all statements in the month). */
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  currency: string;
  /**
   * Worst-case payment status across all statements in the month.
   * pending > processing > partially_paid > paid.
   */
  paymentStatus: ItemPaymentStatus;
  /** Total amount actually disbursed across all cycles for this month. */
  amountDisbursed: number;
  /** totalNet - amountDisbursed (floored at 0). */
  amountRemaining: number;
  /** Whether any statement in this month is an amendment. */
  hasAmendment: boolean;
  /** Whether any statement in this month is historical/imported. */
  hasHistorical: boolean;
  /** All statements belonging to this month (usually 1). */
  statements: PaymentStatementRecord[];
};

export type PaymentStatementSummary = {
  grossAmount: number;
  deductionsAmount: number;
  netAmount: number;
  /** Confirmed disbursed across all paid cycles. */
  amountDisbursed: number;
  monthsPaid: number;
  currency: string;
};

export type MePayslipsResponseData = {
  year: number;
  availableYears: number[];
  summary: PaymentStatementSummary;
  /** Month-grouped view — the primary model for My Pay. */
  months: PayMonth[];
  /** Flat list preserved for backward compatibility with download/viewer. */
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
