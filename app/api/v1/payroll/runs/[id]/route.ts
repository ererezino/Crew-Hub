import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { adjustmentTotal, deductionTotal } from "../../../../../../lib/payroll/runs";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type {
  PayrollRunAdjustment,
  PayrollRunAllowance,
  PayrollRunDeduction,
  PayrollRunDetailResponseData,
  PayrollRunEmployerContribution,
  PayrollRunItem
} from "../../../../../../types/payroll-runs";
import {
  buildMeta,
  canViewPayroll,
  jsonResponse,
  payrollAdjustmentSchema,
  payrollAllowanceSchema,
  payrollDeductionSchema,
  payrollItemPaymentStatusSchema,
  payrollRunRowSchema,
  toPayrollRunSummary
} from "../../_helpers";

const payrollItemRowSchema = z.object({
  id: z.string().uuid(),
  payroll_run_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  org_id: z.string().uuid(),
  gross_amount: z.union([z.number(), z.string()]),
  currency: z.string().length(3),
  pay_currency: z.string().length(3),
  base_salary_amount: z.union([z.number(), z.string()]),
  allowances: z.unknown(),
  adjustments: z.unknown(),
  deductions: z.unknown(),
  employer_contributions: z.unknown(),
  net_amount: z.union([z.number(), z.string()]),
  withholding_applied: z.boolean(),
  payment_status: payrollItemPaymentStatusSchema,
  payment_reference: z.string().nullable(),
  payment_id: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  flagged: z.boolean(),
  flag_reason: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  department: z.string().nullable(),
  country_code: z.string().nullable()
});

const previousRunRowSchema = z.object({
  id: z.string().uuid(),
  pay_period_end: z.string()
});

const previousPayrollItemRowSchema = z.object({
  employee_id: z.string().uuid(),
  payroll_run_id: z.string().uuid(),
  gross_amount: z.union([z.number(), z.string()]),
  net_amount: z.union([z.number(), z.string()]),
  pay_currency: z.string().length(3)
});

type PayrollComparisonRow = {
  runId: string;
  payPeriodEnd: string;
  grossAmount: number;
  netAmount: number;
  payCurrency: string;
  runOrder: number;
};

