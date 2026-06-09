import "server-only";

import { z } from "zod";

import type { createSupabaseServerClient } from "../supabase/server";
import {
  expenseAttachmentRowSchema,
  expenseAttachmentSelectColumns,
  toExpenseAttachment
} from "../../app/api/v1/expenses/_helpers";
import type { ExpenseAttachment } from "../../types/expenses";

/**
 * Load all (non-deleted) attachments for the given expense IDs, grouped by
 * expense and ordered primary-first (sort_order, then created_at).
 * Returns an empty map on error or when no IDs are supplied so callers can
 * degrade gracefully to the legacy single-receipt fallback.
 */
export async function loadExpenseAttachments({
  supabase,
  orgId,
  expenseIds
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
  expenseIds: string[];
}): Promise<Map<string, ExpenseAttachment[]>> {
  const result = new Map<string, ExpenseAttachment[]>();

  if (expenseIds.length === 0) {
    return result;
  }

  const { data: rawRows, error } = await supabase
    .from("expense_attachments")
    .select(expenseAttachmentSelectColumns)
    .eq("org_id", orgId)
    .in("expense_id", expenseIds)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return result;
  }

  const parsedRows = z.array(expenseAttachmentRowSchema).safeParse(rawRows ?? []);

  if (!parsedRows.success) {
    return result;
  }

  for (const row of parsedRows.data) {
    const existing = result.get(row.expense_id);
    const attachment = toExpenseAttachment(row);

    if (existing) {
      existing.push(attachment);
    } else {
      result.set(row.expense_id, [attachment]);
    }
  }

  return result;
}
