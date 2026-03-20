import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { persistPayrollRunCalculation } from "../../../../../../../lib/payroll/persist-payroll-run-calculation";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import type { CalculatePayrollRunResponseData } from "../../../../../../../types/payroll-runs";
import {
  buildMeta,
  canManagePayroll,
  jsonResponse,
  PAYROLL_RUN_SELECT_COLUMNS,
  payrollRunRowSchema
} from "../../../_helpers";

// Shared validation lives in the helper via imports from "zod", and audit logging
// is handled there via logAudit so this route can stay a thin HTTP wrapper.

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
        PAYROLL_RUN_SELECT_COLUMNS
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

    if (parsedRun.data.status === "approved") {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "PAYROLL_LOCKED",
          message: "Payroll locked. Approved runs cannot be modified."
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

    const responseData = await persistPayrollRunCalculation({
      supabase,
      actor: {
        id: profile.id,
        orgId: profile.org_id
      },
      run: parsedRun.data
    });

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
