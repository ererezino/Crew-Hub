import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { calculatePayrollItem } from "../../../../../../../lib/payroll/calculate-payroll-item";
import {
  addCurrencyTotal,
  normalizeCurrencyCode,
  parseCurrencyTotals
} from "../../../../../../../lib/payroll/runs";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import type { CalculatePayrollRunResponseData } from "../../../../../../../types/payroll-runs";
import {
  buildMeta,
  canManagePayroll,
  jsonResponse,
  payrollAdjustmentSchema,
  payrollRunRowSchema,
  toSnapshot
} from "../../../_helpers";

const eligibleProfileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  department: z.string().nullable(),
  country_code: z.string().nullable(),
  primary_currency: z.string().nullable(),
  start_date: z.string().nullable()
});

const compensationRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  base_salary_amount: z.union([z.number(), z.string()]),
  currency: z.string().length(3),
  effective_from: z.string(),
  effective_to: z.string().nullable(),
  updated_at: z.string()
});

const allowanceRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  label: z.string(),
  amount: z.union([z.number(), z.string()]),
  currency: z.string().length(3),
  is_taxable: z.boolean(),
  effective_from: z.string(),
  effective_to: z.string().nullable()
});

const paymentDetailsRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid()
});

const existingItemRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  adjustments: z.unknown()
});

