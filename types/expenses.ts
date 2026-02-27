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
  "other"
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "reimbursed",
  "cancelled"
] as const;

export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const EXPENSE_ACTIONS = [
  "approve",
  "reject",
  "cancel",
  "mark_reimbursed"
] as const;

export type ExpenseAction = (typeof EXPENSE_ACTIONS)[number];

export type ExpenseRecord = {
  id: string;
  orgId: string;
  employeeId: string;
  employeeName: string;
  employeeDepartment: string | null;
  employeeCountryCode: string | null;
  category: ExpenseCategory;
  description: string;
  amount: number;
  currency: string;
  receiptFilePath: string;
  receiptFileName: string;
  expenseDate: string;
  status: ExpenseStatus;
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
  createdAt: string;
  updatedAt: string;
};

export type ExpensesSummary = {
  totalCount: number;
  totalAmount: number;
  pendingCount: number;
  pendingAmount: number;
  approvedCount: number;
  reimbursedCount: number;
  reimbursedAmount: number;
  rejectedCount: number;
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
  expenses: ExpenseRecord[];
  pendingCount: number;
  pendingAmount: number;
};

export type ExpenseBulkApproveResponseData = {
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

export type ExpenseReportsResponseData = {
  month: string;
  totals: {
    expenseCount: number;
    totalAmount: number;
    pendingAmount: number;
    reimbursedAmount: number;
  };
  byCategory: ExpenseReportBucket[];
  byEmployee: ExpenseReportBucket[];
  byDepartment: ExpenseReportBucket[];
};

export type ExpenseReceiptSignedUrlResponseData = {
  url: string;
  expiresInSeconds: number;
};

export type CreateExpenseResponse = ApiResponse<ExpenseMutationResponseData>;
export type UpdateExpensePayload = {
  action: ExpenseAction;
  rejectionReason?: string;
  reimbursementReference?: string;
  reimbursementNotes?: string;
};
export type UpdateExpenseResponse = ApiResponse<ExpenseMutationResponseData>;
export type ExpensesListResponse = ApiResponse<ExpensesListResponseData>;
export type ExpenseApprovalsResponse = ApiResponse<ExpenseApprovalsResponseData>;
export type ExpenseBulkApprovePayload = {
  expenseIds: string[];
};
export type ExpenseBulkApproveResponse = ApiResponse<ExpenseBulkApproveResponseData>;
export type ExpenseReportsResponse = ApiResponse<ExpenseReportsResponseData>;
export type ExpenseReceiptSignedUrlResponse = ApiResponse<ExpenseReceiptSignedUrlResponseData>;
