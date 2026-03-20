import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { logAudit } from "../../../../../lib/audit";
import {
  currentMonthPeriod,
  derivePayrollRunStatusFromCycles,
  semiMonthlyCycleDates
} from "../../../../../lib/payroll/runs";
import { persistPayrollRunCalculation } from "../../../../../lib/payroll/persist-payroll-run-calculation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type {
  CalculatePayrollRunResponseData,
  CreatePayrollRunResponseData,
  PayrollRunsDashboardResponseData
} from "../../../../../types/payroll-runs";
import { PAYROLL_CYCLE_STATUSES } from "../../../../../types/payroll-runs";
import {
  buildMeta,
  canManagePayroll,
  canViewPayroll,
  jsonResponse,
  PAYROLL_RUN_SELECT_COLUMNS,
  payrollRunRowSchema,
  toPayrollRunSummary
} from "../_helpers";

const dateStringRegex = /^\d{4}-\d{2}-\d{2}$/;

const createRunBodySchema = z.object({
  payPeriodStart: z.string().regex(dateStringRegex).optional(),
  payPeriodEnd: z.string().regex(dateStringRegex).optional(),
  payDate: z.string().regex(dateStringRegex).optional(),
  notes: z.string().trim().max(500).optional().nullable()
});

function isValidIsoDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function ensureDateValues(
  payPeriodStart: string,
  payPeriodEnd: string,
  payDate: string
): string | null {
  if (!isValidIsoDate(payPeriodStart)) {
    return "Pay period start must be a valid date.";
  }

  if (!isValidIsoDate(payPeriodEnd)) {
    return "Pay period end must be a valid date.";
  }

  if (!isValidIsoDate(payDate)) {
    return "Pay date must be a valid date.";
  }

  if (payPeriodEnd < payPeriodStart) {
    return "Pay period end cannot be before pay period start.";
  }

  return null;
}

async function countEligibleEmployees({
  supabase,
  orgId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
}): Promise<number> {
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .in("payroll_mode", [
      "contractor_usd_no_withholding",
      "employee_local_withholding"
    ])
    .eq("status", "active")
    .is("deleted_at", null);

  if (error) {
    throw new Error(`Unable to count eligible employees: ${error.message}`);
  }

  return count ?? 0;
}

const dashboardCyclePreviewSchema = z.object({
  payroll_run_id: z.string().uuid(),
  cycle_number: z.number().int().nullable().optional().default(null),
  status: z.enum(PAYROLL_CYCLE_STATUSES),
  target_pay_date: z.string().nullable()
});

