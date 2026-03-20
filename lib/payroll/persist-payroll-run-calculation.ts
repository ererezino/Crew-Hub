import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { logAudit } from "../audit";
import { calculatePayrollItem } from "./calculate-payroll-item";
import {
  addCurrencyTotal,
  normalizeCurrencyCode,
  parseCurrencyTotals
} from "./runs";
import type {
  CalculatePayrollRunResponseData,
  PayrollRunStatus
} from "../../types/payroll-runs";

const eligibleProfileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  department: z.string().nullable(),
  country_code: z.string().nullable(),
  primary_currency: z.string().nullable(),
  start_date: z.string().nullable(),
  payroll_mode: z.union([
    z.literal("contractor_usd_no_withholding"),
    z.literal("employee_local_withholding"),
    z.literal("employee_usd_withholding")
  ])
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

const payrollAdjustmentSchema = z.object({
  id: z.string(),
  type: z.enum(["bonus", "deduction", "correction"]),
  label: z.string(),
  amount: z.number().int(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid().nullable()
});

const existingItemRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  adjustments: z.unknown()
});

type PersistPayrollRunCalculationInput = {
  supabase: SupabaseClient;
  actor: {
    id: string;
    orgId: string;
  };
  run: {
    id: string;
    pay_period_start: string;
    pay_period_end: string;
    status: PayrollRunStatus;
    total_gross: unknown;
    total_net: unknown;
    employee_count: number;
    snapshot: unknown;
  };
};

