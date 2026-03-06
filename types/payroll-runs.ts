import type { ApiResponse } from "./auth";
import type { DeductionRuleType } from "./payroll";

export const PAYROLL_RUN_STATUSES = [
  "draft",
  "calculated",
  "pending_first_approval",
  "pending_final_approval",
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
  firstApprovedAt: string | null;
  finalApprovedBy: string | null;
  finalApprovedAt: string | null;
  totalGross: PayrollCurrencyTotals;
  totalNet: PayrollCurrencyTotals;
  totalDeductions: PayrollCurrencyTotals;
  totalEmployerContributions: PayrollCurrencyTotals;
  employeeCount: number;
  snapshot: Record<string, unknown>;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PayrollRunDashboardMetrics = {
  latestStatus: PayrollRunStatus | null;
  latestTotalCostAmount: number;
  latestEmployeeCount: number;
  nextPayDate: string | null;
  activeContractorCount: number;
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
  netAmount: number;
  withholdingApplied: boolean;
  paymentStatus: PayrollItemPaymentStatus;
  paymentReference: string | null;
  paymentId: string | null;
  notes: string | null;
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
  activeContractorCount: number;
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
  action: "submit" | "approve_first" | "approve_final" | "reject" | "cancel";
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
