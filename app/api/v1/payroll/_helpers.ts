import { NextResponse } from "next/server";
import { z } from "zod";

import type { UserRole } from "../../../../lib/navigation";
import { parseCurrencyTotals } from "../../../../lib/payroll/runs";
import { hasRole } from "../../../../lib/roles";
import type { ApiResponse } from "../../../../types/auth";
import {
  PAYROLL_ADJUSTMENT_TYPES,
  PAYROLL_ITEM_PAYMENT_STATUSES,
  PAYROLL_RUN_STATUSES,
  type PayrollRunSummary
} from "../../../../types/payroll-runs";

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
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

export function canManagePayroll(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "SUPER_ADMIN");
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
  initiatedByName: string | null
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
    firstApprovedAt: row.first_approved_at,
    finalApprovedBy: row.final_approved_by,
    finalApprovedAt: row.final_approved_at,
    totalGross: toCurrencyTotals(row.total_gross),
    totalNet: toCurrencyTotals(row.total_net),
    totalDeductions: toCurrencyTotals(row.total_deductions),
    totalEmployerContributions: toCurrencyTotals(row.total_employer_contributions),
    employeeCount: row.employee_count,
    snapshot: toSnapshot(row.snapshot),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
