import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import {
  adjustmentTotal,
  calculatePayrollRunCurrencyTotals,
  calculatePayrollWorksheetMonthlyTotal,
  deductionTotal,
  derivePayrollRunStatusFromCycles
} from "../../../../../../lib/payroll/runs";
import {
  getPreviousMonthWindow,
  summarizeMonthlyOvertime
} from "../../../../../../lib/payroll/overtime";
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
  PAYROLL_CYCLE_SELECT_COLUMNS,
  PAYROLL_RUN_SELECT_COLUMNS,
  payrollAdjustmentSchema,
  payrollAllowanceSchema,
  payrollCycleRowSchema,
  payrollDeductionSchema,
  payrollItemPaymentStatusSchema,
  payrollRunRowSchema,
  toPayrollCycleSummary,
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
  overtime_amount: z.union([z.number(), z.string()]).optional().default(0),
  overtime_hours: z.union([z.number(), z.string()]).optional().default(0),
  net_amount: z.union([z.number(), z.string()]),
  withholding_applied: z.boolean(),
  payment_status: payrollItemPaymentStatusSchema,
  payment_reference: z.string().nullable(),
  payment_id: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  finance_notes: z.string().nullable().optional().default(null),
  correction_of: z.string().uuid().nullable().optional().default(null),
  correction_reason: z.string().nullable().optional().default(null),
  flagged: z.boolean(),
  flag_reason: z.string().nullable(),
  cycle_1_base_amount: z.union([z.number(), z.string()]).optional().default(0),
  cycle_2_base_amount: z.union([z.number(), z.string()]).optional().default(0),
  cycle_1_overtime_hours: z.union([z.number(), z.string()]).optional().default(0),
  cycle_2_overtime_hours: z.union([z.number(), z.string()]).optional().default(0),
  cycle_1_overtime_amount: z.union([z.number(), z.string()]).optional().default(0),
  cycle_2_overtime_amount: z.union([z.number(), z.string()]).optional().default(0),
  cycle_1_included: z.boolean().optional().default(true),
  cycle_2_included: z.boolean().optional().default(true),
  fees: z.union([z.number(), z.string()]).optional().default(0),
  bonus: z.union([z.number(), z.string()]).optional().default(0),
  comment: z.string().nullable().optional().default(null),
  exception_reason: z.string().nullable().optional().default(null),
  designation: z.string().nullable().optional().default(null),
  accrue_username: z.string().nullable().optional().default(null),
  created_at: z.string(),
  updated_at: z.string()
});

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  department: z.string().nullable(),
  country_code: z.string().nullable()
});

const eligiblePayrollProfileRowSchema = z.object({
  id: z.string().uuid()
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

const overtimeEntryRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  hours: z.union([z.number(), z.string()]),
  amount: z.union([z.number(), z.string()]),
  currency: z.string().length(3),
  status: z.enum(["pending", "approved", "rejected"]),
  payroll_item_id: z.string().uuid().nullable()
});

