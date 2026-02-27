import { z } from "zod";

import { logAudit } from "../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createBulkNotifications } from "../../../../../lib/notifications/service";
import { isIsoMonth, monthDateRange } from "../../../../../lib/expenses";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type {
  ExpenseApprovalsResponseData,
  ExpenseBulkApprovePayload,
  ExpenseBulkApproveResponseData
} from "../../../../../types/expenses";
import {
  buildMeta,
  canApproveExpenses,
  collectProfileIds,
  expenseRowSchema,
  isExpenseAdmin,
  jsonResponse,
  profileRowSchema,
  toExpenseRecord
} from "../_helpers";

const approvalsQuerySchema = z.object({
  month: z
    .string()
    .optional()
    .refine((value) => (value ? isIsoMonth(value) : true), "Month must be in YYYY-MM format")
});

const bulkApprovePayloadSchema = z.object({
  expenseIds: z.array(z.string().uuid()).min(1, "Select at least one expense to approve.").max(200)
});

async function listManagerReportIds({
  supabase,
  orgId,
  managerId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
  managerId: string;
}): Promise<string[]> {
  const { data: rows, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("org_id", orgId)
    .eq("manager_id", managerId)
    .is("deleted_at", null);

  if (error || !rows) {
    return [];
  }

  return rows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string");
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view expense approvals."
      },
      meta: buildMeta()
    });
  }

  if (!canApproveExpenses(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to view expense approvals."
      },
      meta: buildMeta()
    });
  }

  const requestUrl = new URL(request.url);
  const parsedQuery = approvalsQuerySchema.safeParse(
    Object.fromEntries(requestUrl.searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid approvals query."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const query = parsedQuery.data;
  const adminScope = isExpenseAdmin(session.profile.roles);

  let allowedEmployeeIds: string[] = [];

  if (!adminScope) {
    allowedEmployeeIds = await listManagerReportIds({
      supabase,
      orgId: session.profile.org_id,
      managerId: session.profile.id
    });

    if (allowedEmployeeIds.length === 0) {
      return jsonResponse<ExpenseApprovalsResponseData>(200, {
        data: {
          expenses: [],
          pendingCount: 0,
          pendingAmount: 0
        },
        error: null,
        meta: buildMeta()
      });
    }
  }

  let expenseQuery = supabase
    .from("expenses")
    .select(
      "id, org_id, employee_id, category, description, amount, currency, receipt_file_path, expense_date, status, approved_by, approved_at, rejected_by, rejected_at, rejection_reason, reimbursed_by, reimbursed_at, reimbursement_reference, reimbursement_notes, created_at, updated_at"
    )
    .eq("org_id", session.profile.org_id)
    .eq("status", "pending")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (!adminScope) {
    expenseQuery = expenseQuery.in("employee_id", allowedEmployeeIds);
  }

  if (query.month) {
    const range = monthDateRange(query.month);

    if (!range) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Month must be in YYYY-MM format."
        },
        meta: buildMeta()
      });
    }

    expenseQuery = expenseQuery.gte("expense_date", range.startDate).lte("expense_date", range.endDate);
  }

  const { data: rawExpenses, error: expensesError } = await expenseQuery;

  if (expensesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_APPROVALS_FETCH_FAILED",
        message: "Unable to load pending expenses."
      },
      meta: buildMeta()
    });
  }

  const parsedExpenses = z.array(expenseRowSchema).safeParse(rawExpenses ?? []);

  if (!parsedExpenses.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_APPROVALS_PARSE_FAILED",
        message: "Pending expenses are not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const profileIds = collectProfileIds(parsedExpenses.data);
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
        code: "EXPENSE_APPROVAL_PROFILES_FETCH_FAILED",
        message: "Unable to resolve expense profile metadata."
      },
      meta: buildMeta()
    });
  }

  const parsedProfiles = z.array(profileRowSchema).safeParse(rawProfiles ?? []);

  if (!parsedProfiles.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_APPROVAL_PROFILES_PARSE_FAILED",
        message: "Expense profile metadata is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const profileById = new Map(parsedProfiles.data.map((row) => [row.id, row] as const));
  const expenses = parsedExpenses.data.map((row) => toExpenseRecord(row, profileById));
  const pendingAmount = expenses.reduce((sum, expense) => sum + expense.amount, 0);

  const responseData: ExpenseApprovalsResponseData = {
    expenses,
    pendingCount: expenses.length,
    pendingAmount
  };

  return jsonResponse<ExpenseApprovalsResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to approve expenses."
      },
      meta: buildMeta()
    });
  }

  if (!canApproveExpenses(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to bulk approve expenses."
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

  const parsedPayload = bulkApprovePayloadSchema.safeParse(body);

  if (!parsedPayload.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedPayload.error.issues[0]?.message ?? "Invalid bulk approval payload."
      },
      meta: buildMeta()
    });
  }

  const payload: ExpenseBulkApprovePayload = parsedPayload.data;
  const supabase = await createSupabaseServerClient();
  const adminScope = isExpenseAdmin(session.profile.roles);
  const nowIso = new Date().toISOString();

  const { data: rawTargetRows, error: targetRowsError } = await supabase
    .from("expenses")
    .select(
      "id, org_id, employee_id, category, description, amount, currency, receipt_file_path, expense_date, status, approved_by, approved_at, rejected_by, rejected_at, rejection_reason, reimbursed_by, reimbursed_at, reimbursement_reference, reimbursement_notes, created_at, updated_at"
    )
    .eq("org_id", session.profile.org_id)
    .in("id", payload.expenseIds)
    .eq("status", "pending")
    .is("deleted_at", null);

  if (targetRowsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_APPROVAL_FETCH_FAILED",
        message: "Unable to load selected expenses."
      },
      meta: buildMeta()
    });
  }

  const parsedTargetRows = z.array(expenseRowSchema).safeParse(rawTargetRows ?? []);

  if (!parsedTargetRows.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_APPROVAL_PARSE_FAILED",
        message: "Selected expenses are not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  let allowedRows = parsedTargetRows.data;

  if (!adminScope) {
    const reportIds = await listManagerReportIds({
      supabase,
      orgId: session.profile.org_id,
      managerId: session.profile.id
    });

    const reportIdSet = new Set(reportIds);
    allowedRows = allowedRows.filter((row) => reportIdSet.has(row.employee_id));
  }

  const allowedIds = allowedRows.map((row) => row.id);
  const skippedIds = payload.expenseIds.filter((id) => !allowedIds.includes(id));

  if (allowedIds.length === 0) {
    return jsonResponse<ExpenseBulkApproveResponseData>(200, {
      data: {
        expenses: [],
        approvedCount: 0,
        skippedIds
      },
      error: null,
      meta: buildMeta()
    });
  }

  const { data: updatedRowsRaw, error: updatedRowsError } = await supabase
    .from("expenses")
    .update({
      status: "approved",
      approved_by: session.profile.id,
      approved_at: nowIso,
      rejected_by: null,
      rejected_at: null,
      rejection_reason: null
    })
    .eq("org_id", session.profile.org_id)
    .in("id", allowedIds)
    .select(
      "id, org_id, employee_id, category, description, amount, currency, receipt_file_path, expense_date, status, approved_by, approved_at, rejected_by, rejected_at, rejection_reason, reimbursed_by, reimbursed_at, reimbursement_reference, reimbursement_notes, created_at, updated_at"
    );

  if (updatedRowsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_BULK_APPROVE_FAILED",
        message: "Unable to approve selected expenses."
      },
      meta: buildMeta()
    });
  }

  const parsedUpdatedRows = z.array(expenseRowSchema).safeParse(updatedRowsRaw ?? []);

  if (!parsedUpdatedRows.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_BULK_APPROVE_PARSE_FAILED",
        message: "Approved expenses are not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const profileIds = collectProfileIds(parsedUpdatedRows.data);
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
        code: "EXPENSE_BULK_APPROVE_PROFILES_FETCH_FAILED",
        message: "Unable to resolve profile metadata for approved expenses."
      },
      meta: buildMeta()
    });
  }

  const parsedProfiles = z.array(profileRowSchema).safeParse(rawProfiles ?? []);

  if (!parsedProfiles.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_BULK_APPROVE_PROFILES_PARSE_FAILED",
        message: "Approved expense profile metadata is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const profileById = new Map(parsedProfiles.data.map((row) => [row.id, row] as const));
  const expenses = parsedUpdatedRows.data.map((row) => toExpenseRecord(row, profileById));
  const approvedEmployeeIds = [...new Set(expenses.map((expense) => expense.employeeId))];

  await logAudit({
    action: "approved",
    tableName: "expenses",
    recordId: null,
    oldValue: null,
    newValue: {
      bulk: true,
      approvedCount: expenses.length,
      expenseIds: allowedIds
    }
  });

  await createBulkNotifications({
    orgId: session.profile.org_id,
    userIds: approvedEmployeeIds,
    type: "expense_status",
    title: "Expense approved",
    body: "Your expense submission has been approved.",
    link: "/expenses"
  });

  const responseData: ExpenseBulkApproveResponseData = {
    expenses,
    approvedCount: expenses.length,
    skippedIds
  };

  return jsonResponse<ExpenseBulkApproveResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
