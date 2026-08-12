import { NextResponse } from "next/server";
import { z } from "zod";

import type { UserRole } from "../../../../lib/navigation";
import { hasRole } from "../../../../lib/roles";
import { parseIntegerAmount, receiptFileNameFromPath } from "../../../../lib/expenses";
import type { ApiResponse } from "../../../../types/auth";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  type ExpenseAttachment,
  type ExpenseRecord
} from "../../../../types/expenses";

export const expenseCategorySchema = z.enum(EXPENSE_CATEGORIES);
export const expenseStatusSchema = z.enum(EXPENSE_STATUSES);
export const expenseSelectColumns =
  "id, org_id, employee_id, expense_type, category, custom_category, description, amount, currency, receipt_file_path, expense_date, status, vendor_name, vendor_payment_method, vendor_bank_account_name, vendor_bank_account_number, vendor_mobile_money_provider, vendor_mobile_money_number, vendor_crew_tag, vendor_wire_bank_name, vendor_wire_account_number, vendor_wire_swift_bic, vendor_wire_iban, vendor_wire_bank_country, vendor_wire_currency, manager_approved_by, manager_approved_at, manager_acting_for, manager_delegate_type, requires_additional_approval, additional_approver_id, matched_rule_id, additional_approved_by, additional_approved_at, additional_acting_for, additional_delegate_type, additional_rejected_by, additional_rejected_at, additional_rejection_reason, finance_approved_by, finance_approved_at, finance_rejected_by, finance_rejected_at, finance_rejection_reason, approved_by, approved_at, rejected_by, rejected_at, rejection_reason, reimbursed_by, reimbursed_at, reimbursement_reference, reimbursement_notes, reimbursement_receipt_path, created_at, updated_at";

export const expenseRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  expense_type: z.string().default("personal_reimbursement"),
  category: expenseCategorySchema,
  custom_category: z.string().nullable().default(null),
  description: z.string(),
  amount: z.union([z.number(), z.string()]),
  currency: z.string().length(3),
  receipt_file_path: z.string(),
  expense_date: z.string(),
  status: expenseStatusSchema,
  vendor_name: z.string().nullable().default(null),
  vendor_payment_method: z.string().nullable().default(null),
  vendor_bank_account_name: z.string().nullable().default(null),
  vendor_bank_account_number: z.string().nullable().default(null),
  vendor_mobile_money_provider: z.string().nullable().default(null),
  vendor_mobile_money_number: z.string().nullable().default(null),
  vendor_crew_tag: z.string().nullable().default(null),
  vendor_wire_bank_name: z.string().nullable().default(null),
  vendor_wire_account_number: z.string().nullable().default(null),
  vendor_wire_swift_bic: z.string().nullable().default(null),
  vendor_wire_iban: z.string().nullable().default(null),
  vendor_wire_bank_country: z.string().nullable().default(null),
  vendor_wire_currency: z.string().nullable().default(null),
  manager_approved_by: z.string().uuid().nullable(),
  manager_approved_at: z.string().nullable(),
  manager_acting_for: z.string().uuid().nullable().optional(),
  manager_delegate_type: z.string().nullable().optional(),
  requires_additional_approval: z.boolean().default(false),
  additional_approver_id: z.string().uuid().nullable().optional(),
  matched_rule_id: z.string().uuid().nullable().optional(),
  additional_approved_by: z.string().uuid().nullable().optional(),
  additional_approved_at: z.string().nullable().optional(),
  additional_acting_for: z.string().uuid().nullable().optional(),
  additional_delegate_type: z.string().nullable().optional(),
  additional_rejected_by: z.string().uuid().nullable().optional(),
  additional_rejected_at: z.string().nullable().optional(),
  additional_rejection_reason: z.string().nullable().optional(),
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
  reimbursement_receipt_path: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

export const expenseAttachmentSelectColumns =
  "id, expense_id, file_name, file_path, file_size_bytes, mime_type, sort_order, created_at";

