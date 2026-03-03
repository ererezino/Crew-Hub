import { z } from "zod";

import { logAudit } from "../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createBulkNotifications, createNotification } from "../../../../../lib/notifications/service";
import { parseIntegerAmount } from "../../../../../lib/expenses";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type {
  ExpenseAction,
  ExpenseMutationResponseData,
  UpdateExpensePayload
} from "../../../../../types/expenses";
import {
  buildMeta,
  canFinanceApproveExpenses,
  canManagerApproveExpenses,
  collectProfileIds,
  expenseRowSchema,
  expenseSelectColumns,
  jsonResponse,
  profileRowSchema,
  toExpenseRecord
} from "../_helpers";

const expenseActionSchema = z.object({
  action: z.enum(["approve", "reject", "cancel", "mark_reimbursed"]),
  rejectionReason: z.string().trim().max(2000).optional(),
  financeRejectionReason: z.string().trim().max(2000).optional(),
  reimbursementReference: z.string().trim().max(120).optional(),
  reimbursementNotes: z.string().trim().max(2000).optional(),
  reimbursementReceiptPath: z.string().trim().optional()
});

const profileManagerSchema = z.object({
  id: z.string().uuid(),
  manager_id: z.string().uuid().nullable()
});

const approverProfileSchema = z.object({
  id: z.string().uuid(),
  roles: z.array(z.string()).nullable()
});

function auditActionFromExpenseAction(action: ExpenseAction): "approved" | "rejected" | "cancelled" | "updated" {
  switch (action) {
    case "approve":
      return "approved";
    case "reject":
      return "rejected";
    case "cancel":
      return "cancelled";
    case "mark_reimbursed":
      return "updated";
    default:
      return "updated";
  }
}

