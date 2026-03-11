import { z } from "zod";

import { createSupabaseServerClient } from "../../../../lib/supabase/server";

export const expenseCommentTypeSchema = z.enum(["request_info", "response"]);

const latestExpenseCommentRowSchema = z.object({
  expense_id: z.string().uuid(),
  comment_type: expenseCommentTypeSchema,
  created_at: z.string(),
  author_id: z.string().uuid()
});

export type ExpenseInfoRequestState = "none" | "requested" | "responded";

export type ExpenseLatestCommentState = {
  state: ExpenseInfoRequestState;
  updatedAt: string | null;
  updatedBy: string | null;
};

export function infoRequestStateFromCommentType(
  commentType: z.infer<typeof expenseCommentTypeSchema>
): ExpenseInfoRequestState {
  return commentType === "request_info" ? "requested" : "responded";
}

export async function loadLatestExpenseCommentStates({
  supabase,
  orgId,
  expenseIds
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
  expenseIds: string[];
}): Promise<Map<string, ExpenseLatestCommentState>> {
  const result = new Map<string, ExpenseLatestCommentState>();

  if (expenseIds.length === 0) {
    return result;
  }

  const { data: rawRows, error } = await supabase
    .from("expense_comments")
    .select("expense_id, comment_type, created_at, author_id")
    .eq("org_id", orgId)
    .in("expense_id", expenseIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return result;
  }

  const parsedRows = z.array(latestExpenseCommentRowSchema).safeParse(rawRows ?? []);

  if (!parsedRows.success) {
    return result;
  }

  for (const row of parsedRows.data) {
    if (result.has(row.expense_id)) {
      continue;
    }

    result.set(row.expense_id, {
      state: infoRequestStateFromCommentType(row.comment_type),
      updatedAt: row.created_at,
      updatedBy: row.author_id
    });
  }

  return result;
}
