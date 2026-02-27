import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { RECEIPTS_BUCKET_NAME } from "../../../../../../lib/expenses";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type { ExpenseReceiptSignedUrlResponseData } from "../../../../../../types/expenses";
import { buildMeta, jsonResponse } from "../../_helpers";

const expenseReceiptRowSchema = z.object({
  id: z.string().uuid(),
  receipt_file_path: z.string()
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view expense receipts."
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

  const supabase = await createSupabaseServerClient();

  const { data: rawExpenseRow, error: expenseError } = await supabase
    .from("expenses")
    .select("id, receipt_file_path")
    .eq("id", expenseId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (expenseError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_RECEIPT_FETCH_FAILED",
        message: "Unable to load expense receipt."
      },
      meta: buildMeta()
    });
  }

  const parsedExpense = expenseReceiptRowSchema.safeParse(rawExpenseRow);

  if (!parsedExpense.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Expense receipt was not found."
      },
      meta: buildMeta()
    });
  }

  const expiresInSeconds = 60;
  const { data: signedUrlResult, error: signedUrlError } = await supabase.storage
    .from(RECEIPTS_BUCKET_NAME)
    .createSignedUrl(parsedExpense.data.receipt_file_path, expiresInSeconds);

  if (signedUrlError || !signedUrlResult?.signedUrl) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_RECEIPT_SIGNED_URL_FAILED",
        message: "Unable to prepare secure receipt access."
      },
      meta: buildMeta()
    });
  }

  const responseData: ExpenseReceiptSignedUrlResponseData = {
    url: signedUrlResult.signedUrl,
    expiresInSeconds
  };

  return jsonResponse<ExpenseReceiptSignedUrlResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