const linkedPayrollItemRowSchema = z.object({
  id: z.string().uuid(),
  payroll_run_id: z.string().uuid()
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
        PAYROLL_RUN_SELECT_COLUMNS
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
          message: `Unable to load payroll run: ${runError.message}`
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

    // Collect unique user IDs for initiator + approvers to resolve names in one query
    const userIdsToResolve = new Set<string>();
    if (parsedRun.data.initiated_by) userIdsToResolve.add(parsedRun.data.initiated_by);
    if (parsedRun.data.first_approved_by) userIdsToResolve.add(parsedRun.data.first_approved_by);
    if (parsedRun.data.final_approved_by) userIdsToResolve.add(parsedRun.data.final_approved_by);

    const previousMonthWindow = getPreviousMonthWindow(parsedRun.data.pay_period_start);

    const [
      { data: rawItems, error: itemsError },
      { data: rawActorProfiles, error: actorError },
      { data: rawCycles, error: cyclesError },
      { data: rawEligiblePayrollProfiles, error: eligiblePayrollProfilesError }
    ] =
      await Promise.all([
        supabase
          .from("payroll_items")
          .select(
            "id, payroll_run_id, employee_id, org_id, gross_amount, currency, pay_currency, base_salary_amount, allowances, adjustments, deductions, employer_contributions, overtime_amount, overtime_hours, net_amount, withholding_applied, payment_status, payment_reference, payment_id, notes, finance_notes, correction_of, correction_reason, flagged, flag_reason, cycle_1_base_amount, cycle_2_base_amount, cycle_1_overtime_hours, cycle_2_overtime_hours, cycle_1_overtime_amount, cycle_2_overtime_amount, cycle_1_included, cycle_2_included, fees, bonus, comment, exception_reason, designation, accrue_username, created_at, updated_at"
          )
          .eq("org_id", session.profile.org_id)
          .eq("payroll_run_id", runId)
          .is("deleted_at", null)
          .order("created_at", { ascending: true }),
        userIdsToResolve.size > 0
          ? supabase
              .from("profiles")
              .select("id, full_name")
              .eq("org_id", session.profile.org_id)
              .in("id", [...userIdsToResolve])
          : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }>, error: null }),
        supabase
          .from("payroll_cycles")
          .select(PAYROLL_CYCLE_SELECT_COLUMNS)
          .eq("org_id", session.profile.org_id)
          .eq("payroll_run_id", runId)
          .is("deleted_at", null)
          .order("created_at", { ascending: true }),
        supabase
          .from("profiles")
          .select("id")
          .eq("org_id", session.profile.org_id)
          .in("payroll_mode", [
            "contractor_usd_no_withholding",
            "employee_local_withholding"
          ])
          .eq("status", "active")
          .is("deleted_at", null)
      ]);

    const actorNameById = new Map(
      (rawActorProfiles ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name])
    );

    if (itemsError || actorError || cyclesError || eligiblePayrollProfilesError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_RUN_FETCH_FAILED",
          message:
            itemsError?.message ??
            actorError?.message ??
            eligiblePayrollProfilesError?.message ??
            "Unable to load payroll run item data."
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

    const parsedEligiblePayrollProfiles = z
      .array(eligiblePayrollProfileRowSchema)
      .safeParse(rawEligiblePayrollProfiles ?? []);

    if (!parsedEligiblePayrollProfiles.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_RUN_PARSE_FAILED",
          message: "Eligible payroll employee metadata is invalid."
        },
        meta: buildMeta()
      });
    }

    const eligiblePayrollEmployeeIds = parsedEligiblePayrollProfiles.data.map((row) => row.id);
    const { data: rawOvertimeEntries, error: overtimeEntriesError } =
      eligiblePayrollEmployeeIds.length > 0
        ? await supabase
            .from("overtime_entries")
            .select("id, employee_id, hours, amount, currency, status, payroll_item_id")
            .eq("org_id", session.profile.org_id)
            .in("employee_id", eligiblePayrollEmployeeIds)
            .gte("entry_date", previousMonthWindow.periodStart)
            .lte("entry_date", previousMonthWindow.periodEnd)
            .is("deleted_at", null)
        : { data: [], error: null };

    if (overtimeEntriesError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_RUN_FETCH_FAILED",
          message: `Unable to load previous-month overtime entries: ${overtimeEntriesError.message}`
        },
        meta: buildMeta()
      });
    }

    const parsedOvertimeEntries = z.array(overtimeEntryRowSchema).safeParse(rawOvertimeEntries ?? []);

    if (!parsedOvertimeEntries.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_RUN_PARSE_FAILED",
          message: "Previous-month overtime entries are invalid."
        },
        meta: buildMeta()
      });
    }

    const linkedPayrollItemIds = [
      ...new Set(
        parsedOvertimeEntries.data
          .map((entry) => entry.payroll_item_id)
          .filter((value): value is string => typeof value === "string")
      )
    ];
    const { data: rawLinkedPayrollItems, error: linkedPayrollItemsError } =
      linkedPayrollItemIds.length > 0
        ? await supabase
            .from("payroll_items")
            .select("id, payroll_run_id")
            .eq("org_id", session.profile.org_id)
            .in("id", linkedPayrollItemIds)
        : { data: [], error: null };

    if (linkedPayrollItemsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_RUN_FETCH_FAILED",
          message: `Unable to load overtime payroll links: ${linkedPayrollItemsError.message}`
        },
        meta: buildMeta()
      });
    }

    const parsedLinkedPayrollItems = z
      .array(linkedPayrollItemRowSchema)
      .safeParse(rawLinkedPayrollItems ?? []);

    if (!parsedLinkedPayrollItems.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_RUN_PARSE_FAILED",
          message: "Overtime payroll links are invalid."
        },
        meta: buildMeta()
      });
    }

    const linkedRunIdByPayrollItemId = new Map(
      parsedLinkedPayrollItems.data.map((row) => [row.id, row.payroll_run_id])
    );
    const overtimeSummary = summarizeMonthlyOvertime({
      entries: parsedOvertimeEntries.data.map((entry) => ({
        id: entry.id,
        employeeId: entry.employee_id,
        hours: Number(entry.hours),
        amount: parseAmount(entry.amount),
        currency: entry.currency,
        status: entry.status,
        payrollItemId: entry.payroll_item_id
      })),
      currentRunId: runId,
      linkedRunIdByPayrollItemId,
      sourceMonth: previousMonthWindow.sourceMonth,
      periodStart: previousMonthWindow.periodStart,
      periodEnd: previousMonthWindow.periodEnd
    });

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
            message: `Unable to load employee metadata for payroll items: ${profileError.message}`
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
      const cycle1BaseAmount = parseAmount(row.cycle_1_base_amount ?? 0);
      const cycle2BaseAmount = parseAmount(row.cycle_2_base_amount ?? 0);
      const cycle1OvertimeAmount = parseAmount(row.cycle_1_overtime_amount ?? 0);
      const cycle2OvertimeAmount = parseAmount(row.cycle_2_overtime_amount ?? 0);
      const fees = parseAmount(row.fees ?? 0);
      const bonus = parseAmount(row.bonus ?? 0);
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
        overtimeAmount: parseAmount(row.overtime_amount ?? 0),
        overtimeHours: Number(row.overtime_hours ?? 0),
        netAmount,
        withholdingApplied: row.withholding_applied,
        paymentStatus: row.payment_status,
        paymentReference: row.payment_reference,
        paymentId: row.payment_id,
        notes: row.notes,
        financeNotes: row.finance_notes ?? null,
        correctionOf: row.correction_of ?? null,
        correctionReason: row.correction_reason ?? null,
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
        cycle1BaseAmount,
        cycle2BaseAmount,
        cycle1OvertimeHours: Number(row.cycle_1_overtime_hours ?? 0),
        cycle2OvertimeHours: Number(row.cycle_2_overtime_hours ?? 0),
        cycle1OvertimeAmount,
        cycle2OvertimeAmount,
        cycle1Included: row.cycle_1_included ?? true,
        cycle2Included: row.cycle_2_included ?? true,
        fees,
        bonus,
        comment: row.comment ?? null,
        exceptionReason: row.exception_reason ?? null,
        designation: row.designation ?? null,
        accrueUsername: row.accrue_username ?? null,
        monthlyTotal: calculatePayrollWorksheetMonthlyTotal({
          cycle1BaseAmount,
          cycle2BaseAmount,
          cycle1OvertimeAmount,
          cycle2OvertimeAmount,
          bonus,
          fees
        }),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    });

    const parsedCycles = z.array(payrollCycleRowSchema).safeParse(rawCycles ?? []);
    const cycles = parsedCycles.success
      ? parsedCycles.data.map(toPayrollCycleSummary)
      : [];
    const currentRunTotals = calculatePayrollRunCurrencyTotals(
      items.map((item) => ({
        grossAmount: item.grossAmount,
        netAmount: item.netAmount,
        // Sum the actual deduction line items rather than deriving from
        // gross - net (which would mislabel adjustments as deductions).
        deductionsAmount: item.deductions.reduce(
          (sum, deduction) => sum + Math.trunc(deduction.amount),
          0
        ),
        payCurrency: item.payCurrency
      }))
    );
    const runSummary = {
      ...toPayrollRunSummary(
        parsedRun.data,
        parsedRun.data.initiated_by ? actorNameById.get(parsedRun.data.initiated_by) ?? null : null,
        {
          firstApprovedByName: parsedRun.data.first_approved_by
            ? actorNameById.get(parsedRun.data.first_approved_by) ?? null
            : null,
          finalApprovedByName: parsedRun.data.final_approved_by
            ? actorNameById.get(parsedRun.data.final_approved_by) ?? null
            : null
        }
      ),
      ...(items.length > 0
        ? {
            totalGross: currentRunTotals.totalGross,
            totalNet: currentRunTotals.totalNet,
            totalDeductions: currentRunTotals.totalDeductions
          }
        : {}),
      status: derivePayrollRunStatusFromCycles(
        cycles.map((cycle) => cycle.status),
        parsedRun.data.status
      )
    };

    const responseData: PayrollRunDetailResponseData = {
      run: runSummary,
      items,
      cycles,
      flaggedCount: items.filter((item) => item.flagged).length,
      overtimeSummary
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
