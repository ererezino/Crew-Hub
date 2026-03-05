import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { createBulkNotifications, createNotification } from "../../../../../../../lib/notifications/service";
import { sendPayslipReadyEmail } from "../../../../../../../lib/notifications/email";
import { evaluatePayrollApprovalAction } from "../../../../../../../lib/payroll/approval-policy";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import type { UserRole } from "../../../../../../../lib/navigation";
import { hasRole } from "../../../../../../../lib/roles";
import type { PayrollRunStatus, PayrollRunSummary } from "../../../../../../../types/payroll-runs";
import {
  buildMeta,
  jsonResponse,
  payrollRunRowSchema,
  toPayrollRunSummary,
  toSnapshot
} from "../../../_helpers";

const actionBodySchema = z.object({
  action: z.enum(["submit", "approve_first", "approve_final", "reject", "cancel"]),
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

function canSubmit(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "SUPER_ADMIN");
}

function canFirstApprove(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "SUPER_ADMIN");
}

function canFinalApprove(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "SUPER_ADMIN");
}

function rejectionReasonRequiredMessage(): string {
  return "Rejection reason is required.";
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

  if (action === "reject" && !reason) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: rejectionReasonRequiredMessage()
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
      .select(
        "id, org_id, pay_period_start, pay_period_end, pay_date, status, initiated_by, first_approved_by, first_approved_at, final_approved_by, final_approved_at, total_gross, total_net, total_deductions, total_employer_contributions, employee_count, snapshot, notes, created_at, updated_at"
      )
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

    const actionDecision = evaluatePayrollApprovalAction({
      action,
      status: parsedRun.data.status,
      actorId: profile.id,
      initiatedBy: parsedRun.data.initiated_by,
      firstApprovedBy: parsedRun.data.first_approved_by,
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

    if (action === "submit") {
      if (!canSubmit(profile.roles)) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "Only Finance Admin and Super Admin can submit payroll runs."
          },
          meta: buildMeta()
        });
      }

      if (parsedRun.data.status !== "calculated") {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "INVALID_STATE",
            message: "Only calculated runs can be submitted for approval."
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

      nextStatus = "pending_first_approval";
      nextFirstApprovedBy = null;
      nextFirstApprovedAt = null;
      nextFinalApprovedBy = null;
      nextFinalApprovedAt = null;
      nextSnapshot = {
        ...previousSnapshot,
        submittedAt: nowIso,
        submittedBy: profile.id,
        submittedByName: profile.full_name
      };
    }

    if (action === "approve_first") {
      if (!canFirstApprove(profile.roles)) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "Only Finance Admin and Super Admin can first-approve payroll runs."
          },
          meta: buildMeta()
        });
      }

      if (parsedRun.data.status !== "pending_first_approval") {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "INVALID_STATE",
            message: "Run must be pending first approval."
          },
          meta: buildMeta()
        });
      }

      if (parsedRun.data.initiated_by === profile.id) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "Initiator cannot perform first approval."
          },
          meta: buildMeta()
        });
      }

      nextStatus = "pending_final_approval";
      nextFirstApprovedBy = profile.id;
      nextFirstApprovedAt = nowIso;
      nextFinalApprovedBy = null;
      nextFinalApprovedAt = null;
      nextSnapshot = {
        ...previousSnapshot,
        firstApprovedAt: nowIso,
        firstApprovedBy: profile.id,
        firstApprovedByName: profile.full_name
      };
    }

    if (action === "approve_final") {
      if (!canFinalApprove(profile.roles)) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "Only Super Admin can final-approve payroll runs."
          },
          meta: buildMeta()
        });
      }

      if (parsedRun.data.status !== "pending_final_approval") {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "INVALID_STATE",
            message: "Run must be pending final approval."
          },
          meta: buildMeta()
        });
      }

      if (!parsedRun.data.first_approved_by) {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "INVALID_STATE",
            message: "Run must have first approval before final approval."
          },
          meta: buildMeta()
        });
      }

      if (parsedRun.data.first_approved_by === profile.id) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "Final approver must be different from first approver."
          },
          meta: buildMeta()
        });
      }

      nextStatus = "approved";
      nextFinalApprovedBy = profile.id;
      nextFinalApprovedAt = nowIso;
      nextSnapshot = {
        ...previousSnapshot,
        finalApprovedAt: nowIso,
        finalApprovedBy: profile.id,
        finalApprovedByName: profile.full_name,
        lockedAt: nowIso,
        lockedBy: profile.id,
        locked: true
      };
    }

    if (action === "reject") {
      if (parsedRun.data.status !== "pending_first_approval" && parsedRun.data.status !== "pending_final_approval") {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "INVALID_STATE",
            message: "Only pending approval runs can be rejected."
          },
          meta: buildMeta()
        });
      }

      if (parsedRun.data.status === "pending_first_approval") {
        if (!canFirstApprove(profile.roles)) {
          return jsonResponse<null>(403, {
            data: null,
            error: {
              code: "FORBIDDEN",
              message: "Only Finance Admin and Super Admin can reject at first approval."
            },
            meta: buildMeta()
          });
        }

        if (parsedRun.data.initiated_by === profile.id) {
          return jsonResponse<null>(403, {
            data: null,
            error: {
              code: "FORBIDDEN",
              message: "Initiator cannot reject at first approval."
            },
            meta: buildMeta()
          });
        }
      }

      if (parsedRun.data.status === "pending_final_approval") {
        if (!canFinalApprove(profile.roles)) {
          return jsonResponse<null>(403, {
            data: null,
            error: {
              code: "FORBIDDEN",
              message: "Only Super Admin can reject at final approval."
            },
            meta: buildMeta()
          });
        }

        if (parsedRun.data.first_approved_by === profile.id) {
          return jsonResponse<null>(403, {
            data: null,
            error: {
              code: "FORBIDDEN",
              message: "Final reviewer must be different from first approver."
            },
            meta: buildMeta()
          });
        }
      }

      nextStatus = "calculated";
      nextFirstApprovedBy = null;
      nextFirstApprovedAt = null;
      nextFinalApprovedBy = null;
      nextFinalApprovedAt = null;
      nextSnapshot = {
        ...previousSnapshot,
        lastRejectedAt: nowIso,
        lastRejectedBy: profile.id,
        lastRejectedByName: profile.full_name,
        lastRejectionReason: reason
      };
      nextNotes = reason;
    }

    if (action === "cancel") {
      if (!canSubmit(profile.roles)) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "Only Finance Admin and Super Admin can cancel payroll runs."
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

    const { data: updatedRun, error: updateError } = await supabase
      .from("payroll_runs")
      .update({
        status: nextStatus,
        first_approved_by: nextFirstApprovedBy,
        first_approved_at: nextFirstApprovedAt,
        final_approved_by: nextFinalApprovedBy,
        final_approved_at: nextFinalApprovedAt,
        snapshot: nextSnapshot,
        notes: nextNotes
      })
      .eq("org_id", profile.org_id)
      .eq("id", runId)
      .select(
        "id, org_id, pay_period_start, pay_period_end, pay_date, status, initiated_by, first_approved_by, first_approved_at, final_approved_by, final_approved_at, total_gross, total_net, total_deductions, total_employer_contributions, employee_count, snapshot, notes, created_at, updated_at"
      )
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

    if (action === "approve_final" && nextStatus === "approved") {
      const payPeriodLabel = formatPayPeriodLabel(
        parsedUpdated.data.pay_period_start,
        parsedUpdated.data.pay_period_end
      );

      const { data: payrollItemRows, error: payrollItemsError } = await supabase
        .from("payroll_items")
        .select("employee_id")
        .eq("org_id", profile.org_id)
        .eq("payroll_run_id", runId)
        .is("deleted_at", null);

      if (payrollItemsError) {
        console.error("Unable to load payroll notification recipients.", {
          runId,
          message: payrollItemsError.message
        });
      } else {
        const employeeIds = [...new Set((payrollItemRows ?? [])
          .map((row) => row.employee_id)
          .filter((value): value is string => typeof value === "string"))];

        await createBulkNotifications({
          orgId: profile.org_id,
          userIds: employeeIds,
          type: "payslip_ready",
          title: "Payslip ready",
          body: `Your payslip for ${payPeriodLabel} is ready.`,
          link: "/me/pay?tab=payslips"
        });

        void Promise.all(
          employeeIds.map((employeeId) =>
            sendPayslipReadyEmail({
              orgId: profile.org_id,
              userId: employeeId,
              payPeriod: payPeriodLabel
            })
          )
        );
      }
    }

    const responseRun: PayrollRunSummary = toPayrollRunSummary(
      parsedUpdated.data,
      parsedUpdated.data.initiated_by === profile.id
        ? profile.full_name
        : null
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
