import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { sendPayrollApprovedEmail } from "../../../../../../../lib/notifications/email";
import { createBulkNotifications } from "../../../../../../../lib/notifications/service";
import { evaluatePayrollApprovalAction } from "../../../../../../../lib/payroll/approval-policy";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import type { UserRole } from "../../../../../../../lib/navigation";
import { hasRole } from "../../../../../../../lib/roles";
import type { PayrollRunStatus, PayrollRunSummary } from "../../../../../../../types/payroll-runs";
import {
  buildMeta,
  jsonResponse,
  PAYROLL_RUN_SELECT_COLUMNS,
  payrollRunRowSchema,
  toPayrollRunSummary,
  toSnapshot
} from "../../../_helpers";

const actionBodySchema = z.object({
  action: z.enum(["submit", "approve", "reject", "cancel", "reopen", "mark_processing", "mark_completed"]),
  reason: z.string().trim().max(500).optional().nullable()
});

function formatPayPeriodLabel(startDate: string, endDate: string): string {
  try {
    const end = new Date(endDate + "T00:00:00Z");
    return end.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  } catch {
    return endDate.slice(0, 7);
  }
}

function isFinanceUser(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "FINANCE_APPROVER") || hasRole(roles, "SUPER_ADMIN");
}

function canApproveRole(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_APPROVER") || hasRole(roles, "SUPER_ADMIN");
}