function parseAmount(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseAllowances(value: unknown): PayrollRunAllowance[] {
  const parsed = z.array(payrollAllowanceSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

function parseAdjustments(value: unknown): PayrollRunAdjustment[] {
  const parsed = z.array(payrollAdjustmentSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

function parseDeductions(value: unknown): PayrollRunDeduction[] {
  const parsed = z.array(payrollDeductionSchema).safeParse(value);

  if (!parsed.success) {
    return [];
  }

  return parsed.data.map((row) => ({
    ruleType: row.ruleType as PayrollRunDeduction["ruleType"],
    ruleName: row.ruleName,
    amount: row.amount,
    description: row.description
  }));
}

function parseEmployerContributions(value: unknown): PayrollRunEmployerContribution[] {
  const parsed = z.array(payrollDeductionSchema).safeParse(value);

  if (!parsed.success) {
    return [];
  }

  return parsed.data.map((row) => ({
    ruleType: row.ruleType as PayrollRunEmployerContribution["ruleType"],
    ruleName: row.ruleName,
    amount: row.amount,
    description: row.description
  }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view payroll run details."
      },
      meta: buildMeta()
    });
  }

  if (!canViewPayroll(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to view payroll run details."
      },
      meta: buildMeta()
    });
  }

  const { id: runId } = await params;

  try {
    const supabase = await createSupabaseServerClient();

    const { data: rawRun, error: runError } = await supabase
      .from("payroll_runs")
      .select(
        "id, org_id, pay_period_start, pay_period_end, pay_date, status, initiated_by, first_approved_by, first_approved_at, final_approved_by, final_approved_at, total_gross, total_net, total_deductions, total_employer_contributions, employee_count, snapshot, notes, created_at, updated_at"
      )
      .eq("org_id", session.profile.org_id)
      .eq("id", runId)
      .is("deleted_at", null)
      .maybeSingle();

    if (runError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_RUN_FETCH_FAILED",
          message: "Unable to load payroll run."
        },
        meta: buildMeta()
      });
    }

    const parsedRun = payrollRunRowSchema.safeParse(rawRun);

    if (!parsedRun.success) {
      return jsonResponse<null>(404, {
        data: null,
        error: {
          code: "NOT_FOUND",
          message: "Payroll run was not found."
        },
        meta: buildMeta()
      });
    }

    const [{ data: rawItems, error: itemsError }, { data: rawInitiator, error: initiatorError }] =
      await Promise.all([
        supabase
          .from("payroll_items")
          .select(
            "id, payroll_run_id, employee_id, org_id, gross_amount, currency, pay_currency, base_salary_amount, allowances, adjustments, deductions, employer_contributions, net_amount, withholding_applied, payment_status, payment_reference, payment_id, notes, flagged, flag_reason, created_at, updated_at"
          )
          .eq("org_id", session.profile.org_id)
          .eq("payroll_run_id", runId)
          .is("deleted_at", null)
          .order("created_at", { ascending: true }),
        parsedRun.data.initiated_by
          ? supabase
              .from("profiles")
              .select("id, full_name")
              .eq("org_id", session.profile.org_id)
              .eq("id", parsedRun.data.initiated_by)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null })
      ]);

    if (itemsError || initiatorError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_RUN_FETCH_FAILED",
          message: "Unable to load payroll run item data."
        },
        meta: buildMeta()
      });
    }

    const parsedItems = z.array(payrollItemRowSchema).safeParse(rawItems ?? []);

    if (!parsedItems.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_RUN_PARSE_FAILED",
          message: "Payroll run items are not in the expected format."
        },
        meta: buildMeta()
      });
    }

    const employeeIds = [...new Set(parsedItems.data.map((row) => row.employee_id))];
    const profileById = new Map<string, z.infer<typeof profileRowSchema>>();
    const previousComparisonByEmployeeId = new Map<string, PayrollComparisonRow>();

    if (employeeIds.length > 0) {
      const { data: rawProfiles, error: profileError } = await supabase
        .from("profiles")
        .select("id, full_name, department, country_code")
        .eq("org_id", session.profile.org_id)
        .in("id", employeeIds);

      if (profileError) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "PAYROLL_RUN_FETCH_FAILED",
            message: "Unable to load employee metadata for payroll items."
          },
          meta: buildMeta()
        });
      }

      const parsedProfiles = z.array(profileRowSchema).safeParse(rawProfiles ?? []);

      if (!parsedProfiles.success) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "PAYROLL_RUN_PARSE_FAILED",
            message: "Employee metadata for payroll items is invalid."
          },
          meta: buildMeta()
        });
      }

      for (const row of parsedProfiles.data) {
        profileById.set(row.id, row);
      }
    }

    if (employeeIds.length > 0) {
      const { data: rawPreviousRuns, error: previousRunsError } = await supabase
        .from("payroll_runs")
        .select("id, pay_period_end")
        .eq("org_id", session.profile.org_id)
        .neq("id", runId)
        .lt("pay_period_end", parsedRun.data.pay_period_end)
        .is("deleted_at", null)
        .order("pay_period_end", { ascending: false })
        .limit(24);

      if (!previousRunsError) {
        const parsedPreviousRuns = z.array(previousRunRowSchema).safeParse(rawPreviousRuns ?? []);

        if (parsedPreviousRuns.success && parsedPreviousRuns.data.length > 0) {
          const previousRunIds = parsedPreviousRuns.data.map((runRow) => runRow.id);
          const runOrderById = new Map(
            parsedPreviousRuns.data.map((runRow, runIndex) => [runRow.id, runIndex])
          );
          const payPeriodEndByRunId = new Map(
            parsedPreviousRuns.data.map((runRow) => [runRow.id, runRow.pay_period_end])
          );

          const { data: rawPreviousItems, error: previousItemsError } = await supabase
            .from("payroll_items")
            .select("employee_id, payroll_run_id, gross_amount, net_amount, pay_currency")
            .eq("org_id", session.profile.org_id)
            .is("deleted_at", null)
            .in("employee_id", employeeIds)
            .in("payroll_run_id", previousRunIds)
            .order("created_at", { ascending: false });

          if (!previousItemsError) {
            const parsedPreviousItems = z
              .array(previousPayrollItemRowSchema)
              .safeParse(rawPreviousItems ?? []);

            if (parsedPreviousItems.success) {
              for (const previousItem of parsedPreviousItems.data) {
                const runOrder = runOrderById.get(previousItem.payroll_run_id);
                const payPeriodEnd = payPeriodEndByRunId.get(previousItem.payroll_run_id);

                if (runOrder === undefined || !payPeriodEnd) {
                  continue;
                }

                const existingComparison = previousComparisonByEmployeeId.get(
                  previousItem.employee_id
                );

                if (
                  existingComparison &&
                  existingComparison.runOrder <= runOrder
                ) {
                  continue;
                }

                previousComparisonByEmployeeId.set(previousItem.employee_id, {
                  runId: previousItem.payroll_run_id,
                  payPeriodEnd,
                  grossAmount: parseAmount(previousItem.gross_amount),
                  netAmount: parseAmount(previousItem.net_amount),
                  payCurrency: previousItem.pay_currency,
                  runOrder
                });
              }
            }
          }
        }
      }
    }

    const items: PayrollRunItem[] = parsedItems.data.map((row) => {
      const profile = profileById.get(row.employee_id);
      const previousComparison = previousComparisonByEmployeeId.get(row.employee_id);
      const allowances = parseAllowances(row.allowances);
      const adjustments = parseAdjustments(row.adjustments);
      const deductions = parseDeductions(row.deductions);
      const employerContributions = parseEmployerContributions(row.employer_contributions);
      const grossAmount = parseAmount(row.gross_amount);
      const netAmount = parseAmount(row.net_amount);
      const previousGrossAmount = previousComparison?.grossAmount ?? null;
      const previousNetAmount = previousComparison?.netAmount ?? null;

      return {
        id: row.id,
        payrollRunId: row.payroll_run_id,
        employeeId: row.employee_id,
        fullName: profile?.full_name ?? "Unknown employee",
        department: profile?.department ?? null,
        countryCode: profile?.country_code ?? null,
        grossAmount,
        currency: row.currency,
        payCurrency: row.pay_currency,
        baseSalaryAmount: parseAmount(row.base_salary_amount),
        allowances,
        adjustments,
        deductions,
        employerContributions,
        netAmount,
        withholdingApplied: row.withholding_applied,
        paymentStatus: row.payment_status,
        paymentReference: row.payment_reference,
        paymentId: row.payment_id,
        notes: row.notes,
        flagged: row.flagged,
        flagReason: row.flag_reason,
        previousRunId: previousComparison?.runId ?? null,
        previousPayPeriodEnd: previousComparison?.payPeriodEnd ?? null,
        previousGrossAmount,
        previousNetAmount,
        grossVarianceAmount:
          previousGrossAmount === null ? null : grossAmount - previousGrossAmount,
        netVarianceAmount:
          previousNetAmount === null ? null : netAmount - previousNetAmount,
        deductionTotal: deductionTotal(deductions),
        adjustmentTotal: adjustmentTotal(adjustments),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    });

    const runSummary = toPayrollRunSummary(
      parsedRun.data,
      rawInitiator?.full_name ?? null
    );

    const responseData: PayrollRunDetailResponseData = {
      run: runSummary,
      items,
      flaggedCount: items.filter((item) => item.flagged).length
    };

    return jsonResponse<PayrollRunDetailResponseData>(200, {
      data: responseData,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYROLL_RUN_FETCH_FAILED",
        message: error instanceof Error ? error.message : "Unable to load payroll run details."
      },
      meta: buildMeta()
    });
  }
}
