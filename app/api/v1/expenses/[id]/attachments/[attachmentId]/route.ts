import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../lib/audit";
import { RECEIPTS_BUCKET_NAME } from "../../../../../../../lib/expenses";
import { loadExpenseAttachments } from "../../../../../../../lib/expenses/fetch-expense-attachments";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../../lib/supabase/service-role";
import type {
  ExpenseAttachmentsListResponseData,
  ExpenseAttachmentWithUrl
} from "../../../../../../../types/expenses";
import {
  buildMeta,
  isExpenseAdmin,
  jsonResponse,
  toExpenseAttachment
} from "../../../_helpers";

const SIGNED_URL_TTL_SECONDS = 300;

const expenseAccessRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  receipt_file_path: z.string()
});

const attachmentRowSchema = z.object({
  id: z.string().uuid(),
  file_path: z.string()
});

async function signedUrlsFor(
  attachments: ReturnType<typeof toExpenseAttachment>[]
): Promise<ExpenseAttachmentWithUrl[]> {
  if (attachments.length === 0) {
    return [];
  }

  const storageClient = createSupabaseServiceRoleClient();
  const { data: signed } = await storageClient.storage
    .from(RECEIPTS_BUCKET_NAME)
    .createSignedUrls(
      attachments.map((attachment) => attachment.filePath),
      SIGNED_URL_TTL_SECONDS
    );

  const urlByPath = new Map<string, string>();
  for (const entry of signed ?? []) {
    if (entry.path && entry.signedUrl) {
      urlByPath.set(entry.path, entry.signedUrl);
    }
  }

  return attachments
    .map((attachment) => ({ ...attachment, url: urlByPath.get(attachment.filePath) ?? "" }))
    .filter((attachment) => attachment.url !== "");
}

/** DELETE — remove one document from an expense (at least one must remain). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in to remove documents." },
      meta: buildMeta()
    });
  }

  const { id: expenseId, attachmentId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: rawExpense } = await supabase
    .from("expenses")
    .select("id, employee_id, receipt_file_path")
    .eq("id", expenseId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  const parsedExpense = expenseAccessRowSchema.safeParse(rawExpense);

  if (!parsedExpense.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Expense not found." },
      meta: buildMeta()
    });
  }

  const isOwner = parsedExpense.data.employee_id === session.profile.id;

  if (!isOwner && !isExpenseAdmin(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "You cannot modify documents on this expense." },
      meta: buildMeta()
    });
  }

  const { data: rawAttachments } = await supabase
    .from("expense_attachments")
    .select("id, file_path")
    .eq("org_id", session.profile.org_id)
    .eq("expense_id", expenseId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const parsedAttachments = z.array(attachmentRowSchema).safeParse(rawAttachments ?? []);
  const live = parsedAttachments.success ? parsedAttachments.data : [];
  const target = live.find((attachment) => attachment.id === attachmentId);

  if (!target) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Document not found on this expense." },
      meta: buildMeta()
    });
  }

  if (live.length <= 1) {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "INVALID_STATE",
        message: "An expense must keep at least one receipt or document."
      },
      meta: buildMeta()
    });
  }

  const { error: deleteError } = await supabase
    .from("expense_attachments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", attachmentId)
    .eq("org_id", session.profile.org_id)
    .eq("expense_id", expenseId);

  if (deleteError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ATTACHMENT_DELETE_FAILED", message: "Unable to remove the document." },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "deleted",
    tableName: "expense_attachments",
    recordId: attachmentId,
    oldValue: { expenseId, filePath: target.file_path },
    newValue: { deletedBy: session.profile.id }
  });

  /* If we removed the primary document, repoint the legacy receipt_file_path at
   * the next remaining document so the expense always has a valid primary. */
  if (parsedExpense.data.receipt_file_path === target.file_path) {
    const nextPrimary = live.find((attachment) => attachment.id !== attachmentId);
    if (nextPrimary) {
      const serviceClient = createSupabaseServiceRoleClient();
      await serviceClient
        .from("expenses")
        .update({ receipt_file_path: nextPrimary.file_path })
        .eq("id", expenseId)
        .eq("org_id", session.profile.org_id);
    }
  }

  const attachmentsByExpenseId = await loadExpenseAttachments({
    supabase,
    orgId: session.profile.org_id,
    expenseIds: [expenseId]
  });

  const responseData: ExpenseAttachmentsListResponseData = {
    attachments: await signedUrlsFor(attachmentsByExpenseId.get(expenseId) ?? []),
    expiresInSeconds: SIGNED_URL_TTL_SECONDS
  };

  return jsonResponse<ExpenseAttachmentsListResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
