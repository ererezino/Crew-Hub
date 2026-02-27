import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import {
  currentMonthKey,
  getExpenseCategoryLabel,
  isIsoMonth,
  monthDateRange
} from "../../../../../lib/expenses";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ExpenseReportsResponseData } from "../../../../../types/expenses";
import {
  buildMeta,
  canViewExpenseReports,
  expenseRowSchema,
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
    .select(
      "id, org_id, employee_id, category, description, amount, currency, receipt_file_path, expense_date, status, approved_by, approved_at, rejected_by, rejected_at, rejection_reason, reimbursed_by, reimbursed_at, reimbursement_reference, reimbursement_notes, created_at, updated_at"
    )
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

  const employeeIds = [...new Set(parsedExpenses.data.map((expense) => expense.employee_id))];
  const { data: rawProfiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, full_name, department, country_code, manager_id")
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .in("id", employeeIds);

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

  let pendingAmount = 0;
  let reimbursedAmount = 0;
  let totalAmount = 0;

  for (const expense of parsedExpenses.data) {
    const amount = typeof expense.amount === "number" ? expense.amount : Number.parseInt(expense.amount, 10);
    const safeAmount = Number.isFinite(amount) ? Math.trunc(amount) : 0;
    totalAmount += safeAmount;

    if (expense.status === "pending") {
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
      "Status"
    ];

    const csvRows = parsedExpenses.data.map((expense) => {
      const profile = profileById.get(expense.employee_id);
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
        expense.status
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

  const responseData: ExpenseReportsResponseData = {
    month,
    totals: {
      expenseCount: parsedExpenses.data.length,
      totalAmount,
      pendingAmount,
      reimbursedAmount
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
