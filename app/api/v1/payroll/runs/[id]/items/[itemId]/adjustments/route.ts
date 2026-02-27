import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../../../lib/audit";
import { addCurrencyTotal, normalizeCurrencyCode } from "../../../../../../../../../lib/payroll/runs";
import { createSupabaseServerClient } from "../../../../../../../../../lib/supabase/server";
import type { AddPayrollAdjustmentResponseData } from "../../../../../../../../../types/payroll-runs";
import {
  buildMeta,
  canManagePayroll,
  jsonResponse,
  parseIntegerAmount,
  parsePositiveIntegerAmount,
  payrollAdjustmentSchema,
  payrollDeductionSchema
} from "../../../../../_helpers";

const adjustmentBodySchema = z.object({
  adjustmentType: z.enum(["bonus", "deduction", "correction"]),
  label: z.string().trim().min(1).max(120),
  amount: z.union([z.number(), z.string()]),
  notes: z.string().trim().max(300).optional().nullable()
});

const payrollItemUpdateSchema = z.object({
  id: z.string().uuid(),
  gross_amount: z.union([z.number(), z.string()]),
  pay_currency: z.string().length(3),
  deductions: z.unknown(),
  adjustments: z.unknown(),
  net_amount: z.union([z.number(), z.string()])
});

function parseAmount(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function totalFromAmountRows(rows: ReadonlyArray<{ amount: number }>): number {
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to apply payroll adjustments."
      },
      meta: buildMeta()
    });
  }

  if (!canManagePayroll(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Finance Admin and Super Admin can apply payroll adjustments."
      },
      meta: buildMeta()
    });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Request body must be valid JSON."
      },
      meta: buildMeta()
    });
  }

  const parsedBody = adjustmentBodySchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid payroll adjustment payload."
      },
      meta: buildMeta()
    });
  }

  const parsedAmount =
    parsedBody.data.adjustmentType === "correction"
      ? parseIntegerAmount(parsedBody.data.amount)
      : parsePositiveIntegerAmount(parsedBody.data.amount);

  if (parsedAmount === null) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message:
          parsedBody.data.adjustmentType === "correction"
            ? "Correction amount must be a valid integer."
            : "Bonus and deduction amounts must be positive integers."
      },
      meta: buildMeta()
    });
  }

  if (parsedBody.data.adjustmentType === "correction" && parsedAmount === 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Correction amount cannot be zero."
      },
      meta: buildMeta()
    });
  }

  const signedAmount =
    parsedBody.data.adjustmentType === "bonus"
      ? Math.abs(parsedAmount)
      : parsedBody.data.adjustmentType === "deduction"
        ? Math.abs(parsedAmount) * -1
        : parsedAmount;

  const { id: runId, itemId } = await params;

  try {
    const supabase = await createSupabaseServerClient();

    const { data: rawItem, error: itemError } = await supabase
      .from("payroll_items")
      .select("id, gross_amount, pay_currency, deductions, adjustments, net_amount")
      .eq("org_id", session.profile.org_id)
      .eq("payroll_run_id", runId)
      .eq("id", itemId)
      .is("deleted_at", null)
      .maybeSingle();

    if (itemError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_ADJUSTMENT_FAILED",
          message: "Unable to load payroll item for adjustment."
        },
        meta: buildMeta()
      });
    }

    const parsedItem = payrollItemUpdateSchema.safeParse(rawItem);

    if (!parsedItem.success) {
      return jsonResponse<null>(404, {
        data: null,
        error: {
          code: "NOT_FOUND",
          message: "Payroll item was not found."
        },
        meta: buildMeta()
      });
    }

    const existingAdjustments = z.array(payrollAdjustmentSchema).safeParse(parsedItem.data.adjustments);
    const existingDeductions = z.array(payrollDeductionSchema).safeParse(parsedItem.data.deductions);

    const safeAdjustments = existingAdjustments.success ? existingAdjustments.data : [];
    const safeDeductions = existingDeductions.success ? existingDeductions.data : [];

    const nextAdjustment = {
      id: crypto.randomUUID(),
      type: parsedBody.data.adjustmentType,
      label: parsedBody.data.label.trim(),
      amount: signedAmount,
      notes: parsedBody.data.notes ?? null,
      createdAt: new Date().toISOString(),
      createdBy: session.profile.id
    };

    const nextAdjustments = [...safeAdjustments, nextAdjustment];
    const deductionTotal = totalFromAmountRows(safeDeductions);
    const adjustmentTotal = totalFromAmountRows(nextAdjustments);
    const grossAmount = parseAmount(parsedItem.data.gross_amount);
    const nextNetAmount = grossAmount - deductionTotal + adjustmentTotal;

    const { error: updateError } = await supabase
      .from("payroll_items")
      .update({
        adjustments: nextAdjustments,
        net_amount: nextNetAmount
      })
      .eq("org_id", session.profile.org_id)
      .eq("payroll_run_id", runId)
      .eq("id", itemId);

    if (updateError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_ADJUSTMENT_FAILED",
          message: `Unable to update payroll item adjustment: ${updateError.message}`
        },
        meta: buildMeta()
      });
    }

    const { data: rawRunItems, error: runItemsError } = await supabase
      .from("payroll_items")
      .select("net_amount, pay_currency")
      .eq("org_id", session.profile.org_id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null);

    if (runItemsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_ADJUSTMENT_FAILED",
          message: `Unable to refresh run totals after adjustment: ${runItemsError.message}`
        },
        meta: buildMeta()
      });
    }

    let nextTotalNet: Record<string, number> = {};

    for (const row of rawRunItems ?? []) {
      const rowNetAmount =
        typeof row.net_amount === "number"
          ? Math.trunc(row.net_amount)
          : typeof row.net_amount === "string"
            ? Number.parseInt(row.net_amount, 10)
            : 0;

      if (!Number.isFinite(rowNetAmount)) {
        continue;
      }

      const rowCurrency =
        typeof row.pay_currency === "string"
          ? normalizeCurrencyCode(row.pay_currency)
          : "USD";

      nextTotalNet = addCurrencyTotal(nextTotalNet, rowCurrency, rowNetAmount);
    }

    const { error: runUpdateError } = await supabase
      .from("payroll_runs")
      .update({ total_net: nextTotalNet })
      .eq("org_id", session.profile.org_id)
      .eq("id", runId);

    if (runUpdateError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_ADJUSTMENT_FAILED",
          message: `Unable to update run totals after adjustment: ${runUpdateError.message}`
        },
        meta: buildMeta()
      });
    }

    await logAudit({
      action: "updated",
      tableName: "payroll_items",
      recordId: itemId,
      oldValue: {
        netAmount: parseAmount(parsedItem.data.net_amount),
        adjustmentCount: safeAdjustments.length
      },
      newValue: {
        netAmount: nextNetAmount,
        adjustmentCount: nextAdjustments.length,
        latestAdjustment: {
          type: nextAdjustment.type,
          amount: nextAdjustment.amount
        }
      }
    });

    const responseData: AddPayrollAdjustmentResponseData = {
      itemId,
      netAmount: nextNetAmount,
      adjustments: nextAdjustments,
      adjustmentTotal
    };

    return jsonResponse<AddPayrollAdjustmentResponseData>(200, {
      data: responseData,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYROLL_ADJUSTMENT_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Unable to apply payroll adjustment."
      },
      meta: buildMeta()
    });
  }
}
