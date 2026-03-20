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
  "partially_paid",
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
  cycle1Date: string | null;
  cycle2Date: string | null;
  publishedAt: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  completedAt: string | null;
  completedBy: string | null;
  amendmentOf: string | null;
  lockedAt: string | null;
  isHistorical: boolean;
  reviewedAt: string | null;
  reviewedBy: string | null;
  authorizedAt: string | null;
  authorizedBy: string | null;
  publishedBy: string | null;
  provenanceNote: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HistoricalActionPayload = {
  action: "review" | "authorize" | "publish";
  provenanceNote?: string | null;
};

export type HistoricalActionResponseData = {
  run: PayrollRunSummary;
};

export const PAYROLL_CYCLE_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "ready",
  "processing",
  "paid",
  "failed",
  "cancelled"
] as const;

export type PayrollCycleStatus = (typeof PAYROLL_CYCLE_STATUSES)[number];

export type PayrollCycle = {
  id: string;
  payrollRunId: string;
  orgId: string;
  label: string;
  cycleNumber: number | null;
  currency: string;
  status: PayrollCycleStatus;
  targetPayDate: string | null;
  preparedAt: string | null;
  preparedBy: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  paidAt: string | null;
  paidBy: string | null;
  paymentReference: string | null;
  paymentNote: string | null;
  paymentSnapshot: Record<string, unknown>;
  approvalSnapshot: PayrollCycleApprovalSnapshot | null;
  reconciledAt: string | null;
  reconciledBy: string | null;
  reconciliationNotes: string | null;
  lockedAt: string | null;
  totalGross: number;
  totalNet: number;
  totalDeductions: number;
  totalOvertime: number;
  totalBonus: number;
  totalFees: number;
  employeeCount: number;
  createdAt: string;
  updatedAt: string;
};

/** Frozen snapshot created at cycle submission time.
 *  This is THE authoritative record — approval review, payment evidence,
 *  CSV/PDF exports, and audit all read from this snapshot. */
export type PayrollCycleApprovalSnapshot = {
  cycleNumber: number;
  cycleLabel: string;
  targetPayDate: string;
  submittedAt: string;
  submittedBy: string;
  submittedByName: string;
  currency: string;
  employeeCount: number;
  totalGross: number;
  totalNet: number;
  totalDeductions: number;
  totalOvertime: number;
  totalBonus: number;
  totalFees: number;
  rows: PayrollCycleSnapshotRow[];
};

export type PayrollCycleSnapshotRow = {
  employeeId: string;
  employeeName: string;
  designation: string | null;
  department: string | null;
  accrueUsername: string | null;
  monthlySalary: number;
  cycleBaseAmount: number;
  overtimeHours: number;
  overtimeRate: number;
  overtimeAmount: number;
  bonus: number;
  fees: number;
  finalPayable: number;
  comment: string | null;
  exceptionReason: string | null;
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
  designation: string | null;
  accrueUsername: string | null;
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
  /* ── Semimonthly worksheet columns ─────────────────────────────── */
  cycle1BaseAmount: number;
  cycle2BaseAmount: number;
  cycle1OvertimeHours: number;
  cycle2OvertimeHours: number;
  cycle1OvertimeAmount: number;
  cycle2OvertimeAmount: number;
  cycle1Included: boolean;
  cycle2Included: boolean;
  fees: number;
  bonus: number;
  comment: string | null;
  exceptionReason: string | null;
  monthlyTotal: number;
  createdAt: string;
  updatedAt: string;
};

export type PayrollRunDetailResponseData = {
  run: PayrollRunSummary;
  items: PayrollRunItem[];
  cycles: PayrollCycle[];
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
export type HistoricalActionResponse = ApiResponse<HistoricalActionResponseData>;

export type PreparePayoutResponseData = {
  cycles: PayrollCycle[];
  runStatus: PayrollRunStatus;
};

export type MarkCyclePaidResponseData = {
  cycle: PayrollCycle;
};

export type CreateAmendmentRunResponseData = {
  run: PayrollRunSummary;
};

export type EmployeeRemainingEntry = {
  employeeId: string;
  employeeName: string;
  payrollItemId: string;
  netAmount: number;
  disbursed: number;
  remaining: number;
  currency: string;
};

export type RemainingResponseData = {
  entries: EmployeeRemainingEntry[];
};

export type PreparePayoutResponse = ApiResponse<PreparePayoutResponseData>;
export type MarkCyclePaidResponse = ApiResponse<MarkCyclePaidResponseData>;
export type CreateAmendmentRunResponse = ApiResponse<CreateAmendmentRunResponseData>;
export type RemainingResponse = ApiResponse<RemainingResponseData>;

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

/* ------------------------------------------------------------------ */
/*  Cycle-level approval action types                                  */
/* ------------------------------------------------------------------ */

export type PayrollCycleActionType =
  | "submit"
  | "approve"
  | "reject"
  | "mark_ready"
  | "mark_processing"
  | "mark_paid";

export type PayrollCycleActionPayload = {
  action: PayrollCycleActionType;
  reason?: string | null;
  paymentReference?: string | null;
  paymentNote?: string | null;
};

export type PayrollCycleActionResponseData = {
  cycle: PayrollCycle;
};

export type PayrollCycleActionResponse = ApiResponse<PayrollCycleActionResponseData>;

/* ------------------------------------------------------------------ */
/*  Worksheet row edit types                                           */
/* ------------------------------------------------------------------ */

export type WorksheetRowEditPayload = {
  cycle1BaseAmount?: number;
  cycle2BaseAmount?: number;
  cycle1OvertimeHours?: number;
  cycle2OvertimeHours?: number;
  cycle1Included?: boolean;
  cycle2Included?: boolean;
  fees?: number;
  bonus?: number;
  comment?: string | null;
  exceptionReason?: string | null;
};

export type WorksheetRowEditResponseData = {
  item: PayrollRunItem;
};

export type WorksheetRowEditResponse = ApiResponse<WorksheetRowEditResponseData>;

/* ------------------------------------------------------------------ */
/*  Cycle export types                                                 */
/* ------------------------------------------------------------------ */

export type CycleExportFormat = "csv" | "pdf";

export type CycleExportResponseData = {
  url: string;
  format: CycleExportFormat;
  cycleId: string;
  generatedAt: string;
};
