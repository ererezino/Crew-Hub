import { NextResponse } from "next/server";
import { z } from "zod";

import type { UserRole } from "../../../../lib/navigation";
import { hasRole } from "../../../../lib/roles";
import { parseCurrencyTotals } from "../../../../lib/payroll/runs";
import { PAYMENT_METHODS } from "../../../../types/payment-details";
import {
  PAYMENT_BATCH_STATUSES,
  PAYMENT_LEDGER_STATUSES,
  PAYMENT_PROVIDERS,
  type PaymentBatchRecord,
  type PaymentLedgerRecord
} from "../../../../types/payments";
import type { ApiResponse } from "../../../../types/auth";

export const paymentBatchStatusSchema = z.enum(PAYMENT_BATCH_STATUSES);
export const paymentLedgerStatusSchema = z.enum(PAYMENT_LEDGER_STATUSES);
export const paymentProviderSchema = z.enum(PAYMENT_PROVIDERS);
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);

export const paymentBatchRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  payroll_run_id: z.string().uuid(),
  total_amount: z.unknown(),
  payment_count: z.number().int(),
  status: paymentBatchStatusSchema,
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

export const paymentLedgerRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  payroll_item_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  batch_id: z.string().uuid(),
  amount: z.union([z.number(), z.string()]),
  currency: z.string().length(3),
  payment_method: paymentMethodSchema,
  provider: paymentProviderSchema,
  provider_reference: z.string().nullable(),
  idempotency_key: z.string(),
  status: paymentLedgerStatusSchema,
  failure_reason: z.string().nullable(),
  metadata: z.unknown(),
  created_at: z.string(),
  updated_at: z.string()
});

export function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

export function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export function canViewPayments(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

export function canManagePayments(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "SUPER_ADMIN");
}

function parseAmount(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed)) {
    return 0;
  }

  return Math.trunc(parsed);
}

function toMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function toPaymentBatchRecord(
  row: z.infer<typeof paymentBatchRowSchema>
): PaymentBatchRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    payrollRunId: row.payroll_run_id,
    totalAmount: parseCurrencyTotals(row.total_amount),
    paymentCount: row.payment_count,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function toPaymentLedgerRecord(
  row: z.infer<typeof paymentLedgerRowSchema>
): PaymentLedgerRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    payrollItemId: row.payroll_item_id,
    employeeId: row.employee_id,
    batchId: row.batch_id,
    amount: parseAmount(row.amount),
    currency: row.currency,
    paymentMethod: row.payment_method,
    provider: row.provider,
    providerReference: row.provider_reference,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    failureReason: row.failure_reason,
    metadata: toMetadata(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
