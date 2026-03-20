import { NextResponse } from "next/server";
import { z } from "zod";

import type { UserRole } from "../../../../lib/navigation";
import { parseCurrencyTotals } from "../../../../lib/payroll/runs";
import { hasRole } from "../../../../lib/roles";
import type { ApiResponse } from "../../../../types/auth";
import {
  PAYROLL_ADJUSTMENT_TYPES,
  PAYROLL_CYCLE_STATUSES,
  PAYROLL_ITEM_PAYMENT_STATUSES,
  PAYROLL_RUN_STATUSES,
  type PayrollCycle,
  type PayrollCycleApprovalSnapshot,
  type PayrollRunSummary
} from "../../../../types/payroll-runs";

/** Shared select columns for payroll_cycles queries. */
export const PAYROLL_CYCLE_SELECT_COLUMNS =
  "id, payroll_run_id, org_id, label, cycle_number, currency, status, target_pay_date, prepared_at, prepared_by, submitted_at, submitted_by, approved_at, approved_by, rejected_at, rejected_by, rejection_reason, paid_at, paid_by, payment_reference, payment_note, payment_snapshot, approval_snapshot, reconciled_at, reconciled_by, reconciliation_notes, locked_at, total_gross, total_net, total_deductions, total_overtime, total_bonus, total_fees, employee_count, created_at, updated_at";

/** Shared select columns for payroll_runs queries. All routes should use this
 *  so new audit/approval columns are consistently returned. */
export const PAYROLL_RUN_SELECT_COLUMNS =
  "id, org_id, pay_period_start, pay_period_end, pay_date, status, initiated_by, first_approved_by, first_approved_at, final_approved_by, final_approved_at, total_gross, total_net, total_deductions, total_employer_contributions, employee_count, snapshot, notes, run_month, cycle_1_date, cycle_2_date, published_at, published_by, submitted_at, submitted_by, rejected_at, rejected_by, rejection_reason, completed_at, completed_by, locked_at, amendment_of, is_historical, reviewed_at, reviewed_by, authorized_at, authorized_by, provenance_note, created_at, updated_at";

export const payrollRunStatusSchema = z.enum(PAYROLL_RUN_STATUSES);
export const payrollItemPaymentStatusSchema = z.enum(PAYROLL_ITEM_PAYMENT_STATUSES);
export const payrollAdjustmentTypeSchema = z.enum(PAYROLL_ADJUSTMENT_TYPES);

export const payrollAllowanceSchema = z.object({
  label: z.string(),
  amount: z.number().int(),
  currency: z.string().length(3),
  isTaxable: z.boolean()
});

export const payrollAdjustmentSchema = z.object({
  id: z.string(),
  type: payrollAdjustmentTypeSchema,
  label: z.string(),
  amount: z.number().int(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid().nullable()
});

export const payrollDeductionSchema = z.object({
  ruleType: z.string(),
  ruleName: z.string(),
  amount: z.number().int(),
  description: z.string()
});

export const payrollRunRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  pay_period_start: z.string(),
  pay_period_end: z.string(),
  pay_date: z.string(),
  status: payrollRunStatusSchema,
  initiated_by: z.string().uuid().nullable(),
  first_approved_by: z.string().uuid().nullable(),
  first_approved_at: z.string().nullable(),
  final_approved_by: z.string().uuid().nullable(),
  final_approved_at: z.string().nullable(),
  total_gross: z.unknown(),
  total_net: z.unknown(),
  total_deductions: z.unknown(),
  total_employer_contributions: z.unknown(),
  employee_count: z.number().int(),
  snapshot: z.unknown(),
  notes: z.string().nullable(),
  run_month: z.string().nullable().optional().default(null),
  cycle_1_date: z.string().nullable().optional().default(null),
  cycle_2_date: z.string().nullable().optional().default(null),
  published_at: z.string().nullable().optional().default(null),
  published_by: z.string().uuid().nullable().optional().default(null),
  submitted_at: z.string().nullable().optional().default(null),
  submitted_by: z.string().uuid().nullable().optional().default(null),
  rejected_at: z.string().nullable().optional().default(null),
  rejected_by: z.string().uuid().nullable().optional().default(null),
  rejection_reason: z.string().nullable().optional().default(null),
  completed_at: z.string().nullable().optional().default(null),
  completed_by: z.string().uuid().nullable().optional().default(null),
  amendment_of: z.string().uuid().nullable().optional().default(null),
  locked_at: z.string().nullable().optional().default(null),
  is_historical: z.boolean().optional().default(false),
  reviewed_at: z.string().nullable().optional().default(null),
  reviewed_by: z.string().uuid().nullable().optional().default(null),
  authorized_at: z.string().nullable().optional().default(null),
  authorized_by: z.string().uuid().nullable().optional().default(null),
  provenance_note: z.string().nullable().optional().default(null),
  created_at: z.string(),
  updated_at: z.string()
});

