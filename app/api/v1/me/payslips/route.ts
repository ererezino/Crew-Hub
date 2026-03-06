import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import type {
  MePayslipsResponseData,
  PaymentStatementRecord,
  PaymentStatementSummary
} from "../../../../../types/payslips";

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(3000).optional()
});

const yearRowSchema = z.object({
  pay_period: z.string().regex(/^\d{4}-\d{2}$/)
});

const payrollItemRowSchema = z.object({
  gross_amount: z.union([z.number(), z.string()]),
  net_amount: z.union([z.number(), z.string()]),
  currency: z.string().length(3),
  deductions: z.unknown(),
  withholding_applied: z.boolean(),
  payment_reference: z.string().nullable()
});

const payslipRowSchema = z.object({
  id: z.string().uuid(),
  payroll_item_id: z.string().uuid(),
  pay_period: z.string().regex(/^\d{4}-\d{2}$/),
  file_path: z.string(),
  generated_at: z.string(),
  emailed_at: z.string().nullable(),
  viewed_at: z.string().nullable(),
  payroll_item: z.union([payrollItemRowSchema, z.array(payrollItemRowSchema)])
});

const deductionRowSchema = z.object({
  amount: z.union([z.number(), z.string()])
});

function buildMeta() {
  return {
    timestamp: new Date().toISOString()
  };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function parseAmount(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed)) {
    return 0;
  }

  return Math.trunc(parsed);
}

function parseDeductionTotal(value: unknown): number {
  const parsed = z.array(deductionRowSchema).safeParse(value);

  if (!parsed.success) {
    return 0;
  }

  return parsed.data.reduce((sum, row) => sum + parseAmount(row.amount), 0);
}

function computeVariancePercent(currentAmount: number, previousAmount: number): number | null {
  if (previousAmount === 0) {
    if (currentAmount === 0) {
      return 0;
    }

    return null;
  }

  const delta = ((currentAmount - previousAmount) / Math.abs(previousAmount)) * 100;

  if (!Number.isFinite(delta)) {
    return null;
  }

  return Number.parseFloat(delta.toFixed(2));
}

function toPayrollItem(
  row: z.infer<typeof payslipRowSchema>
): z.infer<typeof payrollItemRowSchema> | null {
  if (Array.isArray(row.payroll_item)) {
    return row.payroll_item[0] ?? null;
  }

  return row.payroll_item;
}

function emptySummary(currency: string): PaymentStatementSummary {
  return {
    grossAmount: 0,
    deductionsAmount: 0,
    netAmount: 0,
    monthsPaid: 0,
    currency
  };
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view payment statements."
      },
      meta: buildMeta()
    });
  }

  const requestUrl = new URL(request.url);
  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(requestUrl.searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message:
          parsedQuery.error.issues[0]?.message ?? "Invalid payment statement query parameters."
      },
      meta: buildMeta()
    });
  }

  const selectedYear = parsedQuery.data.year ?? new Date().getUTCFullYear();

  try {
    const supabase = await createSupabaseServerClient();

    const [{ data: rawYearRows, error: yearsError }, { data: rawRows, error: rowsError }] =
      await Promise.all([
        supabase
          .from("payslips")
          .select("pay_period")
          .eq("org_id", session.profile.org_id)
          .eq("employee_id", session.profile.id)
          .is("deleted_at", null)
          .order("pay_period", { ascending: false }),
        supabase
          .from("payslips")
          .select(
            "id, payroll_item_id, pay_period, file_path, generated_at, emailed_at, viewed_at, payroll_item:payroll_items!inner(gross_amount, net_amount, currency, deductions, withholding_applied, payment_reference)"
          )
          .eq("org_id", session.profile.org_id)
          .eq("employee_id", session.profile.id)
          .is("deleted_at", null)
          .gte("pay_period", `${selectedYear}-01`)
          .lte("pay_period", `${selectedYear}-12`)
          .order("pay_period", { ascending: false })
          .order("generated_at", { ascending: false })
      ]);

    if (yearsError || rowsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYMENT_STATEMENTS_FETCH_FAILED",
          message: "Unable to load payment statement records."
        },
        meta: buildMeta()
      });
    }

    const parsedYearRows = z.array(yearRowSchema).safeParse(rawYearRows ?? []);
    const parsedRows = z.array(payslipRowSchema).safeParse(rawRows ?? []);

    if (!parsedYearRows.success || !parsedRows.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYMENT_STATEMENTS_PARSE_FAILED",
          message: "Payment statement data is not in the expected format."
        },
        meta: buildMeta()
      });
    }

    const availableYears = [
      ...new Set(parsedYearRows.data.map((row) => Number.parseInt(row.pay_period.slice(0, 4), 10)))
    ]
      .filter((yearValue) => Number.isFinite(yearValue))
      .sort((leftYear, rightYear) => rightYear - leftYear);

    const statements: PaymentStatementRecord[] = [];

    for (const row of parsedRows.data) {
      const payrollItem = toPayrollItem(row);

      if (!payrollItem) {
        continue;
      }

      const deductionsAmount = parseDeductionTotal(payrollItem.deductions);

      statements.push({
        id: row.id,
        payrollItemId: row.payroll_item_id,
        payPeriod: row.pay_period,
        filePath: row.file_path,
        generatedAt: row.generated_at,
        emailedAt: row.emailed_at,
        viewedAt: row.viewed_at,
        grossAmount: parseAmount(payrollItem.gross_amount),
        deductionsAmount,
        netAmount: parseAmount(payrollItem.net_amount),
        currency: payrollItem.currency.toUpperCase(),
        paymentReference: payrollItem.payment_reference,
        withholdingApplied: payrollItem.withholding_applied,
        previousPayPeriod: null,
        previousNetAmount: null,
        netVarianceAmount: null,
        netVariancePercent: null
      });
    }

    const summary = statements.reduce<PaymentStatementSummary>(
      (currentSummary, statement) => ({
        grossAmount: currentSummary.grossAmount + statement.grossAmount,
        deductionsAmount: currentSummary.deductionsAmount + statement.deductionsAmount,
        netAmount: currentSummary.netAmount + statement.netAmount,
        monthsPaid: currentSummary.monthsPaid,
        currency: statement.currency
      }),
      emptySummary("USD")
    );

    summary.monthsPaid = new Set(statements.map((statement) => statement.payPeriod)).size;

    const statementsWithVariance = statements.map((statement, statementIndex) => {
      const previousStatement = statements[statementIndex + 1] ?? null;
      const previousNetAmount = previousStatement?.netAmount ?? null;
      const netVarianceAmount =
        previousNetAmount === null ? null : statement.netAmount - previousNetAmount;
      const netVariancePercent =
        previousNetAmount === null
          ? null
          : computeVariancePercent(statement.netAmount, previousNetAmount);

      return {
        ...statement,
        previousPayPeriod: previousStatement?.payPeriod ?? null,
        previousNetAmount,
        netVarianceAmount,
        netVariancePercent
      };
    });

    const responseData: MePayslipsResponseData = {
      year: selectedYear,
      availableYears:
        availableYears.length > 0 ? availableYears : [selectedYear],
      summary,
      statements: statementsWithVariance
    };

    return jsonResponse<MePayslipsResponseData>(200, {
      data: responseData,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYMENT_STATEMENTS_FETCH_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Unable to load payment statements."
      },
      meta: buildMeta()
    });
  }
}
