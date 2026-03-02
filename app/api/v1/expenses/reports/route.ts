import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import {
  getExpenseStatusLabel,
  currentMonthKey,
  getExpenseCategoryLabel,
  isIsoMonth,
  monthDateRange
} from "../../../../../lib/expenses";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ExpenseReportsResponseData, ExpenseStatus } from "../../../../../types/expenses";
import {
  buildMeta,
  canViewExpenseReports,
  collectProfileIds,
  expenseRowSchema,
  expenseSelectColumns,
  isExpenseAdmin,
  jsonResponse,
  profileRowSchema
} from "../_helpers";

const reportQuerySchema = z.object({
  month: z
    .string()
    .optional()
    .refine((value) => (value ? isIsoMonth(value) : true), "Month must be in YYYY-MM format"),
  format: z.enum(["json", "csv"]).optional()
});

function csvEscape(value: string | number): string {
  const stringValue = String(value);

  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }

  return stringValue;
}

function formatDateForCsv(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? isoDate : date.toISOString().slice(0, 10);
}

async function listManagerScopeIds({
  supabase,
  orgId,
  managerId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
  managerId: string;
}): Promise<string[]> {
  const { data: reports, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("org_id", orgId)
    .eq("manager_id", managerId)
    .is("deleted_at", null);

  if (error || !reports) {
    return [managerId];
  }

  const ids = reports
    .map((row) => row.id)
    .filter((value): value is string => typeof value === "string");

  return [managerId, ...ids];
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view expense reports."
      },
      meta: buildMeta()
    });
  }

  if (!canViewExpenseReports(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to view expense reports."
      },
      meta: buildMeta()
    });
  }

  const requestUrl = new URL(request.url);
  const parsedQuery = reportQuerySchema.safeParse(
    Object.fromEntries(requestUrl.searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid reports query."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;
  const month = query.month ?? currentMonthKey();
  const range = monthDateRange(month);

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

  const supabase = await createSupabaseServerClient();
  const adminScope = isExpenseAdmin(session.profile.roles);

  let scopedEmployeeIds: string[] = [];

  if (!adminScope) {
    scopedEmployeeIds = await listManagerScopeIds({
      supabase,
      orgId: session.profile.org_id,
      managerId: session.profile.id
    });
  }

  let expensesQuery = supabase
    .from("expenses")
    .select(expenseSelectColumns)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .gte("expense_date", range.startDate)
    .lte("expense_date", range.endDate)
    .order("expense_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (!adminScope) {
    if (scopedEmployeeIds.length === 0) {
      scopedEmployeeIds = [session.profile.id];
    }

    expensesQuery = expensesQuery.in("employee_id", scopedEmployeeIds);
  }

  const { data: rawExpenses, error: expensesError } = await expensesQuery;

  if (expensesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_REPORTS_FETCH_FAILED",
        message: "Unable to load expense reports."
      },
      meta: buildMeta()
    });
  }

  const parsedExpenses = z.array(expenseRowSchema).safeParse(rawExpenses ?? []);

  if (!parsedExpenses.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_REPORTS_PARSE_FAILED",
        message: "Expense report data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  if (parsedExpenses.data.length === 0) {
    const emptyResponse: ExpenseReportsResponseData = {
      month,
      totals: {
        expenseCount: 0,
        totalAmount: 0,
        pendingAmount: 0,
        reimbursedAmount: 0
      },
      statusBreakdown: [],
      timings: {
        avgSubmissionToManagerApprovalHours: null,
        avgManagerApprovalToDisbursementHours: null
      },
      byCategory: [],
      byEmployee: [],
      byDepartment: []
    };

    if (query.format === "csv") {
      const csvHeader = [
        "Month",
        "Expense Date",
        "Employee",
        "Department",
        "Category",
        "Description",
        "Amount (minor units)",
        "Currency",
        "Status",
        "Manager Approved By",
        "Manager Approved At",
        "Finance Approved By",
        "Finance Approved At",
        "Finance Rejected By",
        "Finance Rejected At",
        "Finance Rejection Reason",
        "Reimbursement Reference",
        "Reimbursed At"
      ];
      const fileName = `crew-hub-expenses-${month}.csv`;

      return new Response(csvHeader.join(","), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename=\"${fileName}\"`
        }
      });
    }

    return jsonResponse<ExpenseReportsResponseData>(200, {
      data: emptyResponse,
      error: null,
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
        code: "EXPENSE_REPORTS_PROFILES_FETCH_FAILED",
        message: "Unable to load profile metadata for expense reports."
      },
      meta: buildMeta()
    });
  }

  const parsedProfiles = z.array(profileRowSchema).safeParse(rawProfiles ?? []);

  if (!parsedProfiles.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_REPORTS_PROFILES_PARSE_FAILED",
        message: "Expense report profile data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const profileById = new Map(parsedProfiles.data.map((row) => [row.id, row] as const));
  const categoryTotals = new Map<string, { label: string; totalAmount: number; count: number }>();
  const employeeTotals = new Map<string, { label: string; totalAmount: number; count: number }>();
  const departmentTotals = new Map<string, { label: string; totalAmount: number; count: number }>();
  const statusTotals = new Map<string, { label: string; totalAmount: number; count: number }>();

  let pendingAmount = 0;
  let reimbursedAmount = 0;
  let totalAmount = 0;
  let submissionToManagerApprovalHoursTotal = 0;
  let submissionToManagerApprovalCount = 0;
  let managerApprovalToDisbursementHoursTotal = 0;
  let managerApprovalToDisbursementCount = 0;

  for (const expense of parsedExpenses.data) {
    const amount = typeof expense.amount === "number" ? expense.amount : Number.parseInt(expense.amount, 10);
    const safeAmount = Number.isFinite(amount) ? Math.trunc(amount) : 0;
    totalAmount += safeAmount;

    if (
      expense.status === "pending" ||
      expense.status === "manager_approved" ||
      expense.status === "approved"
    ) {
      pendingAmount += safeAmount;
    }

    if (expense.status === "reimbursed") {
      reimbursedAmount += safeAmount;
    }

    const categoryLabel = getExpenseCategoryLabel(expense.category);
    const categoryEntry = categoryTotals.get(expense.category) ?? {
      label: categoryLabel,
      totalAmount: 0,
      count: 0
    };
    categoryEntry.totalAmount += safeAmount;
    categoryEntry.count += 1;
    categoryTotals.set(expense.category, categoryEntry);

    const employeeProfile = profileById.get(expense.employee_id);
    const employeeLabel = employeeProfile?.full_name ?? "Unknown user";
    const employeeEntry = employeeTotals.get(expense.employee_id) ?? {
      label: employeeLabel,
      totalAmount: 0,
      count: 0
    };
    employeeEntry.totalAmount += safeAmount;
    employeeEntry.count += 1;
    employeeTotals.set(expense.employee_id, employeeEntry);

    const departmentLabel = employeeProfile?.department ?? "No department";
    const departmentEntry = departmentTotals.get(departmentLabel) ?? {
      label: departmentLabel,
      totalAmount: 0,
      count: 0
    };
    departmentEntry.totalAmount += safeAmount;
    departmentEntry.count += 1;
    departmentTotals.set(departmentLabel, departmentEntry);

    const statusLabel = getExpenseStatusLabel(expense.status);
    const statusEntry = statusTotals.get(expense.status) ?? {
      label: statusLabel,
      totalAmount: 0,
      count: 0
    };
    statusEntry.totalAmount += safeAmount;
    statusEntry.count += 1;
    statusTotals.set(expense.status, statusEntry);

    const submittedAt = Date.parse(expense.created_at);
    const managerApprovedAt = Date.parse(
      expense.manager_approved_at ?? expense.approved_at ?? ""
    );
    const reimbursedAt = Date.parse(expense.reimbursed_at ?? "");

    if (Number.isFinite(submittedAt) && Number.isFinite(managerApprovedAt)) {
      const elapsed = managerApprovedAt - submittedAt;
      if (elapsed >= 0) {
        submissionToManagerApprovalHoursTotal += elapsed / (1000 * 60 * 60);
        submissionToManagerApprovalCount += 1;
      }
    }

    if (Number.isFinite(managerApprovedAt) && Number.isFinite(reimbursedAt)) {
      const elapsed = reimbursedAt - managerApprovedAt;
      if (elapsed >= 0) {
        managerApprovalToDisbursementHoursTotal += elapsed / (1000 * 60 * 60);
        managerApprovalToDisbursementCount += 1;
      }
    }
  }

  if (query.format === "csv") {
    const csvHeader = [
      "Month",
      "Expense Date",
      "Employee",
      "Department",
      "Category",
      "Description",
      "Amount (minor units)",
      "Currency",
      "Status",
      "Manager Approved By",
      "Manager Approved At",
      "Finance Approved By",
      "Finance Approved At",
      "Finance Rejected By",
      "Finance Rejected At",
      "Finance Rejection Reason",
      "Reimbursement Reference",
      "Reimbursed At"
    ];

    const csvRows = parsedExpenses.data.map((expense) => {
      const profile = profileById.get(expense.employee_id);
      const managerApprover = expense.manager_approved_by
        ? profileById.get(expense.manager_approved_by)
        : expense.approved_by
          ? profileById.get(expense.approved_by)
          : null;
      const financeApprover = expense.finance_approved_by
        ? profileById.get(expense.finance_approved_by)
        : null;
      const financeRejector = expense.finance_rejected_by
        ? profileById.get(expense.finance_rejected_by)
        : null;
      const amount = typeof expense.amount === "number" ? expense.amount : Number.parseInt(expense.amount, 10);
      const safeAmount = Number.isFinite(amount) ? Math.trunc(amount) : 0;

      return [
        month,
        formatDateForCsv(expense.expense_date),
        profile?.full_name ?? "Unknown user",
        profile?.department ?? "No department",
        getExpenseCategoryLabel(expense.category),
        expense.description,
        safeAmount,
        expense.currency,
        expense.status,
        managerApprover?.full_name ?? "",
        expense.manager_approved_at ?? expense.approved_at ?? "",
        financeApprover?.full_name ?? "",
        expense.finance_approved_at ?? "",
        financeRejector?.full_name ?? "",
        expense.finance_rejected_at ?? "",
        expense.finance_rejection_reason ?? "",
        expense.reimbursement_reference ?? "",
        expense.reimbursed_at ?? ""
      ]
        .map((value) => csvEscape(value))
        .join(",");
    });

    const content = [csvHeader.join(","), ...csvRows].join("\n");
    const fileName = `crew-hub-expenses-${month}.csv`;

    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"${fileName}\"`
      }
    });
  }

  const byCategory = [...categoryTotals.entries()]
    .map(([key, value]) => ({
      key,
      label: value.label,
      totalAmount: value.totalAmount,
      count: value.count
    }))
    .sort((left, right) => right.totalAmount - left.totalAmount);

  const byEmployee = [...employeeTotals.entries()]
    .map(([key, value]) => ({
      key,
      label: value.label,
      totalAmount: value.totalAmount,
      count: value.count
    }))
    .sort((left, right) => right.totalAmount - left.totalAmount);

  const byDepartment = [...departmentTotals.entries()]
    .map(([key, value]) => ({
      key,
      label: value.label,
      totalAmount: value.totalAmount,
      count: value.count
    }))
    .sort((left, right) => right.totalAmount - left.totalAmount);

  const statusBreakdown = [...statusTotals.entries()]
    .map(([status, value]) => ({
      status: status as ExpenseStatus,
      label: value.label,
      totalAmount: value.totalAmount,
      count: value.count
    }))
    .sort((left, right) => right.totalAmount - left.totalAmount);

  const responseData: ExpenseReportsResponseData = {
    month,
    totals: {
      expenseCount: parsedExpenses.data.length,
      totalAmount,
      pendingAmount,
      reimbursedAmount
    },
    statusBreakdown,
    timings: {
      avgSubmissionToManagerApprovalHours:
        submissionToManagerApprovalCount > 0
          ? Number((submissionToManagerApprovalHoursTotal / submissionToManagerApprovalCount).toFixed(2))
          : null,
      avgManagerApprovalToDisbursementHours:
        managerApprovalToDisbursementCount > 0
          ? Number((managerApprovalToDisbursementHoursTotal / managerApprovalToDisbursementCount).toFixed(2))
          : null
    },
    byCategory,
    byEmployee,
    byDepartment
  };

  return jsonResponse<ExpenseReportsResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