export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view payroll runs."
      },
      meta: buildMeta()
    });
  }

  if (!canViewPayroll(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to view payroll runs."
      },
      meta: buildMeta()
    });
  }

  try {
    const supabase = await createSupabaseServerClient();

    const [{ data: rawRuns, error: runsError }, eligibleEmployeeCount] = await Promise.all([
      supabase
        .from("payroll_runs")
        .select(
          PAYROLL_RUN_SELECT_COLUMNS
        )
        .eq("org_id", session.profile.org_id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(50),
      countEligibleEmployees({ supabase, orgId: session.profile.org_id })
    ]);

    if (runsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_RUNS_FETCH_FAILED",
          message: `Unable to load payroll runs: ${runsError.message}`
        },
        meta: buildMeta()
      });
    }

    const parsedRuns = z.array(payrollRunRowSchema).safeParse(rawRuns ?? []);

    if (!parsedRuns.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_RUNS_PARSE_FAILED",
          message: "Payroll runs are not in the expected format."
        },
        meta: buildMeta()
      });
    }

    const actorIds = [
      ...new Set(
        parsedRuns.data
          .flatMap((row) => [row.initiated_by, row.first_approved_by, row.final_approved_by])
          .filter((value): value is string => typeof value === "string")
      )
    ];
    const actorNameById = new Map<string, string>();

    if (actorIds.length > 0) {
      const { data: rawActors, error: actorError } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("org_id", session.profile.org_id)
        .in("id", actorIds);

      if (actorError) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "PAYROLL_RUNS_FETCH_FAILED",
            message: "Unable to load payroll run initiators."
          },
          meta: buildMeta()
        });
      }

      for (const row of rawActors ?? []) {
        if (typeof row.id === "string" && typeof row.full_name === "string") {
          actorNameById.set(row.id, row.full_name);
        }
      }
    }

    const runs = parsedRuns.data.map((row) =>
      toPayrollRunSummary(
        row,
        row.initiated_by ? actorNameById.get(row.initiated_by) ?? "Unknown user" : null,
        {
          firstApprovedByName: row.first_approved_by ? actorNameById.get(row.first_approved_by) ?? null : null,
          finalApprovedByName: row.final_approved_by ? actorNameById.get(row.final_approved_by) ?? null : null
        }
      )
    );

    const cyclePreviewByRunId = new Map<
      string,
      { cycle1Status: (typeof PAYROLL_CYCLE_STATUSES)[number] | null; cycle2Status: (typeof PAYROLL_CYCLE_STATUSES)[number] | null }
    >();

    const runIds = runs.map((run) => run.id);

    if (runIds.length > 0) {
      const { data: rawCyclePreviews, error: cyclePreviewError } = await supabase
        .from("payroll_cycles")
        .select("payroll_run_id, cycle_number, status, target_pay_date")
        .eq("org_id", session.profile.org_id)
        .in("payroll_run_id", runIds)
        .in("cycle_number", [1, 2]);

      if (cyclePreviewError) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "PAYROLL_RUNS_FETCH_FAILED",
            message: "Unable to load payroll cycle previews."
          },
          meta: buildMeta()
        });
      }

      const parsedCyclePreviews = z
        .array(dashboardCyclePreviewSchema)
        .safeParse(rawCyclePreviews ?? []);

      if (!parsedCyclePreviews.success) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "PAYROLL_RUNS_PARSE_FAILED",
            message: "Payroll cycle previews are not in the expected format."
          },
          meta: buildMeta()
        });
      }

      for (const cycle of parsedCyclePreviews.data) {
        const current = cyclePreviewByRunId.get(cycle.payroll_run_id) ?? {
          cycle1Status: null,
          cycle2Status: null
        };

        if (cycle.cycle_number === 1) {
          current.cycle1Status = cycle.status;
        }

        if (cycle.cycle_number === 2) {
          current.cycle2Status = cycle.status;
        }

        cyclePreviewByRunId.set(cycle.payroll_run_id, current);
      }
    }

    const runsWithCyclePreview = runs.map((run) => {
      const cyclePreview = cyclePreviewByRunId.get(run.id);
      return {
        ...run,
        status: derivePayrollRunStatusFromCycles(
          [cyclePreview?.cycle1Status, cyclePreview?.cycle2Status].filter(
            (value): value is (typeof PAYROLL_CYCLE_STATUSES)[number] => Boolean(value)
          ),
          run.status
        ),
        cycle1Status: cyclePreview?.cycle1Status ?? null,
        cycle2Status: cyclePreview?.cycle2Status ?? null
      };
    });

    const latestRun = runsWithCyclePreview[0] ?? null;
    const today = new Date().toISOString().slice(0, 10);

    const nextPayDate =
      runsWithCyclePreview
        .filter((run) => run.status !== "cancelled" && run.status !== "completed")
        .flatMap((run) => {
          const cycleDates: string[] = [];
          if (run.cycle1Date && !["paid", "cancelled", "failed"].includes(run.cycle1Status ?? "")) {
            cycleDates.push(run.cycle1Date);
          }
          if (run.cycle2Date && !["paid", "cancelled", "failed"].includes(run.cycle2Status ?? "")) {
            cycleDates.push(run.cycle2Date);
          }
          return cycleDates;
        })
        .filter((value) => value >= today)
        .sort()[0] ?? null;

    const responseData: PayrollRunsDashboardResponseData = {
      metrics: {
        latestStatus: latestRun?.status ?? null,
        latestTotalCostAmount: 0,
        latestTotalCostTotals: latestRun?.totalNet ?? {},
        latestEmployeeCount: latestRun?.employeeCount ?? 0,
        nextPayDate,
        eligibleEmployeeCount
      },
      runs: runsWithCyclePreview
    };

    return jsonResponse<PayrollRunsDashboardResponseData>(200, {
      data: responseData,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYROLL_RUNS_FETCH_FAILED",
        message: error instanceof Error ? error.message : "Unable to load payroll runs."
      },
      meta: buildMeta()
    });
  }
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to create payroll runs."
      },
      meta: buildMeta()
    });
  }

  if (!canManagePayroll(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Finance Admin and Super Admin can create payroll runs."
      },
      meta: buildMeta()
    });
  }

  let body: unknown = {};

  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsedBody = createRunBodySchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid payroll run payload."
      },
      meta: buildMeta()
    });
  }

  const defaults = currentMonthPeriod();
  const payPeriodStart = parsedBody.data.payPeriodStart ?? defaults.payPeriodStart;
  const payPeriodEnd = parsedBody.data.payPeriodEnd ?? defaults.payPeriodEnd;
  const payDate = parsedBody.data.payDate ?? defaults.payDate;
  const dateError = ensureDateValues(payPeriodStart, payPeriodEnd, payDate);

  if (dateError) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: dateError
      },
      meta: buildMeta()
    });
  }

  try {
    const supabase = await createSupabaseServerClient();

    // Compute semimonthly cycle dates from the pay period
    const periodStartDate = new Date(`${payPeriodStart}T00:00:00Z`);
    const periodYear = periodStartDate.getUTCFullYear();
    const periodMonth = periodStartDate.getUTCMonth() + 1; // 1-based
    const { cycle1Date, cycle2Date } = semiMonthlyCycleDates(periodYear, periodMonth);
    const runMonth = `${periodYear}-${String(periodMonth).padStart(2, "0")}`;

    const { data: insertedRun, error: insertError } = await supabase
      .from("payroll_runs")
      .insert({
        org_id: session.profile.org_id,
        pay_period_start: payPeriodStart,
        pay_period_end: payPeriodEnd,
        pay_date: payDate,
        status: "draft",
        initiated_by: session.profile.id,
        run_month: runMonth,
        cycle_1_date: cycle1Date,
        cycle_2_date: cycle2Date,
        total_gross: { USD: 0 },
        total_net: { USD: 0 },
        total_deductions: { USD: 0 },
        total_employer_contributions: { USD: 0 },
        employee_count: 0,
        snapshot: {
          createdBy: session.profile.id,
          createdAt: new Date().toISOString(),
          withholdingModel: "contractor-first"
        },
        notes: parsedBody.data.notes ?? null
      })
      .select(
        PAYROLL_RUN_SELECT_COLUMNS
      )
      .single();

    if (insertError || !insertedRun) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_RUN_CREATE_FAILED",
          message: "Unable to create payroll run."
        },
        meta: buildMeta()
      });
    }

    const parsedRun = payrollRunRowSchema.safeParse(insertedRun);

    if (!parsedRun.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_RUN_PARSE_FAILED",
          message: "Created payroll run is not in the expected format."
        },
        meta: buildMeta()
      });
    }

    // Auto-create exactly two semimonthly cycles: Cycle 1 (first Friday) and Cycle 2 (third Friday)
    const monthLabel = periodStartDate.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    const cycleInserts = [
      {
        payroll_run_id: parsedRun.data.id,
        org_id: session.profile.org_id,
        label: `Cycle 1 - ${monthLabel}`,
        cycle_number: 1,
        currency: "USD",
        status: "draft",
        target_pay_date: cycle1Date,
        prepared_by: session.profile.id,
        prepared_at: new Date().toISOString(),
        total_gross: 0,
        total_net: 0,
        total_deductions: 0,
        employee_count: 0
      },
      {
        payroll_run_id: parsedRun.data.id,
        org_id: session.profile.org_id,
        label: `Cycle 2 - ${monthLabel}`,
        cycle_number: 2,
        currency: "USD",
        status: "draft",
        target_pay_date: cycle2Date,
        prepared_by: session.profile.id,
        prepared_at: new Date().toISOString(),
        total_gross: 0,
        total_net: 0,
        total_deductions: 0,
        employee_count: 0
      }
    ];

    const { error: cycleInsertError } = await supabase
      .from("payroll_cycles")
      .insert(cycleInserts);

    if (cycleInsertError) {
      // Fatal: semimonthly cycles are mandatory. Roll back the run.
      await supabase
        .from("payroll_runs")
        .delete()
        .eq("id", parsedRun.data.id)
        .eq("org_id", session.profile.org_id);

      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "CYCLE_CREATION_FAILED",
          message: "Unable to create semimonthly cycles. The payroll run was not created."
        },
        meta: buildMeta()
      });
    }

    let calculationResult: CalculatePayrollRunResponseData;

    try {
      calculationResult = await persistPayrollRunCalculation({
        supabase,
        actor: {
          id: session.profile.id,
          orgId: session.profile.org_id
        },
        run: parsedRun.data
      });
    } catch (calculationError) {
      await supabase
        .from("payroll_cycles")
        .delete()
        .eq("payroll_run_id", parsedRun.data.id)
        .eq("org_id", session.profile.org_id);

      await supabase
        .from("payroll_runs")
        .delete()
        .eq("org_id", session.profile.org_id)
        .eq("id", parsedRun.data.id);

      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_RUN_CREATE_FAILED",
          message:
            calculationError instanceof Error
              ? calculationError.message
              : "Unable to create and prefill payroll run."
        },
        meta: buildMeta()
      });
    }

    const eligibleEmployeeCount = await countEligibleEmployees({
      supabase,
      orgId: session.profile.org_id
    });

    const runSummary = toPayrollRunSummary(
      {
        ...parsedRun.data,
        status: calculationResult.status,
        total_gross: calculationResult.totalGross,
        total_net: calculationResult.totalNet,
        total_deductions: calculationResult.totalDeductions,
        total_employer_contributions: calculationResult.totalEmployerContributions,
        employee_count: calculationResult.employeeCount
      },
      session.profile.full_name
    );

    await logAudit({
      action: "created",
      tableName: "payroll_runs",
      recordId: runSummary.id,
      newValue: {
        payPeriodStart: runSummary.payPeriodStart,
        payPeriodEnd: runSummary.payPeriodEnd,
        payDate: runSummary.payDate,
        cycle1Date,
        cycle2Date,
        status: runSummary.status,
        employeeCount: runSummary.employeeCount
      }
    });

    const responseData: CreatePayrollRunResponseData = {
      run: runSummary,
      eligibleEmployeeCount
    };

    return jsonResponse<CreatePayrollRunResponseData>(201, {
      data: responseData,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYROLL_RUN_CREATE_FAILED",
        message: error instanceof Error ? error.message : "Unable to create payroll run."
      },
      meta: buildMeta()
    });
  }
}
