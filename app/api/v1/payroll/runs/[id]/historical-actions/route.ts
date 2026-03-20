import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { canApprovePayroll } from "../../../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import type { PayrollRunSummary } from "../../../../../../../types/payroll-runs";
import {
  buildMeta,
  canManagePayroll,
  jsonResponse,
  PAYROLL_RUN_SELECT_COLUMNS,
  payrollRunRowSchema,
  toPayrollRunSummary
} from "../../../_helpers";

const histActionSchema = z.object({
  action: z.enum(["review", "authorize", "publish"]),
  provenanceNote: z.string().trim().max(2000).optional().nullable()
});

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
        message: "You must be logged in to perform historical payroll actions."
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

  const parsedBody = histActionSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid historical action payload."
      },
      meta: buildMeta()
    });
  }

  const action = parsedBody.data.action;
  const provenanceNote = parsedBody.data.provenanceNote?.trim() || null;

  const { id: runId } = await params;
  const profile = session.profile;

  try {
    const supabase = await createSupabaseServerClient();

    const { data: rawRun, error: runError } = await supabase
      .from("payroll_runs")
      .select(PAYROLL_RUN_SELECT_COLUMNS)
      .eq("org_id", profile.org_id)
      .eq("id", runId)
      .is("deleted_at", null)
      .maybeSingle();

    if (runError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYROLL_RUN_ACTION_FAILED",
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

    // Guard: only historical runs
    if (!parsedRun.data.is_historical) {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "INVALID_STATE",
          message: "This action is only available for historical runs."
        },
        meta: buildMeta()
      });
    }

    const nowIso = new Date().toISOString();

    // ── review ─────────────────────────────────────────────────────────
    if (action === "review") {
      if (!canManagePayroll(profile.roles)) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "Only Finance users can review historical runs."
          },
          meta: buildMeta()
        });
      }

      if (parsedRun.data.reviewed_at !== null) {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "INVALID_STATE",
            message: "Already reviewed."
          },
          meta: buildMeta()
        });
      }

      const { data: updatedRun, error: updateError } = await supabase
        .from("payroll_runs")
        .update({
          reviewed_at: nowIso,
          reviewed_by: profile.id
        })
        .eq("org_id", profile.org_id)
        .eq("id", runId)
        .select(PAYROLL_RUN_SELECT_COLUMNS)
        .single();

      if (updateError || !updatedRun) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "PAYROLL_RUN_ACTION_FAILED",
            message: "Unable to update payroll run."
          },
          meta: buildMeta()
        });
      }

      const parsedUpdated = payrollRunRowSchema.safeParse(updatedRun);

      if (!parsedUpdated.success) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "PAYROLL_RUN_ACTION_FAILED",
            message: "Updated payroll run is not in expected format."
          },
          meta: buildMeta()
        });
      }

      await logAudit({
        action: "updated",
        tableName: "payroll_runs",
        recordId: runId,
        oldValue: { reviewed_at: null },
        newValue: {
          reviewed_at: nowIso,
          reviewed_by: profile.id,
          action: "review_historical"
        }
      });

      return jsonResponse<{ run: PayrollRunSummary }>(200, {
        data: { run: toPayrollRunSummary(parsedUpdated.data, null) },
        error: null,
        meta: buildMeta()
      });
    }

    // ── authorize ──────────────────────────────────────────────────────
    if (action === "authorize") {
      if (!canApprovePayroll(profile.roles)) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "Only Finance Approver and Super Admin can authorize historical runs."
          },
          meta: buildMeta()
        });
      }

      if (parsedRun.data.reviewed_at === null) {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "INVALID_STATE",
            message: "Run must be reviewed before authorization."
          },
          meta: buildMeta()
        });
      }

      if (parsedRun.data.authorized_at !== null) {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "INVALID_STATE",
            message: "Already authorized."
          },
          meta: buildMeta()
        });
      }

      if (parsedRun.data.reviewed_by === profile.id) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "The reviewer cannot authorize."
          },
          meta: buildMeta()
        });
      }

      const { data: updatedRun, error: updateError } = await supabase
        .from("payroll_runs")
        .update({
          authorized_at: nowIso,
          authorized_by: profile.id
        })
        .eq("org_id", profile.org_id)
        .eq("id", runId)
        .select(PAYROLL_RUN_SELECT_COLUMNS)
        .single();

      if (updateError || !updatedRun) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "PAYROLL_RUN_ACTION_FAILED",
            message: "Unable to update payroll run."
          },
          meta: buildMeta()
        });
      }

      const parsedUpdated = payrollRunRowSchema.safeParse(updatedRun);

      if (!parsedUpdated.success) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "PAYROLL_RUN_ACTION_FAILED",
            message: "Updated payroll run is not in expected format."
          },
          meta: buildMeta()
        });
      }

      await logAudit({
        action: "updated",
        tableName: "payroll_runs",
        recordId: runId,
        oldValue: { authorized_at: null },
        newValue: {
          authorized_at: nowIso,
          authorized_by: profile.id,
          action: "authorize_historical"
        }
      });

      return jsonResponse<{ run: PayrollRunSummary }>(200, {
        data: { run: toPayrollRunSummary(parsedUpdated.data, null) },
        error: null,
        meta: buildMeta()
      });
    }

    // ── publish ────────────────────────────────────────────────────────
    // AUTHORITY: only FINANCE_APPROVER or SUPER_ADMIN may publish.
    // FINANCE_ADMIN alone cannot make historical payroll employee-visible.
    if (action === "publish") {
      if (!canApprovePayroll(profile.roles)) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "Only Finance Approver and Super Admin can publish historical runs."
          },
          meta: buildMeta()
        });
      }

      if (parsedRun.data.authorized_at === null) {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "INVALID_STATE",
            message: "Run must be authorized before publication."
          },
          meta: buildMeta()
        });
      }

      if (parsedRun.data.published_at !== null) {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "INVALID_STATE",
            message: "Already published."
          },
          meta: buildMeta()
        });
      }

      // ── Pre-condition: historical payslips must exist ────────────────
      // Option B: block publish unless every payroll item already has a
      // payslip row. If they don't exist, the publish action fails hard.

      const { data: payrollItems, error: itemsError } = await supabase
        .from("payroll_items")
        .select("id")
        .eq("payroll_run_id", runId)
        .eq("org_id", profile.org_id)
        .is("deleted_at", null);

      if (itemsError) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "PAYROLL_RUN_ACTION_FAILED",
            message: "Unable to load payroll items for publication."
          },
          meta: buildMeta()
        });
      }

      const payrollItemIds = (payrollItems ?? []).map(
        (item: { id: string }) => item.id
      );

      if (payrollItemIds.length === 0) {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "MISSING_PAYSLIPS",
            message: "No payroll items exist for this run. Cannot publish."
          },
          meta: buildMeta()
        });
      }

      // Verify that a payslip row exists for every payroll item
      const { data: existingPayslips, error: payslipCheckError } = await supabase
        .from("payslips")
        .select("payroll_item_id")
        .in("payroll_item_id", payrollItemIds)
        .is("deleted_at", null);

      if (payslipCheckError) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "PAYROLL_RUN_ACTION_FAILED",
            message: "Unable to verify payslip existence."
          },
          meta: buildMeta()
        });
      }

      const existingPayslipItemIds = new Set(
        (existingPayslips ?? []).map(
          (row: { payroll_item_id: string }) => row.payroll_item_id
        )
      );

      const missingPayslipItemIds = payrollItemIds.filter(
        (id: string) => !existingPayslipItemIds.has(id)
      );

      if (missingPayslipItemIds.length > 0) {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "MISSING_PAYSLIPS",
            message: `${missingPayslipItemIds.length} payroll item(s) do not have generated payslip records. Generate payment statements before publishing.`
          },
          meta: buildMeta()
        });
      }

      // ── Step 1: Update payslips FIRST ────────────────────────────────
      // Payslips must be made employee-visible before the run is marked
      // published. If this step fails, the run stays unpublished — truthful.
      const { error: payslipUpdateError } = await supabase
        .from("payslips")
        .update({ published_at: nowIso, statement_type: "historical" })
        .in("payroll_item_id", payrollItemIds)
        .is("deleted_at", null);

      if (payslipUpdateError) {
        // Payslips NOT made visible → do NOT mark run as published → no audit lie
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "PAYSLIP_PUBLICATION_FAILED",
            message: "Failed to make payslips employee-visible. Run remains unpublished."
          },
          meta: buildMeta()
        });
      }

      // ── Step 2: Mark run as published ────────────────────────────────
      const runUpdate: Record<string, unknown> = {
        published_at: nowIso,
        published_by: profile.id
      };

      if (provenanceNote) {
        runUpdate.provenance_note = provenanceNote;
      }

      const { data: updatedRun, error: updateError } = await supabase
        .from("payroll_runs")
        .update(runUpdate)
        .eq("org_id", profile.org_id)
        .eq("id", runId)
        .select(PAYROLL_RUN_SELECT_COLUMNS)
        .single();

      if (updateError || !updatedRun) {
        // Run update failed but payslips were already updated.
        // Roll back payslip visibility so the state remains consistent:
        // unpublished run = invisible payslips.
        await supabase
          .from("payslips")
          .update({ published_at: null, statement_type: "historical" })
          .in("payroll_item_id", payrollItemIds)
          .is("deleted_at", null);

        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "PAYROLL_RUN_ACTION_FAILED",
            message: "Unable to mark run as published. Payslip visibility has been rolled back."
          },
          meta: buildMeta()
        });
      }

      const parsedUpdated = payrollRunRowSchema.safeParse(updatedRun);

      if (!parsedUpdated.success) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "PAYROLL_RUN_ACTION_FAILED",
            message: "Updated payroll run is not in expected format."
          },
          meta: buildMeta()
        });
      }

      // ── Step 3: Audit ONLY after both writes succeeded ───────────────
      await logAudit({
        action: "updated",
        tableName: "payroll_runs",
        recordId: runId,
        oldValue: { published_at: null },
        newValue: {
          published_at: nowIso,
          published_by: profile.id,
          provenance_note: provenanceNote,
          action: "publish_historical"
        }
      });

      await logAudit({
        action: "updated",
        tableName: "payslips",
        recordId: runId,
        oldValue: { published_at: null },
        newValue: {
          published_at: nowIso,
          statement_type: "historical",
          payslip_count: payrollItemIds.length,
          action: "publish_historical_payslips"
        }
      });

      return jsonResponse<{ run: PayrollRunSummary }>(200, {
        data: { run: toPayrollRunSummary(parsedUpdated.data, null) },
        error: null,
        meta: buildMeta()
      });
    }

    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Unknown action."
      },
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYROLL_RUN_ACTION_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Unable to perform historical payroll action."
      },
      meta: buildMeta()
    });
  }
}
