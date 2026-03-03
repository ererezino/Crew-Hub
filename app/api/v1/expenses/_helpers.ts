import { NextResponse } from "next/server";
import { z } from "zod";

import type { UserRole } from "../../../../lib/navigation";
import { hasRole } from "../../../../lib/roles";
import { parseIntegerAmount, receiptFileNameFromPath } from "../../../../lib/expenses";
import type { ApiResponse } from "../../../../types/auth";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  type ExpenseRecord
} from "../../../../types/expenses";

export const expenseCategorySchema = z.enum(EXPENSE_CATEGORIES);
export const expenseStatusSchema = z.enum(EXPENSE_STATUSES);
export const expenseSelectColumns =
  "id, org_id, employee_id, category, description, amount, currency, receipt_file_path, expense_date, status, manager_approved_by, manager_approved_at, finance_approved_by, finance_approved_at, finance_rejected_by, finance_rejected_at, finance_rejection_reason, approved_by, approved_at, rejected_by, rejected_at, rejection_reason, reimbursed_by, reimbursed_at, reimbursement_reference, reimbursement_notes, created_at, updated_at";

export const expenseRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  category: expenseCategorySchema,
  description: z.string(),
  amount: z.union([z.number(), z.string()]),
  currency: z.string().length(3),
  receipt_file_path: z.string(),
  expense_date: z.string(),
  status: expenseStatusSchema,
  manager_approved_by: z.string().uuid().nullable(),
  manager_approved_at: z.string().nullable(),
  finance_approved_by: z.string().uuid().nullable(),
  finance_approved_at: z.string().nullable(),
  finance_rejected_by: z.string().uuid().nullable(),
  finance_rejected_at: z.string().nullable(),
  finance_rejection_reason: z.string().nullable(),
  approved_by: z.string().uuid().nullable(),
  approved_at: z.string().nullable(),
  rejected_by: z.string().uuid().nullable(),
  rejected_at: z.string().nullable(),
  rejection_reason: z.string().nullable(),
  reimbursed_by: z.string().uuid().nullable(),
  reimbursed_at: z.string().nullable(),
  reimbursement_reference: z.string().nullable(),
  reimbursement_notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

export const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  department: z.string().nullable(),
  country_code: z.string().nullable(),
  manager_id: z.string().uuid().nullable()
});

export function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

export function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export function canApproveExpenses(roles: readonly UserRole[]): boolean {
  return canManagerApproveExpenses(roles) || canFinanceApproveExpenses(roles);
}

export function canManagerApproveExpenses(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "MANAGER") || hasRole(roles, "SUPER_ADMIN");
}

export function canFinanceApproveExpenses(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "SUPER_ADMIN");
}

export function canViewExpenseReports(roles: readonly UserRole[]): boolean {
  return (
    canApproveExpenses(roles) ||
    hasRole(roles, "HR_ADMIN")
  );
}

export function canReimburseExpenses(roles: readonly UserRole[]): boolean {
  return canFinanceApproveExpenses(roles);
}

export function isExpenseAdmin(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

export function toExpenseRecord(
  row: z.infer<typeof expenseRowSchema>,
  profileById: ReadonlyMap<string, z.infer<typeof profileRowSchema>>
): ExpenseRecord {
  const employee = profileById.get(row.employee_id);
  const managerApprovedBy = row.manager_approved_by
    ? profileById.get(row.manager_approved_by)
    : null;
  const financeApprovedBy = row.finance_approved_by
    ? profileById.get(row.finance_approved_by)
    : null;
  const financeRejectedBy = row.finance_rejected_by
    ? profileById.get(row.finance_rejected_by)
    : null;
  const approvedBy = row.approved_by
    ? profileById.get(row.approved_by)
    : managerApprovedBy;
  const rejectedBy = row.rejected_by ? profileById.get(row.rejected_by) : null;
  const reimbursedBy = row.reimbursed_by ? profileById.get(row.reimbursed_by) : null;

  return {
    id: row.id,
    orgId: row.org_id,
    employeeId: row.employee_id,
    employeeName: employee?.full_name ?? "Unknown user",
    employeeDepartment: employee?.department ?? null,
    employeeCountryCode: employee?.country_code ?? null,
    category: row.category,
    description: row.description,
    amount: parseIntegerAmount(row.amount),
    currency: row.currency,
    receiptFilePath: row.receipt_file_path,
    receiptFileName: receiptFileNameFromPath(row.receipt_file_path),
    expenseDate: row.expense_date,
    status: row.status,
    managerApprovedBy: row.manager_approved_by ?? row.approved_by,
    managerApprovedByName: managerApprovedBy?.full_name ?? approvedBy?.full_name ?? null,
    managerApprovedAt: row.manager_approved_at ?? row.approved_at,
    financeApprovedBy: row.finance_approved_by,
    financeApprovedByName: financeApprovedBy?.full_name ?? null,
    financeApprovedAt: row.finance_approved_at,
    financeRejectedBy: row.finance_rejected_by,
    financeRejectedByName: financeRejectedBy?.full_name ?? null,
    financeRejectedAt: row.finance_rejected_at,
    financeRejectionReason: row.finance_rejection_reason,
    approvedBy: row.approved_by ?? row.manager_approved_by,
    approvedByName: approvedBy?.full_name ?? null,
    approvedAt: row.approved_at ?? row.manager_approved_at,
    rejectedBy: row.rejected_by,
    rejectedByName: rejectedBy?.full_name ?? null,
    rejectedAt: row.rejected_at,
    rejectionReason: row.rejection_reason,
    reimbursedBy: row.reimbursed_by,
    reimbursedByName: reimbursedBy?.full_name ?? null,
    reimbursedAt: row.reimbursed_at,
    reimbursementReference: row.reimbursement_reference,
    reimbursementNotes: row.reimbursement_notes,
    reimbursementReceiptPath: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function collectProfileIds(
  expenses: readonly z.infer<typeof expenseRowSchema>[]
): string[] {
  const ids = new Set<string>();

  for (const expense of expenses) {
    ids.add(expense.employee_id);

    if (expense.manager_approved_by) {
      ids.add(expense.manager_approved_by);
    }

    if (expense.finance_approved_by) {
      ids.add(expense.finance_approved_by);
    }

    if (expense.finance_rejected_by) {
      ids.add(expense.finance_rejected_by);
    }

    if (expense.approved_by) {
      ids.add(expense.approved_by);
    }

    if (expense.rejected_by) {
      ids.add(expense.rejected_by);
    }

    if (expense.reimbursed_by) {
      ids.add(expense.reimbursed_by);
    }
  }

  return [...ids];
}
