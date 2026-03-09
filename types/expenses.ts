import type { ApiResponse } from "./auth";

export const EXPENSE_CATEGORIES = [
  "travel",
  "lodging",
  "meals",
  "transport",
  "internet",
  "office_supplies",
  "software",
  "wellness",
  "marketing",
  "other"
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_STATUSES = [
  "pending",
  "manager_approved",
  "approved",
  "rejected",
  "finance_rejected",
  "reimbursed",
  "cancelled"
] as const;

export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
export type ExpenseApprovalStage = "manager" | "finance";

export const EXPENSE_ACTIONS = [
  "approve",
  "reject",
  "cancel",
  "mark_reimbursed"
] as const;

export type ExpenseAction = (typeof EXPENSE_ACTIONS)[number];

export const EXPENSE_TYPES = ["personal_reimbursement", "work_expense"] as const;
export type ExpenseType = (typeof EXPENSE_TYPES)[number];

export type ExpenseRecord = {
  id: string;
  orgId: string;
  employeeId: string;
  employeeName: string;
  employeeDepartment: string | null;
  employeeCountryCode: string | null;
  expenseType: ExpenseType;
  category: ExpenseCategory;
  customCategory: string | null;
  description: string;
  amount: number;
  currency: string;
  receiptFilePath: string;
  receiptFileName: string;
  expenseDate: string;
  status: ExpenseStatus;
  vendorName: string | null;
  vendorBankAccountName: string | null;
  vendorBankAccountNumber: string | null;
  managerApprovedBy: string | null;
  managerApprovedByName: string | null;
  managerApprovedAt: string | null;
  financeApprovedBy: string | null;
  financeApprovedByName: string | null;
  financeApprovedAt: string | null;
  financeRejectedBy: string | null;
  financeRejectedByName: string | null;
  financeRejectedAt: string | null;
  financeRejectionReason: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedByName: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  reimbursedBy: string | null;
  reimbursedByName: string | null;
  reimbursedAt: string | null;
  reimbursementReference: string | null;
  reimbursementNotes: string | null;
  reimbursementReceiptPath: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExpensesSummary = {
  totalCount: number;
  totalAmount: number;
  pendingCount: number;
  pendingAmount: number;
  approvedCount: number;
  managerApprovedCount: number;
  reimbursedCount: number;
  reimbursedAmount: number;
  rejectedCount: number;
  financeRejectedCount: number;
  cancelledCount: number;
};

export type ExpensesListResponseData = {
  expenses: ExpenseRecord[];
  summary: ExpensesSummary;
  month: string | null;
};

export type ExpenseMutationResponseData = {
  expense: ExpenseRecord;
};

export type ExpenseApprovalsResponseData = {
  stage: ExpenseApprovalStage;
  expenses: ExpenseRecord[];
  pendingCount: number;
  pendingAmount: number;
};

export type ExpenseBulkApproveResponseData = {
  stage: ExpenseApprovalStage;
  expenses: ExpenseRecord[];
  approvedCount: number;
  skippedIds: string[];
};

export type ExpenseReportBucket = {
  key: string;
  label: string;
  totalAmount: number;
  count: number;
};

export type ExpenseReportStatusBucket = {
  status: ExpenseStatus;
  label: string;
  totalAmount: number;
  count: number;
};

export type EnhancedEmployeeBucket = {
  key: string;
  label: string;
  department: string | null;
  totalAmount: number;
  count: number;
  avgProcessingHours: number | null;
  statusCounts: Record<string, number>;
};

export type EnhancedCategoryBucket = {
  key: string;
  label: string;
  totalAmount: number;
  count: number;
  pctOfTotal: number;
  mostCommonVendor: string | null;
};

export type EnhancedDepartmentBucket = {
  key: string;
  label: string;
  totalAmount: number;
  count: number;
  uniqueEmployees: number;
  topCategory: string | null;
};

export type ExpenseReportsResponseData = {
  month: string;
  primaryCurrency: string;
  totals: {
    expenseCount: number;
    totalAmount: number;
    managerApprovedAmount: number;
    financeApprovedAmount: number;
    pendingAmount: number;
    reimbursedAmount: number;
  };
  statusBreakdown: ExpenseReportStatusBucket[];
  timings: {
    avgSubmissionToManagerApprovalHours: number | null;
    avgManagerApprovalToDisbursementHours: number | null;
  };
  byCategory: ExpenseReportBucket[];
  byEmployee: ExpenseReportBucket[];
  byDepartment: ExpenseReportBucket[];
  enhancedByEmployee: EnhancedEmployeeBucket[];
  enhancedByCategory: EnhancedCategoryBucket[];
  enhancedByDepartment: EnhancedDepartmentBucket[];
};

export type ExpenseReceiptSignedUrlResponseData = {
  url: string;
  expiresInSeconds: number;
};

export type CreateExpenseResponse = ApiResponse<ExpenseMutationResponseData>;
export type UpdateExpensePayload = {
  action: ExpenseAction;
  rejectionReason?: string;
  financeRejectionReason?: string;
  reimbursementReference?: string;
  reimbursementNotes?: string;
  reimbursementReceiptPath?: string;
};
export type UpdateExpenseResponse = ApiResponse<ExpenseMutationResponseData>;
export type ExpensesListResponse = ApiResponse<ExpensesListResponseData>;
export type ExpenseApprovalsResponse = ApiResponse<ExpenseApprovalsResponseData>;
export type ExpenseBulkApprovePayload = {
  expenseIds: string[];
  stage: ExpenseApprovalStage;
};
export type ExpenseBulkApproveResponse = ApiResponse<ExpenseBulkApproveResponseData>;
export type ExpenseReportsResponse = ApiResponse<ExpenseReportsResponseData>;
export type ExpenseReceiptSignedUrlResponse = ApiResponse<ExpenseReceiptSignedUrlResponseData>;