function statusFromDecisionCode(
  code: "FORBIDDEN" | "INVALID_STATE" | "PAYROLL_LOCKED"
): number {
  if (code === "INVALID_STATE") {
    return 409;
  }

  return 403;
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
        message: "You must be logged in to update payroll approval state."
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

  const parsedBody = actionBodySchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid payroll action payload."
      },
      meta: buildMeta()
    });
  }

  const action = parsedBody.data.action;
  const reason = parsedBody.data.reason?.trim() || null;

  if (action === "reopen" && !reason) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "A reason for reopening is required."
      },
      meta: buildMeta()
    });
  }

  if (action === "reject" && !reason) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Rejection reason is required."
      },
      meta: buildMeta()
    });
  }

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

    // Resolve submitted_by: prefer the dedicated column, fall back to snapshot.
    const submittedBy: string | null =
      parsedRun.data.submitted_by ??
      (toSnapshot(parsedRun.data.snapshot)?.submittedBy as string | null) ??
      null;

    const actionDecision = evaluatePayrollApprovalAction({
      action,
      status: parsedRun.data.status,
      actorId: profile.id,
      submittedBy,
      actorRoles: profile.roles
    });

    if (!actionDecision.allowed) {
      return jsonResponse<null>(statusFromDecisionCode(actionDecision.code), {
        data: null,
        error: {
          code: actionDecision.code,
          message: actionDecision.message
        },
        meta: buildMeta()
      });
    }

    const previousSnapshot = toSnapshot(parsedRun.data.snapshot);
    const nowIso = new Date().toISOString();

    let nextStatus: PayrollRunStatus = parsedRun.data.status;
    let nextSnapshot = previousSnapshot;
    let nextFirstApprovedBy: string | null = parsedRun.data.first_approved_by;
    let nextFirstApprovedAt: string | null = parsedRun.data.first_approved_at;
    let nextFinalApprovedBy: string | null = parsedRun.data.final_approved_by;
    let nextFinalApprovedAt: string | null = parsedRun.data.final_approved_at;
    let nextNotes = parsedRun.data.notes;
    let nextSubmittedAt: string | null = parsedRun.data.submitted_at ?? null;
    let nextSubmittedBy: string | null = submittedBy;
    let nextRejectedAt: string | null = parsedRun.data.rejected_at ?? null;
    let nextRejectedBy: string | null = parsedRun.data.rejected_by ?? null;
    let nextRejectionReason: string | null = parsedRun.data.rejection_reason ?? null;
    let nextCompletedAt: string | null = parsedRun.data.completed_at ?? null;
    let nextLockedAt: string | null = parsedRun.data.locked_at ?? null;

    // ── submit ──────────────────────────────────────────────────────
    if (action === "submit") {
      if (!isFinanceUser(profile.roles)) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "Only Finance users can submit payroll runs."
          },
          meta: buildMeta()
        });
      }

      if (parsedRun.data.status !== "calculated" && parsedRun.data.status !== "rejected") {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "INVALID_STATE",
            message: "Only calculated or rejected runs can be submitted for approval."
          },
          meta: buildMeta()
        });
      }

      if (parsedRun.data.employee_count <= 0) {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "INVALID_STATE",
            message: "Payroll run must contain items before submission."
          },
          meta: buildMeta()
        });
      }

      /* Defense-in-depth: block submission if any items still need
       * withholding calculation. */
      const { count: uncalcCount } = await supabase
        .from("payroll_items")
        .select("id", { count: "exact", head: true })
        .eq("payroll_run_id", runId)
        .eq("org_id", profile.org_id)
        .eq("withholding_applied", false)
        .is("deleted_at", null);

      if (uncalcCount && uncalcCount > 0) {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "INVALID_STATE",
            message:
              "Some payroll items have not had withholding rules applied. Run Calculate before submitting."
          },
          meta: buildMeta()
        });
      }

      nextStatus = "submitted";
      nextSubmittedAt = nowIso;
      nextSubmittedBy = profile.id;
      // Clear any previous approval state.
      nextFirstApprovedBy = null;
      nextFirstApprovedAt = null;
      nextFinalApprovedBy = null;
      nextFinalApprovedAt = null;
      // Clear previous rejection state on resubmission.
      nextRejectedAt = null;
      nextRejectedBy = null;
      nextRejectionReason = null;
      nextSnapshot = {
        ...previousSnapshot,
        submittedAt: nowIso,
        submittedBy: profile.id,
        submittedByName: profile.full_name
      };
    }

    // ── approve (single step) ───────────────────────────────────────
    if (action === "approve") {
      if (!canApproveRole(profile.roles)) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "Only Finance Approver and Super Admin can approve payroll runs."
          },
          meta: buildMeta()
        });
      }

      if (parsedRun.data.status !== "submitted") {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "INVALID_STATE",
            message: "Only submitted runs can be approved."
          },
          meta: buildMeta()
        });
      }

      if (submittedBy === profile.id) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "The person who submitted the run cannot approve it."
          },
          meta: buildMeta()
        });
      }

      nextStatus = "approved";
      // Write to final_approved_by/at to keep backward compat with existing snapshot consumers.
      nextFinalApprovedBy = profile.id;
      nextFinalApprovedAt = nowIso;
      nextLockedAt = nowIso;
      nextSnapshot = {
        ...previousSnapshot,
        approvedAt: nowIso,
        approvedBy: profile.id,
        approvedByName: profile.full_name,
        lockedAt: nowIso,
        lockedBy: profile.id,
        locked: true
      };
    }

    // ── reject ──────────────────────────────────────────────────────
    if (action === "reject") {
      if (!canApproveRole(profile.roles)) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "Only Finance Approver and Super Admin can reject payroll runs."
          },
          meta: buildMeta()
        });
      }

      if (parsedRun.data.status !== "submitted") {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "INVALID_STATE",
            message: "Only submitted runs can be rejected."
          },
          meta: buildMeta()
        });
      }

      if (submittedBy === profile.id) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "The person who submitted the run cannot reject it."
          },
          meta: buildMeta()
        });
      }

      nextStatus = "rejected";
      nextFirstApprovedBy = null;
      nextFirstApprovedAt = null;
      nextFinalApprovedBy = null;
      nextFinalApprovedAt = null;
      nextRejectedAt = nowIso;
      nextRejectedBy = profile.id;
      nextRejectionReason = reason;
      nextSnapshot = {
        ...previousSnapshot,
        lastRejectedAt: nowIso,
        lastRejectedBy: profile.id,
        lastRejectedByName: profile.full_name,
        lastRejectionReason: reason
      };
      nextNotes = reason;
    }

    // ── cancel ──────────────────────────────────────────────────────
    if (action === "cancel") {
      if (!isFinanceUser(profile.roles)) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "Only Finance users can cancel payroll runs."
          },
          meta: buildMeta()
        });
      }

      if (parsedRun.data.status === "cancelled") {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "INVALID_STATE",
            message: "Run is already cancelled."
          },
          meta: buildMeta()
        });
      }

      nextStatus = "cancelled";
      nextSnapshot = {
        ...previousSnapshot,
        cancelledAt: nowIso,
        cancelledBy: profile.id,
        cancelledByName: profile.full_name,
        cancellationReason: reason
      };
      nextNotes = reason ?? parsedRun.data.notes;
    }

    // ── reopen ──────────────────────────────────────────────────────
    if (action === "reopen") {
      if (!canApproveRole(profile.roles)) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "Only Finance Approver and Super Admin can reopen payroll runs."
          },
          meta: buildMeta()
        });
      }

      if (parsedRun.data.status !== "approved" && parsedRun.data.status !== "processing") {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "INVALID_STATE",
            message: "Only approved or processing runs can be reopened."
          },
          meta: buildMeta()
        });
      }

      nextStatus = "calculated";
      nextFirstApprovedBy = null;
      nextFirstApprovedAt = null;
      nextFinalApprovedBy = null;
      nextFinalApprovedAt = null;
      nextSubmittedAt = null;
      nextSubmittedBy = null;
      nextLockedAt = null;
      nextCompletedAt = null;
      nextSnapshot = {
        ...previousSnapshot,
        reopenedAt: nowIso,
        reopenedBy: profile.id,
        reopenedByName: profile.full_name,
        reopenReason: reason,
        locked: false
      };
      nextNotes = reason;
    }

    // ── mark_processing ─────────────────────────────────────────────
    if (action === "mark_processing") {
      if (!isFinanceUser(profile.roles)) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "Only Finance users can mark runs as processing."
          },
          meta: buildMeta()
        });
      }

      if (parsedRun.data.status !== "approved") {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "INVALID_STATE",
            message: "Only approved runs can be marked as processing."
          },
          meta: buildMeta()
        });
      }

      nextStatus = "processing";
      nextSnapshot = {
        ...previousSnapshot,
        processingStartedAt: nowIso,
        processingStartedBy: profile.id
      };
    }

    // ── mark_completed ──────────────────────────────────────────────
    if (action === "mark_completed") {
      if (!isFinanceUser(profile.roles)) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "Only Finance users can mark runs as completed."
          },
          meta: buildMeta()
        });
      }

      if (parsedRun.data.status !== "processing") {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "INVALID_STATE",
            message: "Only processing runs can be marked as completed."
          },
          meta: buildMeta()
        });
      }

      nextStatus = "completed";
      nextCompletedAt = nowIso;
      nextSnapshot = {
        ...previousSnapshot,
        completedAt: nowIso,
        completedBy: profile.id,
        completedByName: profile.full_name,
        completionNotes: reason
      };
      if (reason) {
        nextNotes = reason;
      }
    }

    const { data: updatedRun, error: updateError } = await supabase
      .from("payroll_runs")
      .update({
        status: nextStatus,
        first_approved_by: nextFirstApprovedBy,
        first_approved_at: nextFirstApprovedAt,
        final_approved_by: nextFinalApprovedBy,
        final_approved_at: nextFinalApprovedAt,
        submitted_at: nextSubmittedAt,
        submitted_by: nextSubmittedBy,
        rejected_at: nextRejectedAt,
        rejected_by: nextRejectedBy,
        rejection_reason: nextRejectionReason,
        completed_at: nextCompletedAt,
        locked_at: nextLockedAt,
        snapshot: nextSnapshot,
        notes: nextNotes
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
          message: "Unable to update payroll approval state."
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
      oldValue: {
        status: parsedRun.data.status
      },
      newValue: {
        status: nextStatus,
        action,
        reason
      }
    });

    if (action === "reopen" && nextStatus === "calculated") {
      const { data: adminRows, error: adminRowsError } = await supabase
        .from("profiles")
        .select("id, roles")
        .eq("org_id", profile.org_id)
        .is("deleted_at", null);

      if (!adminRowsError && adminRows) {
        const adminRecipientIds = [...new Set(
          adminRows
            .filter(
              (row): row is { id: string; roles: string[] } =>
                typeof row?.id === "string" &&
                Array.isArray(row?.roles) &&
                (row.roles.includes("FINANCE_ADMIN") || row.roles.includes("FINANCE_APPROVER") || row.roles.includes("SUPER_ADMIN"))
            )
            .map((row) => row.id)
        )];

        if (adminRecipientIds.length > 0) {
          const payPeriodLabel = formatPayPeriodLabel(
            parsedUpdated.data.pay_period_start,
            parsedUpdated.data.pay_period_end
          );

          await createBulkNotifications({
            orgId: profile.org_id,
            userIds: adminRecipientIds,
            type: "payroll_approved",
            title: "Payroll reopened",
            body: `Payroll for ${payPeriodLabel} has been reopened. All approvals have been cleared.`,
            link: "/payroll"
          });
        }
      }
    }

    if (action === "approve" && nextStatus === "approved") {
      const payPeriodLabel = formatPayPeriodLabel(
        parsedUpdated.data.pay_period_start,
        parsedUpdated.data.pay_period_end
      );

      const { data: adminRows, error: adminRowsError } = await supabase
        .from("profiles")
        .select("id, roles")
        .eq("org_id", profile.org_id)
        .is("deleted_at", null);

      if (adminRowsError) {
        console.error("Unable to load payroll approval notification recipients.", {
          runId,
          message: adminRowsError.message
        });
      } else {
        const adminRecipientIds = [...new Set(
          (adminRows ?? [])
            .filter(
              (row): row is { id: string; roles: string[] } =>
                typeof row?.id === "string" &&
                Array.isArray(row?.roles) &&
                (row.roles.includes("FINANCE_ADMIN") || row.roles.includes("FINANCE_APPROVER") || row.roles.includes("SUPER_ADMIN"))
            )
            .map((row) => row.id)
        )];

        if (adminRecipientIds.length > 0) {
          await createBulkNotifications({
            orgId: profile.org_id,
            userIds: adminRecipientIds,
            type: "payroll_approved",
            title: "Payroll approved",
            body: `Payroll for ${payPeriodLabel} has been approved and is ready for payment processing.`,
            link: "/payroll"
          });
        }
      }

      sendPayrollApprovedEmail({
        orgId: profile.org_id,
        userId: profile.id,
        runName: `Payroll ${payPeriodLabel}`
      }).catch((err) => console.error("Email send failed:", err));
    }

    const responseRun: PayrollRunSummary = toPayrollRunSummary(
      parsedUpdated.data,
      parsedUpdated.data.initiated_by === profile.id
        ? profile.full_name
        : null,
      {
        firstApprovedByName: parsedUpdated.data.first_approved_by === profile.id
          ? profile.full_name
          : null,
        finalApprovedByName: parsedUpdated.data.final_approved_by === profile.id
          ? profile.full_name
          : null
      }
    );

    return jsonResponse<{ run: PayrollRunSummary }>(200, {
      data: {
        run: responseRun
      },
      error: null,
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
            : "Unable to update payroll approval state."
      },
      meta: buildMeta()
    });
  }
}
