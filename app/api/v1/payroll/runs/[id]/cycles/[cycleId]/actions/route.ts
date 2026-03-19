import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../../../lib/audit";
import { evaluateMarkCyclePaidAction } from "../../../../../../../../../lib/payroll/cycle-policy";
import { createSupabaseServerClient } from "../../../../../../../../../lib/supabase/server";
import type { MarkCyclePaidResponseData, PayrollCycle } from "../../../../../../../../../types/payroll-runs";
import {
  buildMeta,
  jsonResponse,
  PAYROLL_CYCLE_SELECT_COLUMNS,
  payrollCycleRowSchema,
  toPayrollCycleSummary
} from "../../../../../_helpers";

const cycleActionBodySchema = z.object({
  action: z.enum(["mark_paid"])
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; cycleId: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Request body must be valid JSON." },
      meta: buildMeta()
    });
  }

  const parsedBody = cycleActionBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: "Invalid cycle action." },
      meta: buildMeta()
    });
  }

  const { id: runId, cycleId } = await params;
  const profile = session.profile;

  try {
    const supabase = await createSupabaseServerClient();

    // Load the cycle
    const { data: rawCycle, error: cycleError } = await supabase
      .from("payroll_cycles")
      .select(PAYROLL_CYCLE_SELECT_COLUMNS)
      .eq("org_id", profile.org_id)
      .eq("payroll_run_id", runId)
      .eq("id", cycleId)
      .is("deleted_at", null)
      .maybeSingle();

    if (cycleError || !rawCycle) {
      return jsonResponse<null>(cycleError ? 500 : 404, {
        data: null,
        error: {
          code: cycleError ? "PAYROLL_CYCLE_FETCH_FAILED" : "NOT_FOUND",
          message: "Payout cycle not found."
        },
        meta: buildMeta()
      });
    }

    const parsedCycle = payrollCycleRowSchema.safeParse(rawCycle);
    if (!parsedCycle.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "PAYROLL_CYCLE_PARSE_FAILED", message: "Payout cycle data is invalid." },
        meta: buildMeta()
      });
    }

    // Policy check
    const decision = evaluateMarkCyclePaidAction({
      cycleStatus: parsedCycle.data.status,
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

    const nowIso = new Date().toISOString();

    // 1. Update the cycle → paid
    const { data: updatedCycleRow, error: updateCycleError } = await supabase
      .from("payroll_cycles")
      .update({
        status: "paid",
        paid_at: nowIso,
        paid_by: profile.id,
        locked_at: nowIso
      })
      .eq("id", cycleId)
      .eq("org_id", profile.org_id)
      .select(PAYROLL_CYCLE_SELECT_COLUMNS)
      .single();

    if (updateCycleError || !updatedCycleRow) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "PAYROLL_CYCLE_UPDATE_FAILED", message: "Unable to mark cycle as paid." },
        meta: buildMeta()
      });
    }

    // 2. Update all cycle items → paid
    await supabase
      .from("payroll_cycle_items")
      .update({ disbursement_status: "paid" })
      .eq("payroll_cycle_id", cycleId)
      .eq("org_id", profile.org_id);

    // 3. Update the corresponding payroll_items → paid
    const { data: cycleItemRows } = await supabase
      .from("payroll_cycle_items")
      .select("payroll_item_id")
      .eq("payroll_cycle_id", cycleId)
      .eq("org_id", profile.org_id);

    if (cycleItemRows && cycleItemRows.length > 0) {
      const payrollItemIds = cycleItemRows.map(
        (row: { payroll_item_id: string }) => row.payroll_item_id
      );

      await supabase
        .from("payroll_items")
        .update({ payment_status: "paid" })
        .eq("org_id", profile.org_id)
        .in("id", payrollItemIds);
    }

    // 4. Check if ALL non-cancelled cycles for this run are now paid
    const { count: unpaidCount } = await supabase
      .from("payroll_cycles")
      .select("id", { count: "exact", head: true })
      .eq("org_id", profile.org_id)
      .eq("payroll_run_id", runId)
      .is("deleted_at", null)
      .neq("status", "cancelled")
      .neq("status", "paid");

    if (unpaidCount === 0) {
      // All cycles paid → complete the run
      await supabase
        .from("payroll_runs")
        .update({
          status: "completed",
          completed_at: nowIso,
          completed_by: profile.id,
          locked_at: nowIso
        })
        .eq("id", runId)
        .eq("org_id", profile.org_id);

      await logAudit({
        action: "updated",
        tableName: "payroll_runs",
        recordId: runId,
        oldValue: { status: "processing" },
        newValue: {
          status: "completed",
          action: "all_cycles_paid",
          completedBy: profile.id
        }
      });
    }

    await logAudit({
      action: "updated",
      tableName: "payroll_cycles",
      recordId: cycleId,
      oldValue: { status: parsedCycle.data.status },
      newValue: { status: "paid", action: "mark_paid" }
    });

    const parsedUpdated = payrollCycleRowSchema.safeParse(updatedCycleRow);
    const cycle: PayrollCycle = parsedUpdated.success
      ? toPayrollCycleSummary(parsedUpdated.data)
      : toPayrollCycleSummary(parsedCycle.data);

    return jsonResponse<MarkCyclePaidResponseData>(200, {
      data: { cycle },
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYROLL_CYCLE_UPDATE_FAILED",
        message: error instanceof Error ? error.message : "Unable to mark cycle as paid."
      },
      meta: buildMeta()
    });
  }
}
