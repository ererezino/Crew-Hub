import "server-only";

import { z } from "zod";

import type { SessionProfile } from "../auth/session";
import { monthDateRange, summarizeExpenses } from "../expenses";
import { createSupabaseServerClient } from "../supabase/server";
import {
  collectProfileIds,
  expenseRowSchema,
  expenseSelectColumns,
  profileRowSchema,
  toExpenseRecord
} from "../../app/api/v1/expenses/_helpers";
import { loadLatestExpenseCommentStates } from "../../app/api/v1/expenses/_comment-state";
import type { ExpensesListResponseData } from "../../types/expenses";

/* ── Types ── */

export type ExpensesQuery = {
  status?: string;
  month?: string;
};

/* ── Main data-fetching function ── */

/**
 * Fetch the Expenses list for the given session profile and query filters.
 * Returns the same `ExpensesListResponseData` shape the client expects.
 * Throws on unrecoverable errors so the caller can handle them.
 */
export async function fetchExpensesData(
  profile: SessionProfile,
  query: ExpensesQuery = {}
): Promise<ExpensesListResponseData> {
  const supabase = await createSupabaseServerClient();

  let expenseQuery = supabase
    .from("expenses")
    .select(expenseSelectColumns)
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (query.status) {
    expenseQuery = expenseQuery.eq("status", query.status);
  }

  if (query.month) {
    const range = monthDateRange(query.month);

    if (range) {
      expenseQuery = expenseQuery
        .gte("expense_date", range.startDate)
        .lte("expense_date", range.endDate);
    }
  }

  const { data: rawExpenses, error: expensesError } = await expenseQuery;

  if (expensesError) {
    throw new Error("Unable to load expenses.");
  }

  const parsedExpenses = z.array(expenseRowSchema).safeParse(rawExpenses ?? []);

  if (!parsedExpenses.success) {
    throw new Error("Expense records are not in the expected shape.");
  }

  const latestCommentStates = await loadLatestExpenseCommentStates({
    supabase,
    orgId: profile.org_id,
    expenseIds: parsedExpenses.data.map((row) => row.id)
  });

  const commentAuthorIds = [
    ...new Set(
      [...latestCommentStates.values()]
        .map((state) => state.updatedBy)
        .filter((id): id is string => Boolean(id))
    )
  ];

  const profileIds = [
    ...new Set([...collectProfileIds(parsedExpenses.data), ...commentAuthorIds])
  ];
  let profileById = new Map<string, z.infer<typeof profileRowSchema>>();

  if (profileIds.length > 0) {
    const { data: rawProfiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name, department, country_code, manager_id")
      .eq("org_id", profile.org_id)
      .is("deleted_at", null)
      .in("id", profileIds);

    if (profilesError) {
      throw new Error("Unable to resolve expense profile metadata.");
    }

    const parsedProfiles = z.array(profileRowSchema).safeParse(rawProfiles ?? []);

    if (!parsedProfiles.success) {
      throw new Error("Expense profile metadata is not in the expected shape.");
    }

    profileById = new Map(
      parsedProfiles.data.map((row) => [row.id, row] as const)
    );
  }

  const expenses = parsedExpenses.data.map((row) => {
    const baseExpense = toExpenseRecord(row, profileById);
    const commentState = latestCommentStates.get(row.id);

    if (!commentState) {
      return baseExpense;
    }

    return {
      ...baseExpense,
      infoRequestState: commentState.state,
      infoRequestUpdatedAt: commentState.updatedAt,
      infoRequestUpdatedByName: commentState.updatedBy
        ? profileById.get(commentState.updatedBy)?.full_name ?? null
        : null
    };
  });

  const summary = summarizeExpenses(expenses);

  return {
    expenses,
    summary,
    month: query.month ?? null
  };
}
