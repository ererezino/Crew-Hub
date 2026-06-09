import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import {
  canApproveMonthlyOvertime,
  getPreviousMonthWindow,
  summarizeMonthlyOvertime
} from "../../../../../../../lib/payroll/overtime";
import { persistPayrollRunCalculation } from "../../../../../../../lib/payroll/persist-payroll-run-calculation";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import type {
  ApproveMonthlyOvertimeResponseData,
  PayrollOvertimeSummary
} from "../../../../../../../types/payroll-runs";
import {
  buildMeta,
  canApprovePayroll,
  jsonResponse,
  PAYROLL_RUN_SELECT_COLUMNS,
  payrollRunRowSchema
} from "../../../_helpers";

const bodySchema = z.object({
  action: z.literal("approve_previous_month")
});

const eligiblePayrollProfileRowSchema = z.object({
  id: z.string().uuid()
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

function parseAmount(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

async function loadPreviousMonthOvertimeSummary({
  supabase,
  orgId,
  runId,
  payPeriodStart,
  eligiblePayrollEmployeeIds
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
  runId: string;
  payPeriodStart: string;
  eligiblePayrollEmployeeIds: string[];
}): Promise<PayrollOvertimeSummary> {
  const previousMonthWindow = getPreviousMonthWindow(payPeriodStart);
  const { data: rawOvertimeEntries, error: overtimeEntriesError } =
    eligiblePayrollEmployeeIds.length > 0
      ? await supabase
          .from("overtime_entries")
          .select("id, employee_id, hours, amount, currency, status, payroll_item_id")
          .eq("org_id", orgId)
          .in("employee_id", eligiblePayrollEmployeeIds)
          .gte("entry_date", previousMonthWindow.periodStart)
          .lte("entry_date", previousMonthWindow.periodEnd)
          .is("deleted_at", null)
      : { data: [], error: null };

  if (overtimeEntriesError) {
    throw new Error(
      `Unable to load previous-month overtime entries: ${overtimeEntriesError.message}`
    );
  }

  const parsedOvertimeEntries = z.array(overtimeEntryRowSchema).safeParse(rawOvertimeEntries ?? []);

  if (!parsedOvertimeEntries.success) {
    throw new Error("Previous-month overtime entries are invalid.");
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
          .eq("org_id", orgId)
          .in("id", linkedPayrollItemIds)
      : { data: [], error: null };

  if (linkedPayrollItemsError) {
    throw new Error(
      `Unable to load payroll links for overtime entries: ${linkedPayrollItemsError.message}`
    );
  }

  const parsedLinkedPayrollItems = z
    .array(linkedPayrollItemRowSchema)
    .safeParse(rawLinkedPayrollItems ?? []);

  if (!parsedLinkedPayrollItems.success) {
    throw new Error("Overtime payroll links are invalid.");
  }

  const linkedRunIdByPayrollItemId = new Map(
    parsedLinkedPayrollItems.data.map((row) => [row.id, row.payroll_run_id])
  );

  return summarizeMonthlyOvertime({
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
}

async function loadEligiblePayrollEmployeeIds({
  supabase,
  orgId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
}): Promise<string[]> {
  const { data: rawEligiblePayrollProfiles, error: eligiblePayrollProfilesError } = await supabase
    .from("profiles")
    .select("id")
    .eq("org_id", orgId)
    .in("payroll_mode", [
      "contractor_usd_no_withholding",
      "employee_local_withholding"
    ])
    .eq("status", "active")
    .is("deleted_at", null);

  if (eligiblePayrollProfilesError) {
    throw new Error(
      `Unable to load eligible payroll employees for overtime approval: ${eligiblePayrollProfilesError.message}`
    );
  }

  const parsedEligiblePayrollProfiles = z
    .array(eligiblePayrollProfileRowSchema)
    .safeParse(rawEligiblePayrollProfiles ?? []);

  if (!parsedEligiblePayrollProfiles.success) {
    throw new Error("Eligible payroll employees for overtime approval are invalid.");
  }

  return parsedEligiblePayrollProfiles.data.map((row) => row.id);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to approve overtime."
      },
      meta: buildMeta()
    });
  }

  if (!canApprovePayroll(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only finance approvers can approve monthly overtime."
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

  const parsedBody = bodySchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid overtime approval action."
      },
      meta: buildMeta()
    });
  }

  const { id: runId } = await params;

  try {
    const supabase = await createSupabaseServerClient();

    const { data: rawRun, error: runError } = await supabase
      .from("payroll_runs")
      .select(PAYROLL_RUN_SELECT_COLUMNS)
      .eq("org_id", session.profile.org_id)
      .eq("id", runId)
      .is("deleted_at", null)
      .maybeSingle();

    if (runError || !rawRun) {
      return jsonResponse<null>(404, {
        data: null,
        error: {
          code: "NOT_FOUND",
          message: "Payroll run not found."
        },
        meta: buildMeta()
      });
    }

    const parsedRun = payrollRunRowSchema.safeParse(rawRun);

    if (!parsedRun.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_RUN_PARSE_FAILED",
          message: "Payroll run data is invalid."
        },
        meta: buildMeta()
      });
    }

    if (!canApproveMonthlyOvertime(parsedRun.data.status)) {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "INVALID_STATE",
          message:
            "Previous-month overtime can only be approved while the payroll month is still editable."
        },
        meta: buildMeta()
      });
    }

    const previousMonthWindow = getPreviousMonthWindow(parsedRun.data.pay_period_start);
    const eligiblePayrollEmployeeIds = await loadEligiblePayrollEmployeeIds({
      supabase,
      orgId: session.profile.org_id
    });
    const overtimeSummaryBeforeApproval = await loadPreviousMonthOvertimeSummary({
      supabase,
      orgId: session.profile.org_id,
      runId,
      payPeriodStart: parsedRun.data.pay_period_start,
      eligiblePayrollEmployeeIds
    });

    const { data: rawPendingEntries, error: pendingEntriesError } = await supabase
      .from("overtime_entries")
      .select("id")
      .eq("org_id", session.profile.org_id)
      .eq("status", "pending")
      .in("employee_id", eligiblePayrollEmployeeIds.length > 0 ? eligiblePayrollEmployeeIds : ["00000000-0000-0000-0000-000000000000"])
      .gte("entry_date", previousMonthWindow.periodStart)
      .lte("entry_date", previousMonthWindow.periodEnd)
      .is("deleted_at", null);

    if (pendingEntriesError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "OVERTIME_APPROVAL_FAILED",
          message: `Unable to load pending overtime entries: ${pendingEntriesError.message}`
        },
        meta: buildMeta()
      });
    }

    const pendingEntryIds = (rawPendingEntries ?? [])
      .map((row) => row.id)
      .filter((value): value is string => typeof value === "string");

    if (pendingEntryIds.length > 0) {
      const nowIso = new Date().toISOString();
      const { error: approveError } = await supabase
        .from("overtime_entries")
        .update({
          status: "approved",
          approved_by: session.profile.id,
          approved_at: nowIso
        })
        .eq("org_id", session.profile.org_id)
        .in("id", pendingEntryIds);

      if (approveError) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "OVERTIME_APPROVAL_FAILED",
            message: `Unable to approve previous-month overtime: ${approveError.message}`
          },
          meta: buildMeta()
        });
      }

      await logAudit({
        action: "updated",
        tableName: "overtime_entries",
        recordId: runId,
        oldValue: {
          sourceMonth: previousMonthWindow.sourceMonth,
          pendingCount: overtimeSummaryBeforeApproval.pendingCount
        },
        newValue: {
          sourceMonth: previousMonthWindow.sourceMonth,
          approvedCount: pendingEntryIds.length,
          approvedBy: session.profile.id,
          payrollRunId: runId
        }
      });
    }

    await persistPayrollRunCalculation({
      supabase,
      actor: {
        id: session.profile.id,
        orgId: session.profile.org_id
      },
      run: {
        id: parsedRun.data.id,
        pay_period_start: parsedRun.data.pay_period_start,
        pay_period_end: parsedRun.data.pay_period_end,
        status: parsedRun.data.status,
        total_gross: parsedRun.data.total_gross,
        total_net: parsedRun.data.total_net,
        employee_count: parsedRun.data.employee_count,
        snapshot: parsedRun.data.snapshot
      }
    });

    const summary = await loadPreviousMonthOvertimeSummary({
      supabase,
      orgId: session.profile.org_id,
      runId,
      payPeriodStart: parsedRun.data.pay_period_start,
      eligiblePayrollEmployeeIds
    });

    const responseData: ApproveMonthlyOvertimeResponseData = {
      summary,
      approvedCount: pendingEntryIds.length,
      recalculated: true
    };

    return jsonResponse<ApproveMonthlyOvertimeResponseData>(200, {
      data: responseData,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "OVERTIME_APPROVAL_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Unable to approve previous-month overtime."
      },
      meta: buildMeta()
    });
  }
}