export const expenseAttachmentRowSchema = z.object({
  id: z.string().uuid(),
  expense_id: z.string().uuid(),
  file_name: z.string(),
  file_path: z.string(),
  file_size_bytes: z.union([z.number(), z.string()]).nullable().default(null),
  mime_type: z.string().nullable().default(null),
  sort_order: z.number().default(0),
  created_at: z.string()
});

export function toExpenseAttachment(
  row: z.infer<typeof expenseAttachmentRowSchema>
): ExpenseAttachment {
  const sizeBytes =
    row.file_size_bytes === null || row.file_size_bytes === undefined
      ? null
      : parseIntegerAmount(row.file_size_bytes);

  return {
    id: row.id,
    fileName: row.file_name,
    filePath: row.file_path,
    mimeType: row.mime_type ?? null,
    fileSizeBytes: sizeBytes,
    createdAt: row.created_at
  };
}

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

export function jsonResponse<T>(status: number, payload: ApiResponse<T>, headers?: Record<string, string>) {
  return NextResponse.json(payload, { status, headers });
}

export function canApproveExpenses(roles: readonly UserRole[]): boolean {
  return canManagerApproveExpenses(roles) || canFinanceApproveExpenses(roles);
}

export function canManagerApproveExpenses(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "MANAGER") || hasRole(roles, "TEAM_LEAD") || hasRole(roles, "SUPER_ADMIN");
}

export function canFinanceApproveExpenses(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "FINANCE_APPROVER") || hasRole(roles, "SUPER_ADMIN");
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

const COMMENTABLE_EXPENSE_STATUSES = new Set(["pending", "manager_approved", "approved"]);
const FINANCE_THREAD_STATUSES = new Set(["manager_approved", "approved"]);

/**
 * Who may open an info-request thread on an expense at its current status.
 * `isManagerOwner` must be the OPERATIONAL answer (team lead / manager
 * fallback / active delegate — see resolveIsOperationalApprover in the
 * comments route), not a raw manager_id comparison.
 */
export function canRequestExpenseInfo({
  roles,
  isOwner,
  isSuperAdmin,
  isManagerOwner,
  status
}: {
  roles: readonly UserRole[];
  isOwner: boolean;
  isSuperAdmin: boolean;
  isManagerOwner: boolean;
  status: string;
}): boolean {
  if (isOwner || !COMMENTABLE_EXPENSE_STATUSES.has(status)) {
    return false;
  }

  if (status === "pending") {
    return isSuperAdmin || isManagerOwner;
  }

  if (FINANCE_THREAD_STATUSES.has(status)) {
    return isSuperAdmin || hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "FINANCE_APPROVER");
  }

  return false;
}

export function isExpenseAdmin(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "FINANCE_APPROVER") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

