import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { logAudit } from "../../../../../lib/audit";
import { currentMonthPeriod, getCurrencyTotal } from "../../../../../lib/payroll/runs";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type {
  CreatePayrollRunResponseData,
  PayrollRunsDashboardResponseData
} from "../../../../../types/payroll-runs";
import {
  buildMeta,
  canManagePayroll,
  canViewPayroll,
  jsonResponse,
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

async function countActiveContractors({
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
    .eq("employment_type", "contractor")
    .eq("payroll_mode", "contractor_usd_no_withholding")
    .eq("status", "active")
    .is("deleted_at", null);

  if (error) {
    throw new Error(`Unable to count active contractors: ${error.message}`);
  }

  return count ?? 0;
}

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

    const [{ data: rawRuns, error: runsError }, activeContractorCount] = await Promise.all([
      supabase
        .from("payroll_runs")
        .select(
          "id, org_id, pay_period_start, pay_period_end, pay_date, status, initiated_by, first_approved_by, first_approved_at, final_approved_by, final_approved_at, total_gross, total_net, total_deductions, total_employer_contributions, employee_count, snapshot, notes, created_at, updated_at"
        )
        .eq("org_id", session.profile.org_id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(50),
      countActiveContractors({ supabase, orgId: session.profile.org_id })
    ]);

    if (runsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_RUNS_FETCH_FAILED",
          message: "Unable to load payroll runs."
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

    const initiatedByIds = [
      ...new Set(
        parsedRuns.data
          .map((row) => row.initiated_by)
          .filter((value): value is string => typeof value === "string")
      )
    ];
    const initiatedByNameById = new Map<string, string>();

    if (initiatedByIds.length > 0) {
      const { data: rawInitiators, error: initiatorError } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("org_id", session.profile.org_id)
        .in("id", initiatedByIds);

      if (initiatorError) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "PAYROLL_RUNS_FETCH_FAILED",
            message: "Unable to load payroll run initiators."
          },
          meta: buildMeta()
        });
      }

      for (const row of rawInitiators ?? []) {
        if (typeof row.id === "string" && typeof row.full_name === "string") {
          initiatedByNameById.set(row.id, row.full_name);
        }
      }
    }

    const runs = parsedRuns.data.map((row) =>
      toPayrollRunSummary(row, row.initiated_by ? initiatedByNameById.get(row.initiated_by) ?? "Unknown user" : null)
    );

    const latestRun = runs[0] ?? null;
    const today = new Date().toISOString().slice(0, 10);

    const nextPayDate =
      runs
        .filter((run) => run.payDate >= today && run.status !== "cancelled")
        .map((run) => run.payDate)
        .sort()[0] ?? null;

    const responseData: PayrollRunsDashboardResponseData = {
      metrics: {
        latestStatus: latestRun?.status ?? null,
        latestTotalCostAmount: latestRun ? getCurrencyTotal(latestRun.totalNet, "USD") : 0,
        latestEmployeeCount: latestRun?.employeeCount ?? 0,
        nextPayDate,
        activeContractorCount
      },
      runs
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

    const { data: insertedRun, error: insertError } = await supabase
      .from("payroll_runs")
      .insert({
        org_id: session.profile.org_id,
        pay_period_start: payPeriodStart,
        pay_period_end: payPeriodEnd,
        pay_date: payDate,
        status: "draft",
        initiated_by: session.profile.id,
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
        "id, org_id, pay_period_start, pay_period_end, pay_date, status, initiated_by, first_approved_by, first_approved_at, final_approved_by, final_approved_at, total_gross, total_net, total_deductions, total_employer_contributions, employee_count, snapshot, notes, created_at, updated_at"
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

    const activeContractorCount = await countActiveContractors({
      supabase,
      orgId: session.profile.org_id
    });

    const runSummary = toPayrollRunSummary(parsedRun.data, session.profile.full_name);

    await logAudit({
      action: "created",
      tableName: "payroll_runs",
      recordId: runSummary.id,
      newValue: {
        payPeriodStart: runSummary.payPeriodStart,
        payPeriodEnd: runSummary.payPeriodEnd,
        payDate: runSummary.payDate,
        status: runSummary.status
      }
    });

    const responseData: CreatePayrollRunResponseData = {
      run: runSummary,
      activeContractorCount
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
