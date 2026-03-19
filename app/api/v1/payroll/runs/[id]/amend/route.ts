import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { evaluateCreateAmendmentAction } from "../../../../../../../lib/payroll/cycle-policy";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import type { CreateAmendmentRunResponseData } from "../../../../../../../types/payroll-runs";
import {
  buildMeta,
  jsonResponse,
  PAYROLL_RUN_SELECT_COLUMNS,
  payrollRunRowSchema,
  toPayrollRunSummary
} from "../../../_helpers";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  const { id: runId } = await params;
  const profile = session.profile;

  try {
    const supabase = await createSupabaseServerClient();

    // Load the original run
    const { data: rawRun, error: runError } = await supabase
      .from("payroll_runs")
      .select(PAYROLL_RUN_SELECT_COLUMNS)
      .eq("org_id", profile.org_id)
      .eq("id", runId)
      .is("deleted_at", null)
      .maybeSingle();

    if (runError || !rawRun) {
      return jsonResponse<null>(runError ? 500 : 404, {
        data: null,
        error: { code: runError ? "PAYROLL_RUN_FETCH_FAILED" : "NOT_FOUND", message: "Payroll run not found." },
        meta: buildMeta()
      });
    }

    const parsedRun = payrollRunRowSchema.safeParse(rawRun);
    if (!parsedRun.success) {
      return jsonResponse<null>(404, {
        data: null,
        error: { code: "NOT_FOUND", message: "Payroll run not found." },
        meta: buildMeta()
      });
    }

    // Check for existing active amendment
    const { count: activeAmendmentCount } = await supabase
      .from("payroll_runs")
      .select("id", { count: "exact", head: true })
      .eq("org_id", profile.org_id)
      .eq("amendment_of", runId)
      .is("deleted_at", null)
      .neq("status", "cancelled");

    // Policy check
    const decision = evaluateCreateAmendmentAction({
      runLockedAt: parsedRun.data.locked_at ?? null,
      hasActiveAmendment: (activeAmendmentCount ?? 0) > 0,
      actorRoles: profile.roles
    });

    if (!decision.allowed) {
      const httpStatus = decision.code === "FORBIDDEN" ? 403 : 409;
      return jsonResponse<null>(httpStatus, {
        data: null,
        error: { code: decision.code, message: decision.message },
        meta: buildMeta()
      });
    }

    // Create the amendment run
    const { data: newRunRow, error: insertError } = await supabase
      .from("payroll_runs")
      .insert({
        org_id: profile.org_id,
        pay_period_start: parsedRun.data.pay_period_start,
        pay_period_end: parsedRun.data.pay_period_end,
        pay_date: parsedRun.data.pay_date,
        status: "draft",
        initiated_by: profile.id,
        amendment_of: runId,
        employee_count: 0,
        snapshot: {
          amendmentOf: runId,
          originalRunMonth: parsedRun.data.run_month
        },
        notes: `Amendment of payroll run ${runId}`
      })
      .select(PAYROLL_RUN_SELECT_COLUMNS)
      .single();

    if (insertError || !newRunRow) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "PAYROLL_RUN_CREATE_FAILED", message: "Unable to create amendment run." },
        meta: buildMeta()
      });
    }

    const parsedNew = payrollRunRowSchema.safeParse(newRunRow);
    if (!parsedNew.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "PAYROLL_RUN_CREATE_FAILED", message: "Amendment run is in unexpected format." },
        meta: buildMeta()
      });
    }

    await logAudit({
      action: "created",
      tableName: "payroll_runs",
      recordId: parsedNew.data.id,
      newValue: {
        action: "create_amendment",
        amendmentOf: runId,
        initiatedBy: profile.id
      }
    });

    const runSummary = toPayrollRunSummary(parsedNew.data, profile.full_name);

    return jsonResponse<CreateAmendmentRunResponseData>(201, {
      data: { run: runSummary },
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYROLL_RUN_CREATE_FAILED",
        message: error instanceof Error ? error.message : "Unable to create amendment run."
      },
      meta: buildMeta()
    });
  }
}