function parseAmount(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function adjustmentAmountTotal(adjustments: ReadonlyArray<{ amount: number }>): number {
  return adjustments.reduce((sum, row) => sum + Math.trunc(row.amount), 0);
}

function toSnapshot(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export async function persistPayrollRunCalculation({
  supabase,
  actor,
  run
}: PersistPayrollRunCalculationInput): Promise<CalculatePayrollRunResponseData> {
  const { data: rawEligibleProfiles, error: eligibleProfilesError } = await supabase
    .from("profiles")
    .select("id, full_name, department, country_code, primary_currency, start_date, payroll_mode")
    .eq("org_id", actor.orgId)
    .in("payroll_mode", [
      "contractor_usd_no_withholding",
      "employee_local_withholding"
    ])
    .eq("status", "active")
    .is("deleted_at", null)
    .order("full_name", { ascending: true });

  if (eligibleProfilesError) {
    throw new Error("Unable to load eligible payroll employees.");
  }

  const parsedProfiles = z.array(eligibleProfileRowSchema).safeParse(rawEligibleProfiles ?? []);

  if (!parsedProfiles.success) {
    throw new Error("Eligible employee data is invalid.");
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
          .eq("org_id", actor.orgId)
          .is("deleted_at", null)
          .in("employee_id", eligibleEmployeeIds)
          .lte("effective_from", run.pay_period_end)
          .or(`effective_to.is.null,effective_to.gte.${run.pay_period_start}`)
          .order("effective_from", { ascending: false })
          .order("updated_at", { ascending: false }),
        supabase
          .from("allowances")
          .select(
            "id, employee_id, label, amount, currency, is_taxable, effective_from, effective_to"
          )
          .eq("org_id", actor.orgId)
          .is("deleted_at", null)
          .in("employee_id", eligibleEmployeeIds)
          .lte("effective_from", run.pay_period_end)
          .or(`effective_to.is.null,effective_to.gte.${run.pay_period_start}`)
          .order("effective_from", { ascending: false }),
        supabase
          .from("employee_payment_details")
          .select("id, employee_id")
          .eq("org_id", actor.orgId)
          .is("deleted_at", null)
          .eq("is_primary", true)
          .in("employee_id", eligibleEmployeeIds),
        supabase
          .from("payroll_items")
          .select("id, employee_id, adjustments")
          .eq("org_id", actor.orgId)
          .eq("payroll_run_id", run.id)
          .is("deleted_at", null)
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null }
      ];

  if (compensationError || allowanceError || paymentError || existingItemsError) {
    throw new Error(
      compensationError?.message ??
        allowanceError?.message ??
        paymentError?.message ??
        existingItemsError?.message ??
        "Unable to load payroll calculation inputs."
    );
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
    throw new Error("Payroll calculation inputs are not in the expected format.");
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

    if (row.effective_from === existing.effective_from && row.updated_at > existing.updated_at) {
      compensationByEmployeeId.set(row.employee_id, row);
    }
  }

  const allowancesByEmployeeId = new Map<string, z.infer<typeof allowanceRowSchema>[]>();

  for (const row of parsedAllowanceRows.data) {
    const current = allowancesByEmployeeId.get(row.employee_id) ?? [];
    current.push(row);
    allowancesByEmployeeId.set(row.employee_id, current);
  }

  const employeeIdsWithPayment = new Set(parsedPaymentRows.data.map((row) => row.employee_id));
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

  const nextItemRows = await Promise.all(
    parsedProfiles.data.map(async (employee) => {
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

      let calculated: Awaited<ReturnType<typeof calculatePayrollItem>>;
      let calcError: string | null = null;

      try {
        calculated = await calculatePayrollItem({
          employee: {
            id: employee.id,
            org_id: actor.orgId,
            payroll_mode: employee.payroll_mode,
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
          })),
          effective_date: run.pay_period_end
        });
      } catch (error) {
        calcError = error instanceof Error ? error.message : String(error);
        calculated = {
          gross_amount: grossAmount,
          deductions: [],
          employer_contributions: [],
          total_deductions: 0,
          total_employer_contributions: 0,
          net_amount: grossAmount,
          withholding_applied: true,
          withholding_note: calcError
        };
      }

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

      if (calcError) {
        flagReasons.push(`Calculation error: ${calcError}`);
      }

      if (
        employee.start_date &&
        employee.start_date >= run.pay_period_start &&
        employee.start_date <= run.pay_period_end
      ) {
        flagReasons.push("New hire in this pay period");
      }

      if (
        compensation &&
        compensation.effective_from >= run.pay_period_start &&
        compensation.effective_from <= run.pay_period_end
      ) {
        flagReasons.push("Salary changed this month");
      }

      return {
        payroll_run_id: run.id,
        employee_id: employee.id,
        org_id: actor.orgId,
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
        flagged: flagReasons.length > 0,
        flag_reason: flagReasons.length > 0 ? flagReasons.join("; ") : null,
        deleted_at: null
      };
    })
  );

  const flaggedCount = nextItemRows.filter((row) => row.flagged).length;

  for (const row of nextItemRows) {
    totalGross = addCurrencyTotal(totalGross, row.pay_currency, row.gross_amount);
    totalNet = addCurrencyTotal(totalNet, row.pay_currency, row.net_amount);
    totalDeductions = addCurrencyTotal(
      totalDeductions,
      row.pay_currency,
      row.deductions.reduce((sum, deduction) => sum + deduction.amount, 0)
    );
    totalEmployerContributions = addCurrencyTotal(
      totalEmployerContributions,
      row.pay_currency,
      row.employer_contributions.reduce((sum, contribution) => sum + contribution.amount, 0)
    );
  }

  if (nextItemRows.length > 0) {
    const { error: upsertError } = await supabase
      .from("payroll_items")
      .upsert(nextItemRows, { onConflict: "payroll_run_id,employee_id" });

    if (upsertError) {
      throw new Error(`Unable to write payroll items: ${upsertError.message}`);
    }
  }

  if (staleItemIds.length > 0) {
    const { error: staleError } = await supabase
      .from("payroll_items")
      .update({ deleted_at: new Date().toISOString() })
      .eq("org_id", actor.orgId)
      .eq("payroll_run_id", run.id)
      .in("id", staleItemIds);

    if (staleError) {
      throw new Error(`Unable to archive stale payroll items: ${staleError.message}`);
    }
  }

  const nextSnapshot = {
    ...toSnapshot(run.snapshot),
    lastCalculatedAt: new Date().toISOString(),
    lastCalculatedBy: actor.id,
    eligiblePayrollCount: nextItemRows.length,
    flaggedCount,
    withholdingApplied: nextItemRows.some((row) => row.withholding_applied)
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
    .eq("id", run.id)
    .eq("org_id", actor.orgId);

  if (updateRunError) {
    throw new Error(`Unable to update payroll run totals: ${updateRunError.message}`);
  }

  await logAudit({
    action: "updated",
    tableName: "payroll_runs",
    recordId: run.id,
    oldValue: {
      status: run.status,
      totalGross: parseCurrencyTotals(run.total_gross),
      totalNet: parseCurrencyTotals(run.total_net),
      employeeCount: run.employee_count
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

  return {
    runId: run.id,
    status: "calculated",
    employeeCount: nextItemRows.length,
    flaggedCount,
    totalGross,
    totalNet,
    totalDeductions,
    totalEmployerContributions
  };
}
