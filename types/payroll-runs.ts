import type { ApiResponse } from "./auth";
import type { DeductionRuleType } from "./payroll";

export const PAYROLL_RUN_STATUSES = [
  "draft",
  "calculated",
  "submitted",
  "rejected",
  "approved",
  "processing",
  "completed",
  "cancelled"
] as const;

export type PayrollRunStatus = (typeof PAYROLL_RUN_STATUSES)[number];

export const PAYROLL_ITEM_PAYMENT_STATUSES = [
  "pending",
  "processing",
  "paid",
  "failed",
  "cancelled"
] as const;

export type PayrollItemPaymentStatus = (typeof PAYROLL_ITEM_PAYMENT_STATUSES)[number];

export const PAYROLL_ADJUSTMENT_TYPES = ["bonus", "deduction", "correction"] as const;

export type PayrollAdjustmentType = (typeof PAYROLL_ADJUSTMENT_TYPES)[number];

export type PayrollCurrencyTotals = Record<string, number>;

export type PayrollRunSummary = {
  id: string;
  orgId: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  payDate: string;
  status: PayrollRunStatus;
  initiatedBy: string | null;
  initiatedByName: string | null;
  firstApprovedBy: string | null;
  firstApprovedByName: string | null;
  firstApprovedAt: string | null;
  finalApprovedBy: string | null;
  finalApprovedByName: string | null;
  finalApprovedAt: string | null;
  totalGross: PayrollCurrencyTotals;
  totalNet: PayrollCurrencyTotals;
  totalDeductions: PayrollCurrencyTotals;
  totalEmployerContributions: PayrollCurrencyTotals;
  employeeCount: number;
  snapshot: Record<string, unknown>;
  notes: string | null;
  runMonth: string | null;
  publishedAt: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  completedAt: string | null;
  amendmentOf: string | null;
  lockedAt: string | null;
  isHistorical: boolean;
  reviewedAt: string | null;
  reviewedBy: string | null;
  authorizedAt: string | null;
  authorizedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PayrollCycleStatus = "draft" | "ready" | "processing" | "paid" | "failed" | "cancelled";

export type PayrollCycle = {
  id: string;
  payrollRunId: string;
  orgId: string;
  label: string;
  currency: string;
  status: PayrollCycleStatus;
  targetPayDate: string | null;
  preparedAt: string | null;
  preparedBy: string | null;
  paidAt: string | null;
  paidBy: string | null;
  paymentSnapshot: Record<string, unknown>;
  reconciledAt: string | null;
  reconciledBy: string | null;
  reconciliationNotes: string | null;
  lockedAt: string | null;
  totalGross: number;
  totalNet: number;
  totalDeductions: number;
  employeeCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PayrollCycleItemDisbursementStatus = "pending" | "processing" | "paid" | "failed";

export type PayrollCycleItem = {
  id: string;
  payrollCycleId: string;
  payrollItemId: string;
  employeeId: string;
  orgId: string;
  paymentDestinationSnapshot: Record<string, unknown>;
  disbursementStatus: PayrollCycleItemDisbursementStatus;
  disbursementReference: string | null;
  disbursementAmount: number;
  createdAt: string;
  updatedAt: string;
};

export type OvertimeEntryStatus = "pending" | "approved" | "rejected";

export type OvertimeEntry = {
  id: string;
  employeeId: string;
  orgId: string;
  entryDate: string;
  hours: number;
  multiplier: number;
  amount: number;
  currency: string;
  description: string | null;
  status: OvertimeEntryStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  payrollItemId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PayslipStatementType = "native" | "historical";

export type PayrollRunDashboardMetrics = {
  latestStatus: PayrollRunStatus | null;
  latestTotalCostAmount: number;
  latestEmployeeCount: number;
  nextPayDate: string | null;
  eligibleEmployeeCount: number;
};

export type PayrollRunsDashboardResponseData = {
  metrics: PayrollRunDashboardMetrics;
  runs: PayrollRunSummary[];
};

export type PayrollRunAllowance = {
  label: string;
  amount: number;
  currency: string;
  isTaxable: boolean;
};

export type PayrollRunAdjustment = {
  id: string;
  type: PayrollAdjustmentType;
  label: string;
  amount: number;
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
};

export type PayrollRunDeduction = {
  ruleType: DeductionRuleType;
  ruleName: string;
  amount: number;
  description: string;
};

export type PayrollRunEmployerContribution = {
  ruleType: DeductionRuleType;
  ruleName: string;
  amount: number;
  description: string;
};

export type PayrollRunItem = {
  id: string;
  payrollRunId: string;
  employeeId: string;
  fullName: string;
  department: string | null;
  countryCode: string | null;
  grossAmount: number;
  currency: string;
  payCurrency: string;
  baseSalaryAmount: number;
  allowances: PayrollRunAllowance[];
  adjustments: PayrollRunAdjustment[];
  deductions: PayrollRunDeduction[];
  employerContributions: PayrollRunEmployerContribution[];
  overtimeAmount: number;
  overtimeHours: number;
  netAmount: number;
  withholdingApplied: boolean;
  paymentStatus: PayrollItemPaymentStatus;
  paymentReference: string | null;
  paymentId: string | null;
  notes: string | null;
  financeNotes: string | null;
  correctionOf: string | null;
  correctionReason: string | null;
  flagged: boolean;
  flagReason: string | null;
  previousRunId: string | null;
  previousPayPeriodEnd: string | null;
  previousGrossAmount: number | null;
  previousNetAmount: number | null;
  grossVarianceAmount: number | null;
  netVarianceAmount: number | null;
  deductionTotal: number;
  adjustmentTotal: number;
  createdAt: string;
  updatedAt: string;
};

export type PayrollRunDetailResponseData = {
  run: PayrollRunSummary;
  items: PayrollRunItem[];
  flaggedCount: number;
};

export type CreatePayrollRunPayload = {
  payPeriodStart?: string;
  payPeriodEnd?: string;
  payDate?: string;
  notes?: string | null;
};

export type CreatePayrollRunResponseData = {
  run: PayrollRunSummary;
  eligibleEmployeeCount: number;
};

export type CalculatePayrollRunResponseData = {
  runId: string;
  status: PayrollRunStatus;
  employeeCount: number;
  flaggedCount: number;
  totalGross: PayrollCurrencyTotals;
  totalNet: PayrollCurrencyTotals;
  totalDeductions: PayrollCurrencyTotals;
  totalEmployerContributions: PayrollCurrencyTotals;
};

export type AddPayrollAdjustmentPayload = {
  adjustmentType: PayrollAdjustmentType;
  label: string;
  amount: number;
  notes?: string | null;
};

export type AddPayrollAdjustmentResponseData = {
  itemId: string;
  netAmount: number;
  adjustments: PayrollRunAdjustment[];
  adjustmentTotal: number;
};

export type PayrollRunActionPayload = {
  action: "submit" | "approve" | "reject" | "cancel" | "reopen" | "mark_processing" | "mark_completed";
  reason?: string | null;
};

export type PayrollRunActionResponseData = {
  run: PayrollRunSummary;
};

export type PayrollRunsDashboardResponse = ApiResponse<PayrollRunsDashboardResponseData>;
export type PayrollRunDetailResponse = ApiResponse<PayrollRunDetailResponseData>;
export type CreatePayrollRunResponse = ApiResponse<CreatePayrollRunResponseData>;
export type CalculatePayrollRunResponse = ApiResponse<CalculatePayrollRunResponseData>;
export type AddPayrollAdjustmentResponse = ApiResponse<AddPayrollAdjustmentResponseData>;
export type PayrollRunActionResponse = ApiResponse<PayrollRunActionResponseData>;

/* ------------------------------------------------------------------ */
/*  CSV Import types                                                   */
/* ------------------------------------------------------------------ */

export type CsvImportPreviewRow = {
  rowNumber: number;
  employeeEmail: string;
  employeeId: string;
  employeeName: string;
  baseSalary: number;
  currency: string;
  allowances: { label: string; amount: number }[];
  bonus: { label: string; amount: number } | null;
  deduction: { label: string; amount: number } | null;
  notes: string | null;
  hasConflict: boolean;
};

export type CsvImportError = {
  row: number;
  field: string;
  message: string;
};

export type CsvImportSummary = {
  totalRows: number;
  validCount: number;
  errorCount: number;
  duplicateCount: number;
  conflictCount: number;
};

export type CsvImportPreviewResponseData = {
  validRows: CsvImportPreviewRow[];
  errors: CsvImportError[];
  duplicates: string[];
  conflicts: string[];
  summary: CsvImportSummary;
  committed: boolean;
};

export type CsvImportPreviewResponse = ApiResponse<CsvImportPreviewResponseData>;

/* ------------------------------------------------------------------ */
/*  Manual payroll item edit types                                     */
/* ------------------------------------------------------------------ */

export type EditPayrollItemPayload = {
  baseSalaryAmount?: number;
  allowances?: { label: string; amount: number; currency: string; isTaxable: boolean }[];
  currency?: string;
  reason: string;
};

export type EditPayrollItemResponseData = {
  itemId: string;
  updatedFields: string[];
  runStatusReset: boolean;
};

export type EditPayrollItemResponse = ApiResponse<EditPayrollItemResponseData>;