function formatMinorUnits(amount: number, currency: string): string {
  const safeAmount = parseIntegerAmount(amount);
  const major = safeAmount / 100;

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(2)}`;
  }
}

async function listFinanceAdminIds({
  supabase,
  orgId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
}): Promise<string[]> {
  const { data: rawRows, error } = await supabase
    .from("profiles")
    .select("id, roles")
    .eq("org_id", orgId)
    .is("deleted_at", null);

  if (error) {
    console.error("Unable to load finance approver recipients.", {
      orgId,
      message: error.message
    });

    return [];
  }

  const parsedRows = z.array(approverProfileSchema).safeParse(rawRows ?? []);

  if (!parsedRows.success) {
    return [];
  }

  return parsedRows.data
    .filter((row) => row.roles?.includes("FINANCE_ADMIN"))
    .map((row) => row.id);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to update expenses."
      },
      meta: buildMeta()
    });
  }

  const { id: expenseId } = await params;

  if (!expenseId) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Expense id is required."
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

  const parsedBody = expenseActionSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid expense update payload."
      },
      meta: buildMeta()
    });
  }

  const payload: UpdateExpensePayload = parsedBody.data;
  const supabase = await createSupabaseServerClient();

  const { data: rawExpenseRow, error: expenseError } = await supabase
    .from("expenses")
    .select(expenseSelectColumns)
    .eq("id", expenseId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (expenseError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_FETCH_FAILED",
        message: "Unable to load expense record."
      },
      meta: buildMeta()
    });
  }

  const parsedExpense = expenseRowSchema.safeParse(rawExpenseRow);

  if (!parsedExpense.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Expense was not found."
      },
      meta: buildMeta()
    });
  }

  const expense = parsedExpense.data;
  const isSuperAdmin = hasRole(session.profile.roles, "SUPER_ADMIN");
  const hasManagerApprovalAccess = canManagerApproveExpenses(session.profile.roles);
  const hasFinanceApprovalAccess = canFinanceApproveExpenses(session.profile.roles);
  const canCancelAsOwner = session.profile.id === expense.employee_id;
  const nowIso = new Date().toISOString();

  let managerOwnsEmployee = false;
  if (!isSuperAdmin && hasManagerApprovalAccess) {
    const { data: rawEmployeeProfile, error: employeeProfileError } = await supabase
      .from("profiles")
      .select("id, manager_id")
      .eq("id", expense.employee_id)
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (employeeProfileError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "EXPENSE_MANAGER_SCOPE_FAILED",
          message: "Unable to verify manager approval scope."
        },
        meta: buildMeta()
      });
    }

    const parsedEmployeeProfile = profileManagerSchema.safeParse(rawEmployeeProfile);
    managerOwnsEmployee =
      parsedEmployeeProfile.success &&
      parsedEmployeeProfile.data.manager_id === session.profile.id &&
      parsedEmployeeProfile.data.id !== session.profile.id;
  }

  const canManagerApproveThisExpense = isSuperAdmin || managerOwnsEmployee;
  const normalizedAction: ExpenseAction =
    payload.action === "mark_reimbursed" ? "approve" : payload.action;

  let updatePayload: Record<string, unknown> | null = null;

  if (normalizedAction === "approve") {
    if (expense.status === "pending") {
      if (!hasManagerApprovalAccess || !canManagerApproveThisExpense) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "Only a direct manager or Super Admin can manager-approve this expense."
          },
          meta: buildMeta()
        });
      }

      if (session.profile.id === expense.employee_id) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "You cannot approve your own expense."
          },
          meta: buildMeta()
        });
      }

      updatePayload = {
        status: "manager_approved",
        manager_approved_by: session.profile.id,
        manager_approved_at: nowIso,
        approved_by: session.profile.id,
        approved_at: nowIso,
        rejected_by: null,
        rejected_at: null,
        rejection_reason: null,
        finance_rejected_by: null,
        finance_rejected_at: null,
        finance_rejection_reason: null
      };
    } else if (expense.status === "manager_approved" || expense.status === "approved") {
      if (!hasFinanceApprovalAccess) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "Only Finance Admin or Super Admin can disburse this expense."
          },
          meta: buildMeta()
        });
      }

      const reimbursementReference = payload.reimbursementReference?.trim();

      if (!reimbursementReference) {
        return jsonResponse<null>(422, {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: "Reimbursement reference is required for finance disbursement."
          },
          meta: buildMeta()
        });
      }

      updatePayload = {
        status: "reimbursed",
        finance_approved_by: session.profile.id,
        finance_approved_at: nowIso,
        reimbursed_by: session.profile.id,
        reimbursed_at: nowIso,
        reimbursement_reference: reimbursementReference,
        reimbursement_notes: payload.reimbursementNotes?.trim() || null,
        reimbursement_receipt_path: payload.reimbursementReceiptPath?.trim() || null,
        finance_rejected_by: null,
        finance_rejected_at: null,
        finance_rejection_reason: null
      };
    } else {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "INVALID_STATE",
          message: "Expense cannot be approved from the current status."
        },
        meta: buildMeta()
      });
    }
  }

  if (normalizedAction === "reject") {
    if (expense.status === "pending") {
      if (!hasManagerApprovalAccess || !canManagerApproveThisExpense) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "Only a direct manager or Super Admin can reject this pending expense."
          },
          meta: buildMeta()
        });
      }

      if (!payload.rejectionReason || payload.rejectionReason.trim().length === 0) {
        return jsonResponse<null>(422, {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: "Rejection reason is required."
          },
          meta: buildMeta()
        });
      }

      updatePayload = {
        status: "rejected",
        rejected_by: session.profile.id,
        rejected_at: nowIso,
        rejection_reason: payload.rejectionReason.trim(),
        manager_approved_by: null,
        manager_approved_at: null,
        approved_by: null,
        approved_at: null,
        finance_approved_by: null,
        finance_approved_at: null,
        finance_rejected_by: null,
        finance_rejected_at: null,
        finance_rejection_reason: null
      };
    } else if (expense.status === "manager_approved" || expense.status === "approved") {
      if (!hasFinanceApprovalAccess) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "Only Finance Admin or Super Admin can issue a finance rejection."
          },
          meta: buildMeta()
        });
      }

      const financeRejectionReason = payload.financeRejectionReason?.trim();

      if (!financeRejectionReason) {
        return jsonResponse<null>(422, {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: "Finance rejection reason is required."
          },
          meta: buildMeta()
        });
      }

      updatePayload = {
        status: "finance_rejected",
        finance_rejected_by: session.profile.id,
        finance_rejected_at: nowIso,
        finance_rejection_reason: financeRejectionReason,
        finance_approved_by: null,
        finance_approved_at: null,
        reimbursed_by: null,
        reimbursed_at: null,
        reimbursement_reference: null,
        reimbursement_notes: null
      };
    } else {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "INVALID_STATE",
          message: "Expense cannot be rejected from the current status."
        },
        meta: buildMeta()
      });
    }
  }

  if (normalizedAction === "cancel") {
    if (!canCancelAsOwner && !isSuperAdmin) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "You are not allowed to cancel this expense."
        },
        meta: buildMeta()
      });
    }

    if (expense.status !== "pending") {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "INVALID_STATE",
          message: "Only pending expenses can be cancelled."
        },
        meta: buildMeta()
      });
    }

    updatePayload = {
      status: "cancelled"
    };
  }

  if (!updatePayload) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Unsupported expense action."
      },
      meta: buildMeta()
    });
  }

  const { data: updatedExpenseRaw, error: updateExpenseError } = await supabase
    .from("expenses")
    .update(updatePayload)
    .eq("id", expenseId)
    .eq("org_id", session.profile.org_id)
    .select(expenseSelectColumns)
    .single();

  if (updateExpenseError || !updatedExpenseRaw) {
    const isPermissionError = updateExpenseError?.code === "42501" || updateExpenseError?.code === "PGRST301";

    return jsonResponse<null>(isPermissionError ? 403 : 500, {
      data: null,
      error: {
        code: isPermissionError ? "FORBIDDEN" : "EXPENSE_UPDATE_FAILED",
        message: isPermissionError
          ? "You are not allowed to perform this expense transition."
          : "Unable to update expense."
      },
      meta: buildMeta()
    });
  }

  const parsedUpdatedExpense = expenseRowSchema.safeParse(updatedExpenseRaw);

  if (!parsedUpdatedExpense.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_PARSE_FAILED",
        message: "Updated expense is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const profileIds = collectProfileIds([parsedUpdatedExpense.data]);
  const { data: rawProfiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, full_name, department, country_code, manager_id")
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .in("id", profileIds);

  if (profilesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_PROFILE_FETCH_FAILED",
        message: "Unable to resolve profile metadata for updated expense."
      },
      meta: buildMeta()
    });
  }

  const parsedProfiles = z.array(profileRowSchema).safeParse(rawProfiles ?? []);

  if (!parsedProfiles.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_PROFILE_PARSE_FAILED",
        message: "Expense profile metadata is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const profileById = new Map(parsedProfiles.data.map((row) => [row.id, row] as const));
  const updatedExpense = toExpenseRecord(parsedUpdatedExpense.data, profileById);

  await logAudit({
    action: auditActionFromExpenseAction(payload.action),
    tableName: "expenses",
    recordId: updatedExpense.id,
    oldValue: {
      status: expense.status,
      managerApprovedBy: expense.manager_approved_by,
      managerApprovedAt: expense.manager_approved_at,
      financeApprovedBy: expense.finance_approved_by,
      financeApprovedAt: expense.finance_approved_at,
      financeRejectedBy: expense.finance_rejected_by,
      financeRejectedAt: expense.finance_rejected_at,
      approvedBy: expense.approved_by,
      approvedAt: expense.approved_at,
      rejectedBy: expense.rejected_by,
      rejectedAt: expense.rejected_at,
      reimbursedBy: expense.reimbursed_by,
      reimbursedAt: expense.reimbursed_at,
      reimbursementReference: expense.reimbursement_reference
    },
    newValue: {
      status: updatedExpense.status,
      managerApprovedBy: updatedExpense.managerApprovedBy,
      managerApprovedAt: updatedExpense.managerApprovedAt,
      financeApprovedBy: updatedExpense.financeApprovedBy,
      financeApprovedAt: updatedExpense.financeApprovedAt,
      financeRejectedBy: updatedExpense.financeRejectedBy,
      financeRejectedAt: updatedExpense.financeRejectedAt,
      approvedBy: updatedExpense.approvedBy,
      approvedAt: updatedExpense.approvedAt,
      rejectedBy: updatedExpense.rejectedBy,
      rejectedAt: updatedExpense.rejectedAt,
      reimbursedBy: updatedExpense.reimbursedBy,
      reimbursedAt: updatedExpense.reimbursedAt,
      reimbursementReference: updatedExpense.reimbursementReference
    }
  });

  if (normalizedAction === "approve" && updatedExpense.status === "manager_approved") {
    const financeAdminUserIds = await listFinanceAdminIds({
      supabase,
      orgId: session.profile.org_id
    });

    await createNotification({
      orgId: session.profile.org_id,
      userId: updatedExpense.employeeId,
      type: "expense_status",
      title: "Expense manager-approved",
      body: `Your expense was approved by your manager and is pending finance disbursement.`,
      link: "/expenses"
    });

    await createBulkNotifications({
      orgId: session.profile.org_id,
      userIds: financeAdminUserIds.filter((userId) => userId !== updatedExpense.employeeId),
      type: "expense_status",
      title: "Expense ready for disbursement",
      body: `${updatedExpense.employeeName}'s expense was approved by a manager and is ready for finance disbursement.`,
      link: "/expenses/approvals"
    });
  }

  if (normalizedAction === "approve" && updatedExpense.status === "reimbursed") {
    const amountText = formatMinorUnits(updatedExpense.amount, updatedExpense.currency);
    const referenceText = updatedExpense.reimbursementReference ?? "N/A";

    await createNotification({
      orgId: session.profile.org_id,
      userId: updatedExpense.employeeId,
      type: "expense_status",
      title: "Expense reimbursed",
      body: `Your expense of ${amountText} has been reimbursed. Reference: ${referenceText}.`,
      link: "/expenses"
    });
  }

  if (normalizedAction === "reject" && updatedExpense.status === "rejected") {
    await createNotification({
      orgId: session.profile.org_id,
      userId: updatedExpense.employeeId,
      type: "expense_status",
      title: "Expense rejected",
      body: `Your expense was rejected.${updatedExpense.rejectionReason ? ` Reason: ${updatedExpense.rejectionReason}` : ""}`,
      link: "/expenses"
    });
  }

  if (normalizedAction === "reject" && updatedExpense.status === "finance_rejected") {
    const recipientIds = [
      updatedExpense.employeeId,
      updatedExpense.managerApprovedBy
    ].filter((id): id is string => Boolean(id));

    await createBulkNotifications({
      orgId: session.profile.org_id,
      userIds: recipientIds,
      type: "expense_status",
      title: "Expense rejected by finance",
      body: `Finance rejected this expense.${updatedExpense.financeRejectionReason ? ` Reason: ${updatedExpense.financeRejectionReason}` : ""}`,
      link: "/expenses"
    });
  }

  const responseData: ExpenseMutationResponseData = {
    expense: updatedExpense
  };

  return jsonResponse<ExpenseMutationResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
