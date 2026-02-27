import { z } from "zod";

import { logAudit } from "../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createNotification } from "../../../../../lib/notifications/service";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type {
  ExpenseAction,
  ExpenseMutationResponseData,
  UpdateExpensePayload
} from "../../../../../types/expenses";
import {
  buildMeta,
  canApproveExpenses,
  canReimburseExpenses,
  collectProfileIds,
  expenseRowSchema,
  jsonResponse,
  profileRowSchema,
  toExpenseRecord,
  isExpenseAdmin
} from "../_helpers";

const expenseActionSchema = z.object({
  action: z.enum(["approve", "reject", "cancel", "mark_reimbursed"]),
  rejectionReason: z.string().trim().max(2000).optional(),
  reimbursementReference: z.string().trim().max(120).optional(),
  reimbursementNotes: z.string().trim().max(2000).optional()
});

const profileManagerSchema = z.object({
  id: z.string().uuid(),
  manager_id: z.string().uuid().nullable()
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
    .select(
      "id, org_id, employee_id, category, description, amount, currency, receipt_file_path, expense_date, status, approved_by, approved_at, rejected_by, rejected_at, rejection_reason, reimbursed_by, reimbursed_at, reimbursement_reference, reimbursement_notes, created_at, updated_at"
    )
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
  const canManageAsAdmin = isExpenseAdmin(session.profile.roles);
  const hasManagerApprovalAccess =
    hasRole(session.profile.roles, "MANAGER") || canManageAsAdmin;
  const hasReimbursementAccess = canReimburseExpenses(session.profile.roles);

  let managerOwnsEmployee = false;

  if (!canManageAsAdmin && hasManagerApprovalAccess) {
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
      parsedEmployeeProfile.data.manager_id === session.profile.id;
  }

  const canApproveThisExpense = canManageAsAdmin || managerOwnsEmployee;
  const canCancelAsOwner = session.profile.id === expense.employee_id;
  const nowIso = new Date().toISOString();

  let updatePayload: Record<string, unknown> | null = null;

  if (payload.action === "approve") {
    if (!canApproveExpenses(session.profile.roles) || !canApproveThisExpense) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "You are not allowed to approve this expense."
        },
        meta: buildMeta()
      });
    }

    if (expense.status !== "pending") {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "INVALID_STATE",
          message: "Only pending expenses can be approved."
        },
        meta: buildMeta()
      });
    }

    updatePayload = {
      status: "approved",
      approved_by: session.profile.id,
      approved_at: nowIso,
      rejected_by: null,
      rejected_at: null,
      rejection_reason: null
    };
  }

  if (payload.action === "reject") {
    if (!canApproveExpenses(session.profile.roles) || !canApproveThisExpense) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "You are not allowed to reject this expense."
        },
        meta: buildMeta()
      });
    }

    if (expense.status !== "pending") {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "INVALID_STATE",
          message: "Only pending expenses can be rejected."
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
      approved_by: null,
      approved_at: null
    };
  }

  if (payload.action === "cancel") {
    if (!canCancelAsOwner && !canManageAsAdmin) {
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

  if (payload.action === "mark_reimbursed") {
    if (!hasReimbursementAccess) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "Only Finance Admin and Super Admin can mark reimbursements."
        },
        meta: buildMeta()
      });
    }

    if (expense.status !== "approved") {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "INVALID_STATE",
          message: "Only approved expenses can be reimbursed."
        },
        meta: buildMeta()
      });
    }

    updatePayload = {
      status: "reimbursed",
      reimbursed_by: session.profile.id,
      reimbursed_at: nowIso,
      reimbursement_reference: payload.reimbursementReference?.trim() || null,
      reimbursement_notes: payload.reimbursementNotes?.trim() || null
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
    .select(
      "id, org_id, employee_id, category, description, amount, currency, receipt_file_path, expense_date, status, approved_by, approved_at, rejected_by, rejected_at, rejection_reason, reimbursed_by, reimbursed_at, reimbursement_reference, reimbursement_notes, created_at, updated_at"
    )
    .single();

  if (updateExpenseError || !updatedExpenseRaw) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_UPDATE_FAILED",
        message: "Unable to update expense."
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
      approvedBy: expense.approved_by,
      approvedAt: expense.approved_at,
      rejectedBy: expense.rejected_by,
      rejectedAt: expense.rejected_at,
      reimbursedBy: expense.reimbursed_by,
      reimbursedAt: expense.reimbursed_at
    },
    newValue: {
      status: updatedExpense.status,
      approvedBy: updatedExpense.approvedBy,
      approvedAt: updatedExpense.approvedAt,
      rejectedBy: updatedExpense.rejectedBy,
      rejectedAt: updatedExpense.rejectedAt,
      reimbursedBy: updatedExpense.reimbursedBy,
      reimbursedAt: updatedExpense.reimbursedAt
    }
  });

  if (payload.action === "approve" || payload.action === "reject") {
    await createNotification({
      orgId: session.profile.org_id,
      userId: updatedExpense.employeeId,
      type: "expense_status",
      title:
        payload.action === "approve"
          ? "Expense approved"
          : "Expense rejected",
      body:
        payload.action === "approve"
          ? `${updatedExpense.category} expense for ${updatedExpense.expenseDate} was approved.`
          : `${updatedExpense.category} expense for ${updatedExpense.expenseDate} was rejected.${payload.rejectionReason ? ` Reason: ${payload.rejectionReason}` : ""}`,
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
