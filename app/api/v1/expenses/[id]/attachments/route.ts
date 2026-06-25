import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import { MAX_EXPENSE_ATTACHMENTS, RECEIPTS_BUCKET_NAME, sanitizeFileName } from "../../../../../../lib/expenses";
import { collectAndValidateReceiptFiles } from "../../../../../../lib/expenses/receipt-upload";
import { loadExpenseAttachments } from "../../../../../../lib/expenses/fetch-expense-attachments";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type {
  ExpenseAttachmentsListResponseData,
  ExpenseAttachmentWithUrl
} from "../../../../../../types/expenses";
import {
  buildMeta,
  expenseAttachmentRowSchema,
  expenseAttachmentSelectColumns,
  isExpenseAdmin,
  jsonResponse,
  toExpenseAttachment
} from "../../_helpers";

const SIGNED_URL_TTL_SECONDS = 300;

/** States in which the OWNER may still add/remove their own evidence (EXPENSE-01).
 *  After this, evidence is what approvers acted on — only an audited admin flow
 *  may change it. */
const OWNER_EDITABLE_EXPENSE_STATES = new Set(["draft", "pending"]);

const expenseAccessRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  status: z.string()
});

/** Build time-limited signed URLs for a set of attachments (service role). */
async function withSignedUrls(
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

/** GET — list an expense's documents with secure, time-limited URLs. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in to view expense documents." },
      meta: buildMeta()
    });
  }

  const { id: expenseId } = await params;
  const supabase = await createSupabaseServerClient();

  /* RLS restricts this select to expenses the viewer is allowed to see. */
  const { data: expenseRow } = await supabase
    .from("expenses")
    .select("id, employee_id, status")
    .eq("id", expenseId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!expenseRow) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Expense not found." },
      meta: buildMeta()
    });
  }

  const { data: rawAttachments } = await supabase
    .from("expense_attachments")
    .select(expenseAttachmentSelectColumns)
    .eq("org_id", session.profile.org_id)
    .eq("expense_id", expenseId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const parsed = z.array(expenseAttachmentRowSchema).safeParse(rawAttachments ?? []);
  const attachments = parsed.success ? parsed.data.map(toExpenseAttachment) : [];

  const responseData: ExpenseAttachmentsListResponseData = {
    attachments: await withSignedUrls(attachments),
    expiresInSeconds: SIGNED_URL_TTL_SECONDS
  };

  return jsonResponse<ExpenseAttachmentsListResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}

/** POST — attach one or more additional documents to an existing expense. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in to add documents." },
      meta: buildMeta()
    });
  }

  const { id: expenseId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: rawExpense } = await supabase
    .from("expenses")
    .select("id, employee_id, status")
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
  const isAdmin = isExpenseAdmin(session.profile.roles);

  if (!isOwner && !isAdmin) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "You cannot add documents to this expense." },
      meta: buildMeta()
    });
  }

  if (parsedExpense.data.status === "cancelled") {
    return jsonResponse<null>(409, {
      data: null,
      error: { code: "INVALID_STATE", message: "Documents cannot be added to a cancelled expense." },
      meta: buildMeta()
    });
  }

  // EXPENSE-01: owner evidence is mutable only while the expense is still
  // editable (draft/pending). Once it has entered approval, the owner can no
  // longer add/alter the evidence that approvers acted on — only an expense
  // admin may, as an explicit, audited correction.
  if (isOwner && !isAdmin && !OWNER_EDITABLE_EXPENSE_STATES.has(parsedExpense.data.status)) {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "EVIDENCE_LOCKED",
        message: "This expense is in approval and its documents can no longer be changed. Ask an admin if a correction is needed."
      },
      meta: buildMeta()
    });
  }

  /* How many slots remain under the per-expense cap. */
  const { count: existingCount } = await supabase
    .from("expense_attachments")
    .select("id", { count: "exact", head: true })
    .eq("org_id", session.profile.org_id)
    .eq("expense_id", expenseId)
    .is("deleted_at", null);

  const used = existingCount ?? 0;
  const remaining = MAX_EXPENSE_ATTACHMENTS - used;

  if (remaining <= 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: `This expense already has the maximum of ${MAX_EXPENSE_ATTACHMENTS} documents.`
      },
      meta: buildMeta()
    });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Request must be multipart form data." },
      meta: buildMeta()
    });
  }

  const collected = await collectAndValidateReceiptFiles(formData, { maxFiles: remaining });

  if ("error" in collected) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: collected.error },
      meta: buildMeta()
    });
  }

  const uploaded: Array<{ filePath: string; fileName: string; fileSizeBytes: number; mimeType: string }> = [];

  for (const [index, file] of collected.files.entries()) {
    const safeFileName = sanitizeFileName(file.name);
    const storagePath = `${session.profile.org_id}/${session.profile.id}/${expenseId}/${Date.now()}-${used + index}-${safeFileName}`;
    const contentType = file.type || "application/octet-stream";

    const { error: uploadError } = await supabase.storage
      .from(RECEIPTS_BUCKET_NAME)
      .upload(storagePath, file, { upsert: false, contentType });

    if (uploadError) {
      if (uploaded.length > 0) {
        await supabase.storage.from(RECEIPTS_BUCKET_NAME).remove(uploaded.map((entry) => entry.filePath));
      }
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "RECEIPT_UPLOAD_FAILED", message: "Unable to upload document." },
        meta: buildMeta()
      });
    }

    uploaded.push({ filePath: storagePath, fileName: safeFileName, fileSizeBytes: file.size, mimeType: contentType });
  }

  const { error: insertError } = await supabase.from("expense_attachments").insert(
    uploaded.map((attachment, index) => ({
      org_id: session.profile!.org_id,
      expense_id: expenseId,
      file_name: attachment.fileName,
      file_path: attachment.filePath,
      file_size_bytes: attachment.fileSizeBytes,
      mime_type: attachment.mimeType,
      sort_order: used + index
    }))
  );

  if (insertError) {
    await supabase.storage.from(RECEIPTS_BUCKET_NAME).remove(uploaded.map((entry) => entry.filePath));
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "ATTACHMENT_SAVE_FAILED", message: "Unable to save the uploaded documents." },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "updated",
    tableName: "expense_attachments",
    recordId: expenseId,
    oldValue: null,
    newValue: {
      expenseId,
      addedBy: session.profile.id,
      addedFileNames: uploaded.map((attachment) => attachment.fileName)
    }
  });

  const attachmentsByExpenseId = await loadExpenseAttachments({
    supabase,
    orgId: session.profile.org_id,
    expenseIds: [expenseId]
  });
  const attachments = attachmentsByExpenseId.get(expenseId) ?? [];

  const responseData: ExpenseAttachmentsListResponseData = {
    attachments: await withSignedUrls(attachments),
    expiresInSeconds: SIGNED_URL_TTL_SECONDS
  };

  return jsonResponse<ExpenseAttachmentsListResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