function parseAmount(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function adjustmentAmountTotal(adjustments: ReadonlyArray<{ amount: number }>): number {
  return adjustments.reduce((sum, row) => sum + Math.trunc(row.amount), 0);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to calculate payroll runs."
      },
      meta: buildMeta()
    });
  }

  if (!canManagePayroll(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Finance Admin and Super Admin can calculate payroll runs."
      },
      meta: buildMeta()
    });
  }

  const profile = session.profile;

  const { id: runId } = await params;

  try {
    const supabase = await createSupabaseServerClient();

    const { data: rawRun, error: runError } = await supabase
      .from("payroll_runs")
      .select(
        "id, org_id, pay_period_start, pay_period_end, pay_date, status, initiated_by, first_approved_by, first_approved_at, final_approved_by, final_approved_at, total_gross, total_net, total_deductions, total_employer_contributions, employee_count, snapshot, notes, created_at, updated_at"
      )
      .eq("org_id", profile.org_id)
      .eq("id", runId)
      .is("deleted_at", null)
      .maybeSingle();

    if (runError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_RUN_FETCH_FAILED",
          message: "Unable to load payroll run for calculation."
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

    if (
      parsedRun.data.status !== "draft" &&
      parsedRun.data.status !== "calculated"
    ) {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "INVALID_RUN_STATE",
          message: `Payroll run cannot be calculated from status: ${parsedRun.data.status}.`
        },
        meta: buildMeta()
      });
    }

    const { data: rawEligibleProfiles, error: eligibleProfilesError } = await supabase
      .from("profiles")
      .select("id, full_name, department, country_code, primary_currency, start_date")
      .eq("org_id", profile.org_id)
      .eq("employment_type", "contractor")
      .eq("payroll_mode", "contractor_usd_no_withholding")
      .eq("status", "active")
      .is("deleted_at", null)
      .order("full_name", { ascending: true });

    if (eligibleProfilesError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_CALCULATION_FAILED",
          message: "Unable to load eligible payroll employees."
        },
        meta: buildMeta()
      });
    }

    const parsedProfiles = z.array(eligibleProfileRowSchema).safeParse(rawEligibleProfiles ?? []);

    if (!parsedProfiles.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_CALCULATION_FAILED",
          message: "Eligible employee data is invalid."
        },
        meta: buildMeta()
      });
    }

    const eligibleEmployeeIds = parsedProfiles.data.map((row) => row.id);

    const [
      { data: rawCompensationRows, error: compensationError },
      { data: rawAllowanceRows, error: allowanceError },
      { data: rawPaymentRows, error: paymentError },
      { data: rawExistingItemRows, error: existingItemsError }
    ] = eligibleEmployeeIds.length
      ? await Promise.all([
          supabase
            .from("compensation_records")
            .select(
              "id, employee_id, base_salary_amount, currency, effective_from, effective_to, updated_at"
            )
            .eq("org_id", profile.org_id)
            .is("deleted_at", null)
            .in("employee_id", eligibleEmployeeIds)
            .lte("effective_from", parsedRun.data.pay_period_end)
            .or(`effective_to.is.null,effective_to.gte.${parsedRun.data.pay_period_start}`)
            .order("effective_from", { ascending: false })
            .order("updated_at", { ascending: false }),
          supabase
            .from("allowances")
            .select(
              "id, employee_id, label, amount, currency, is_taxable, effective_from, effective_to"
            )
            .eq("org_id", profile.org_id)
            .is("deleted_at", null)
            .in("employee_id", eligibleEmployeeIds)
            .lte("effective_from", parsedRun.data.pay_period_end)
            .or(`effective_to.is.null,effective_to.gte.${parsedRun.data.pay_period_start}`)
            .order("effective_from", { ascending: false }),
          supabase
            .from("employee_payment_details")
            .select("id, employee_id")
            .eq("org_id", profile.org_id)
            .is("deleted_at", null)
            .eq("is_primary", true)
            .in("employee_id", eligibleEmployeeIds),
          supabase
            .from("payroll_items")
            .select("id, employee_id, adjustments")
            .eq("org_id", profile.org_id)
            .eq("payroll_run_id", runId)
            .is("deleted_at", null)
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null }
        ];

    if (compensationError || allowanceError || paymentError || existingItemsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_CALCULATION_FAILED",
          message:
            compensationError?.message ??
            allowanceError?.message ??
            paymentError?.message ??
            existingItemsError?.message ??
            "Unable to load payroll calculation inputs."
        },
        meta: buildMeta()
      });
    }

    const parsedCompensationRows = z.array(compensationRowSchema).safeParse(rawCompensationRows ?? []);
    const parsedAllowanceRows = z.array(allowanceRowSchema).safeParse(rawAllowanceRows ?? []);
    const parsedPaymentRows = z.array(paymentDetailsRowSchema).safeParse(rawPaymentRows ?? []);
    const parsedExistingItems = z.array(existingItemRowSchema).safeParse(rawExistingItemRows ?? []);

    if (
      !parsedCompensationRows.success ||
      !parsedAllowanceRows.success ||
      !parsedPaymentRows.success ||
      !parsedExistingItems.success
    ) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_CALCULATION_FAILED",
          message: "Payroll calculation inputs are not in the expected format."
        },
        meta: buildMeta()
      });
    }

    const compensationByEmployeeId = new Map<string, z.infer<typeof compensationRowSchema>>();

    for (const row of parsedCompensationRows.data) {
      const existing = compensationByEmployeeId.get(row.employee_id);

      if (!existing) {
        compensationByEmployeeId.set(row.employee_id, row);
        continue;
      }

      if (row.effective_from > existing.effective_from) {
        compensationByEmployeeId.set(row.employee_id, row);
        continue;
      }

      if (
        row.effective_from === existing.effective_from &&
        row.updated_at > existing.updated_at
      ) {
        compensationByEmployeeId.set(row.employee_id, row);
      }
    }

    const allowancesByEmployeeId = new Map<string, z.infer<typeof allowanceRowSchema>[]>();

    for (const row of parsedAllowanceRows.data) {
      const current = allowancesByEmployeeId.get(row.employee_id) ?? [];
      current.push(row);
      allowancesByEmployeeId.set(row.employee_id, current);
    }

    const employeeIdsWithPayment = new Set(
      parsedPaymentRows.data.map((row) => row.employee_id)
    );

    const existingAdjustmentsByEmployeeId = new Map<string, z.infer<typeof payrollAdjustmentSchema>[]>();
    const staleItemIds: string[] = [];

    for (const row of parsedExistingItems.data) {
      const parsedAdjustments = z.array(payrollAdjustmentSchema).safeParse(row.adjustments);
      existingAdjustmentsByEmployeeId.set(
        row.employee_id,
        parsedAdjustments.success ? parsedAdjustments.data : []
      );

      if (!eligibleEmployeeIds.includes(row.employee_id)) {
        staleItemIds.push(row.id);
      }
    }

    let totalGross: Record<string, number> = {};
    let totalNet: Record<string, number> = {};
    let totalDeductions: Record<string, number> = {};
    let totalEmployerContributions: Record<string, number> = {};
    let flaggedCount = 0;

    const nextItemRows = parsedProfiles.data.map((employee) => {
      const compensation = compensationByEmployeeId.get(employee.id) ?? null;
      const allowanceRows = allowancesByEmployeeId.get(employee.id) ?? [];
      const adjustments = existingAdjustmentsByEmployeeId.get(employee.id) ?? [];

      const normalizedAllowances = allowanceRows.map((allowance) => ({
        label: allowance.label,
        amount: parseAmount(allowance.amount),
        currency: normalizeCurrencyCode(allowance.currency),
        isTaxable: allowance.is_taxable
      }));

      const baseSalaryAmount = compensation ? parseAmount(compensation.base_salary_amount) : 0;
      const allowanceTotalAmount = normalizedAllowances.reduce(
        (sum, allowance) => sum + allowance.amount,
        0
      );
      const grossAmount = baseSalaryAmount + allowanceTotalAmount;
      const currency = normalizeCurrencyCode(
        compensation?.currency ?? employee.primary_currency ?? "USD"
      );
      const payCurrency = normalizeCurrencyCode(employee.primary_currency ?? "USD");

      const calculated = calculatePayrollItem({
        employee: {
          id: employee.id,
          payroll_mode: "contractor_usd_no_withholding",
          country_code: employee.country_code
        },
        monthly_gross_amount: grossAmount,
        monthly_base_salary_amount: baseSalaryAmount,
        currency,
        allowances: normalizedAllowances.map((allowance) => ({
          label: allowance.label,
          amount: allowance.amount,
          currency: allowance.currency,
          is_taxable: allowance.isTaxable
        }))
      });

      const mappedDeductions = calculated.deductions.map((row) => ({
        ruleType: row.rule_type,
        ruleName: row.rule_name,
        amount: row.amount,
        description: row.description
      }));

      const mappedEmployerContributions = calculated.employer_contributions.map((row) => ({
        ruleType: row.rule_type,
        ruleName: row.rule_name,
        amount: row.amount,
        description: row.description
      }));

      const adjustmentsTotal = adjustmentAmountTotal(adjustments);
      const netAmount = calculated.net_amount + adjustmentsTotal;

      const flagReasons: string[] = [];

      if (!employeeIdsWithPayment.has(employee.id)) {
        flagReasons.push("No payment details on file");
      }

      if (!compensation) {
        flagReasons.push("No compensation record");
      }

      if (
        employee.start_date &&
        employee.start_date >= parsedRun.data.pay_period_start &&
        employee.start_date <= parsedRun.data.pay_period_end
      ) {
        flagReasons.push("New hire in this pay period");
      }

      if (
        compensation &&
        compensation.effective_from >= parsedRun.data.pay_period_start &&
        compensation.effective_from <= parsedRun.data.pay_period_end
      ) {
        flagReasons.push("Salary changed this month");
      }

      const flagged = flagReasons.length > 0;

      if (flagged) {
        flaggedCount += 1;
      }

      totalGross = addCurrencyTotal(totalGross, payCurrency, grossAmount);
      totalNet = addCurrencyTotal(totalNet, payCurrency, netAmount);
      totalDeductions = addCurrencyTotal(
        totalDeductions,
        payCurrency,
        calculated.total_deductions
      );
      totalEmployerContributions = addCurrencyTotal(
        totalEmployerContributions,
        payCurrency,
        calculated.total_employer_contributions
      );

      return {
        payroll_run_id: runId,
        employee_id: employee.id,
        org_id: profile.org_id,
        gross_amount: grossAmount,
        currency,
        pay_currency: payCurrency,
        base_salary_amount: baseSalaryAmount,
        allowances: normalizedAllowances,
        adjustments,
        deductions: mappedDeductions,
        employer_contributions: mappedEmployerContributions,
        net_amount: netAmount,
        withholding_applied: calculated.withholding_applied,
        payment_status: "pending" as const,
        payment_reference: null,
        payment_id: null,
        notes: compensation ? null : "Compensation record missing.",
        flagged,
        flag_reason: flagReasons.length > 0 ? flagReasons.join("; ") : null,
        deleted_at: null
      };
    });

    if (nextItemRows.length > 0) {
      const { error: upsertError } = await supabase
        .from("payroll_items")
        .upsert(nextItemRows, { onConflict: "payroll_run_id,employee_id" });

      if (upsertError) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "PAYROLL_CALCULATION_FAILED",
            message: `Unable to write payroll items: ${upsertError.message}`
          },
          meta: buildMeta()
        });
      }
    }

    if (staleItemIds.length > 0) {
      const { error: staleError } = await supabase
        .from("payroll_items")
        .update({ deleted_at: new Date().toISOString() })
        .eq("org_id", profile.org_id)
        .eq("payroll_run_id", runId)
        .in("id", staleItemIds);

      if (staleError) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "PAYROLL_CALCULATION_FAILED",
            message: `Unable to archive stale payroll items: ${staleError.message}`
          },
          meta: buildMeta()
        });
      }
    }

    const previousSnapshot = toSnapshot(parsedRun.data.snapshot);
    const nextSnapshot = {
      ...previousSnapshot,
      lastCalculatedAt: new Date().toISOString(),
      lastCalculatedBy: profile.id,
      eligibleContractorCount: nextItemRows.length,
      flaggedCount,
      withholdingApplied: false
    };

    const { error: updateRunError } = await supabase
      .from("payroll_runs")
      .update({
        status: "calculated",
        total_gross: totalGross,
        total_net: totalNet,
        total_deductions: totalDeductions,
        total_employer_contributions: totalEmployerContributions,
        employee_count: nextItemRows.length,
        snapshot: nextSnapshot
      })
      .eq("id", runId)
      .eq("org_id", profile.org_id);

    if (updateRunError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_CALCULATION_FAILED",
          message: `Unable to update payroll run totals: ${updateRunError.message}`
        },
        meta: buildMeta()
      });
    }

    await logAudit({
      action: "updated",
      tableName: "payroll_runs",
      recordId: runId,
      oldValue: {
        status: parsedRun.data.status,
        totalGross: parseCurrencyTotals(parsedRun.data.total_gross),
        totalNet: parseCurrencyTotals(parsedRun.data.total_net),
        employeeCount: parsedRun.data.employee_count
      },
      newValue: {
        status: "calculated",
        totalGross,
        totalNet,
        totalDeductions,
        totalEmployerContributions,
        employeeCount: nextItemRows.length,
        flaggedCount
      }
    });

    const responseData: CalculatePayrollRunResponseData = {
      runId,
      status: "calculated",
      employeeCount: nextItemRows.length,
      flaggedCount,
      totalGross,
      totalNet,
      totalDeductions,
      totalEmployerContributions
    };

    return jsonResponse<CalculatePayrollRunResponseData>(200, {
      data: responseData,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYROLL_CALCULATION_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Unable to calculate payroll run."
      },
      meta: buildMeta()
    });
  }
}