export function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

export function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export function canViewPayroll(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "FINANCE_APPROVER") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

export function canApprovePayroll(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_APPROVER") || hasRole(roles, "SUPER_ADMIN");
}

export function canManagePayroll(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "FINANCE_APPROVER") || hasRole(roles, "SUPER_ADMIN");
}

export function parseIntegerAmount(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      return null;
    }

    return value;
  }

  if (typeof value !== "string" || !/^-?\d+$/.test(value.trim())) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(parsed)) {
    return null;
  }

  return parsed;
}

export function parsePositiveIntegerAmount(value: unknown): number | null {
  const parsed = parseIntegerAmount(value);

  if (parsed === null || parsed <= 0) {
    return null;
  }

  return parsed;
}

export function sumAmounts(
  rows: ReadonlyArray<{ amount: number }>
): number {
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

export function toCurrencyTotals(value: unknown) {
  return parseCurrencyTotals(value);
}

export function toSnapshot(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function toPayrollRunSummary(
  row: z.infer<typeof payrollRunRowSchema>,
  initiatedByName: string | null,
  approverNames?: { firstApprovedByName?: string | null; finalApprovedByName?: string | null }
): PayrollRunSummary {
  return {
    id: row.id,
    orgId: row.org_id,
    payPeriodStart: row.pay_period_start,
    payPeriodEnd: row.pay_period_end,
    payDate: row.pay_date,
    status: row.status,
    initiatedBy: row.initiated_by,
    initiatedByName,
    firstApprovedBy: row.first_approved_by,
    firstApprovedByName: approverNames?.firstApprovedByName ?? null,
    firstApprovedAt: row.first_approved_at,
    finalApprovedBy: row.final_approved_by,
    finalApprovedByName: approverNames?.finalApprovedByName ?? null,
    finalApprovedAt: row.final_approved_at,
    totalGross: toCurrencyTotals(row.total_gross),
    totalNet: toCurrencyTotals(row.total_net),
    totalDeductions: toCurrencyTotals(row.total_deductions),
    totalEmployerContributions: toCurrencyTotals(row.total_employer_contributions),
    employeeCount: row.employee_count,
    snapshot: toSnapshot(row.snapshot),
    notes: row.notes,
    runMonth: row.run_month ?? null,
    cycle1Date: row.cycle_1_date ?? null,
    cycle2Date: row.cycle_2_date ?? null,
    publishedAt: row.published_at ?? null,
    submittedAt: row.submitted_at ?? null,
    submittedBy: row.submitted_by ?? null,
    rejectedAt: row.rejected_at ?? null,
    rejectionReason: row.rejection_reason ?? null,
    completedAt: row.completed_at ?? null,
    completedBy: row.completed_by ?? null,
    amendmentOf: row.amendment_of ?? null,
    lockedAt: row.locked_at ?? null,
    isHistorical: row.is_historical ?? false,
    reviewedAt: row.reviewed_at ?? null,
    reviewedBy: row.reviewed_by ?? null,
    authorizedAt: row.authorized_at ?? null,
    authorizedBy: row.authorized_by ?? null,
    publishedBy: row.published_by ?? null,
    provenanceNote: row.provenance_note ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// ── Payroll cycle schemas / mappers ─────────────────────────────────

export const payrollCycleRowSchema = z.object({
  id: z.string().uuid(),
  payroll_run_id: z.string().uuid(),
  org_id: z.string().uuid(),
  label: z.string(),
  cycle_number: z.number().int().nullable().optional().default(null),
  currency: z.string().length(3),
  status: z.enum(PAYROLL_CYCLE_STATUSES),
  target_pay_date: z.string().nullable(),
  prepared_at: z.string().nullable(),
  prepared_by: z.string().uuid().nullable(),
  submitted_at: z.string().nullable().optional().default(null),
  submitted_by: z.string().uuid().nullable().optional().default(null),
  approved_at: z.string().nullable().optional().default(null),
  approved_by: z.string().uuid().nullable().optional().default(null),
  rejected_at: z.string().nullable().optional().default(null),
  rejected_by: z.string().uuid().nullable().optional().default(null),
  rejection_reason: z.string().nullable().optional().default(null),
  paid_at: z.string().nullable(),
  paid_by: z.string().uuid().nullable(),
  payment_reference: z.string().nullable().optional().default(null),
  payment_note: z.string().nullable().optional().default(null),
  payment_snapshot: z.unknown(),
  approval_snapshot: z.unknown().optional().default(null),
  reconciled_at: z.string().nullable(),
  reconciled_by: z.string().uuid().nullable(),
  reconciliation_notes: z.string().nullable(),
  locked_at: z.string().nullable(),
  total_gross: z.union([z.number(), z.string()]),
  total_net: z.union([z.number(), z.string()]),
  total_deductions: z.union([z.number(), z.string()]),
  total_overtime: z.union([z.number(), z.string()]).optional().default(0),
  total_bonus: z.union([z.number(), z.string()]).optional().default(0),
  total_fees: z.union([z.number(), z.string()]).optional().default(0),
  employee_count: z.number().int(),
  created_at: z.string(),
  updated_at: z.string()
});

export function toPayrollCycleSummary(
  row: z.infer<typeof payrollCycleRowSchema>
): PayrollCycle {
  const approvalSnapshotRaw = row.approval_snapshot;
  const approvalSnapshot: PayrollCycleApprovalSnapshot | null =
    approvalSnapshotRaw && typeof approvalSnapshotRaw === "object" && !Array.isArray(approvalSnapshotRaw)
      ? (approvalSnapshotRaw as PayrollCycleApprovalSnapshot)
      : null;

  return {
    id: row.id,
    payrollRunId: row.payroll_run_id,
    orgId: row.org_id,
    label: row.label,
    cycleNumber: row.cycle_number ?? null,
    currency: row.currency,
    status: row.status,
    targetPayDate: row.target_pay_date,
    preparedAt: row.prepared_at,
    preparedBy: row.prepared_by,
    submittedAt: row.submitted_at ?? null,
    submittedBy: row.submitted_by ?? null,
    approvedAt: row.approved_at ?? null,
    approvedBy: row.approved_by ?? null,
    rejectedAt: row.rejected_at ?? null,
    rejectedBy: row.rejected_by ?? null,
    rejectionReason: row.rejection_reason ?? null,
    paidAt: row.paid_at,
    paidBy: row.paid_by,
    paymentReference: row.payment_reference ?? null,
    paymentNote: row.payment_note ?? null,
    paymentSnapshot: toSnapshot(row.payment_snapshot),
    approvalSnapshot,
    reconciledAt: row.reconciled_at,
    reconciledBy: row.reconciled_by,
    reconciliationNotes: row.reconciliation_notes,
    lockedAt: row.locked_at,
    totalGross: parseAmount(row.total_gross),
    totalNet: parseAmount(row.total_net),
    totalDeductions: parseAmount(row.total_deductions),
    totalOvertime: parseAmount(row.total_overtime),
    totalBonus: parseAmount(row.total_bonus),
    totalFees: parseAmount(row.total_fees),
    employeeCount: row.employee_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseAmount(value: string | number | unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