export function toExpenseRecord(
  row: z.infer<typeof expenseRowSchema>,
  profileById: ReadonlyMap<string, z.infer<typeof profileRowSchema>>,
  attachmentsByExpenseId?: ReadonlyMap<string, ExpenseAttachment[]>
): ExpenseRecord {
  const employee = profileById.get(row.employee_id);

  /* Attachments are the source of truth for an expense's documents. When no map
   * is supplied (a caller that hasn't fetched them), fall back to a synthetic
   * single attachment built from the legacy receipt_file_path so every viewer
   * still gets at least the primary document. */
  const fetchedAttachments = attachmentsByExpenseId?.get(row.id) ?? [];
  const attachments: ExpenseAttachment[] =
    fetchedAttachments.length > 0
      ? fetchedAttachments
      : row.receipt_file_path
        ? [
            {
              id: `primary:${row.id}`,
              fileName: receiptFileNameFromPath(row.receipt_file_path),
              filePath: row.receipt_file_path,
              mimeType: null,
              fileSizeBytes: null,
              createdAt: row.created_at
            }
          ]
        : [];
  const primaryAttachment = attachments[0] ?? null;
  const receiptFilePath = primaryAttachment?.filePath ?? row.receipt_file_path;
  const receiptFileName =
    primaryAttachment?.fileName ?? receiptFileNameFromPath(row.receipt_file_path);
  const managerApprovedBy = row.manager_approved_by
    ? profileById.get(row.manager_approved_by)
    : null;
  const additionalApprover = row.additional_approver_id
    ? profileById.get(row.additional_approver_id)
    : null;
  const additionalApprovedBy = row.additional_approved_by
    ? profileById.get(row.additional_approved_by)
    : null;
  const additionalRejectedBy = row.additional_rejected_by
    ? profileById.get(row.additional_rejected_by)
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
    expenseType: (row.expense_type as "personal_reimbursement" | "work_expense") ?? "personal_reimbursement",
    category: row.category,
    customCategory: row.custom_category ?? null,
    description: row.description,
    amount: parseIntegerAmount(row.amount),
    currency: row.currency,
    receiptFilePath,
    receiptFileName,
    attachments,
    expenseDate: row.expense_date,
    status: row.status,
    vendorName: row.vendor_name ?? null,
    vendorPaymentMethod: (row.vendor_payment_method as ExpenseRecord["vendorPaymentMethod"]) ?? null,
    vendorBankAccountName: row.vendor_bank_account_name ?? null,
    vendorBankAccountNumber: row.vendor_bank_account_number ?? null,
    vendorMobileMoneyProvider: row.vendor_mobile_money_provider ?? null,
    vendorMobileMoneyNumber: row.vendor_mobile_money_number ?? null,
    vendorCrewTag: row.vendor_crew_tag ?? null,
    vendorWireBankName: row.vendor_wire_bank_name ?? null,
    vendorWireAccountNumber: row.vendor_wire_account_number ?? null,
    vendorWireSwiftBic: row.vendor_wire_swift_bic ?? null,
    vendorWireIban: row.vendor_wire_iban ?? null,
    vendorWireBankCountry: row.vendor_wire_bank_country ?? null,
    vendorWireCurrency: row.vendor_wire_currency ?? null,
    managerApprovedBy: row.manager_approved_by ?? row.approved_by,
    managerApprovedByName: managerApprovedBy?.full_name ?? approvedBy?.full_name ?? null,
    managerApprovedAt: row.manager_approved_at ?? row.approved_at,
    managerActingFor: row.manager_acting_for ?? null,
    managerActingForName: row.manager_acting_for
      ? (profileById.get(row.manager_acting_for)?.full_name ?? null)
      : null,
    managerDelegateType: row.manager_delegate_type ?? null,
    requiresAdditionalApproval: row.requires_additional_approval ?? false,
    additionalApproverId: row.additional_approver_id ?? null,
    additionalApproverName: additionalApprover?.full_name ?? null,
    matchedRuleId: row.matched_rule_id ?? null,
    additionalApprovedBy: row.additional_approved_by ?? null,
    additionalApprovedByName: additionalApprovedBy?.full_name ?? null,
    additionalApprovedAt: row.additional_approved_at ?? null,
    additionalActingFor: row.additional_acting_for ?? null,
    additionalActingForName: row.additional_acting_for
      ? (profileById.get(row.additional_acting_for)?.full_name ?? null)
      : null,
    additionalDelegateType: row.additional_delegate_type ?? null,
    additionalRejectedBy: row.additional_rejected_by ?? null,
    additionalRejectedByName: additionalRejectedBy?.full_name ?? null,
    additionalRejectedAt: row.additional_rejected_at ?? null,
    additionalRejectionReason: row.additional_rejection_reason ?? null,
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
    reimbursementReceiptPath: row.reimbursement_receipt_path ?? null,
    infoRequestState: "none",
    infoRequestUpdatedAt: null,
    infoRequestUpdatedByName: null,
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

    if (expense.manager_acting_for) {
      ids.add(expense.manager_acting_for);
    }

    if (expense.additional_approver_id) {
      ids.add(expense.additional_approver_id);
    }

    if (expense.additional_approved_by) {
      ids.add(expense.additional_approved_by);
    }

    if (expense.additional_acting_for) {
      ids.add(expense.additional_acting_for);
    }

    if (expense.additional_rejected_by) {
      ids.add(expense.additional_rejected_by);
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
