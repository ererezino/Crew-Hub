import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import {
  ALLOWED_RECEIPT_MIME_TYPES,
  MAX_RECEIPT_FILE_BYTES,
  RECEIPTS_BUCKET_NAME
} from "../../../../../../lib/expenses";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type { ExpenseReceiptSignedUrlResponseData } from "../../../../../../types/expenses";
import { buildMeta, jsonResponse } from "../../_helpers";

const paymentProofRowSchema = z.object({
  id: z.string().uuid(),
  reimbursement_receipt_path: z.string().nullable()
});

/**
 * GET /api/v1/expenses/[id]/payment-proof
 *
 * Returns a signed URL to view the payment proof receipt uploaded by finance.
 * Accessible to any authenticated user in the same org (employee, manager, or finance).
 */
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
        message: "You must be logged in to view payment proof."
      },
      meta: buildMeta()
    });
  }

  const { id: expenseId } = await params;

  if (!expenseId) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Expense id is required." },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: rawRow, error: fetchError } = await supabase
    .from("expenses")
    .select("id, reimbursement_receipt_path")
    .eq("id", expenseId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYMENT_PROOF_FETCH_FAILED",
        message: "Unable to load payment proof."
      },
      meta: buildMeta()
    });
  }

  const parsed = paymentProofRowSchema.safeParse(rawRow);

  if (!parsed.success || !parsed.data.reimbursement_receipt_path) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Payment proof receipt was not found."
      },
      meta: buildMeta()
    });
  }

  const expiresInSeconds = 60;
  const { data: signedUrlResult, error: signedUrlError } = await supabase.storage
    .from(RECEIPTS_BUCKET_NAME)
    .createSignedUrl(parsed.data.reimbursement_receipt_path, expiresInSeconds);

  if (signedUrlError || !signedUrlResult?.signedUrl) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYMENT_PROOF_SIGNED_URL_FAILED",
        message: "Unable to prepare secure payment proof access."
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

/**
 * POST /api/v1/expenses/[id]/payment-proof
 *
 * Upload a payment proof receipt file. Only finance admins and super admins
 * can upload payment proof for expenses in manager_approved or reimbursed status.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to upload payment proof."
      },
      meta: buildMeta()
    });
  }

  const roles = session.profile.roles ?? [];
  const isFinanceOrSuper =
    roles.includes("FINANCE_ADMIN") || roles.includes("SUPER_ADMIN");

  if (!isFinanceOrSuper) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Finance Admin or Super Admin can upload payment proof."
      },
      meta: buildMeta()
    });
  }

  const { id: expenseId } = await params;

  if (!expenseId) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Expense id is required." },
      meta: buildMeta()
    });
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "INVALID_REQUEST",
        message: "Expected multipart form data with a payment proof file."
      },
      meta: buildMeta()
    });
  }

  const file = formData.get("paymentProof");

  if (!(file instanceof File) || file.size === 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "A payment proof file is required."
      },
      meta: buildMeta()
    });
  }

  if (file.size > MAX_RECEIPT_FILE_BYTES) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "FILE_TOO_LARGE",
        message: "Payment proof file must be under 10 MB."
      },
      meta: buildMeta()
    });
  }

  const mimeType = file.type as (typeof ALLOWED_RECEIPT_MIME_TYPES)[number];

  if (!ALLOWED_RECEIPT_MIME_TYPES.includes(mimeType)) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "INVALID_FILE_TYPE",
        message: "Only PDF, PNG, and JPG files are accepted."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  // Verify expense exists and belongs to same org
  const { data: expense, error: expenseError } = await supabase
    .from("expenses")
    .select("id, org_id, employee_id")
    .eq("id", expenseId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (expenseError || !expense) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Expense not found."
      },
      meta: buildMeta()
    });
  }

  // Upload to storage
  const timestamp = Date.now();
  const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${session.profile.org_id}/payment-proof/${expenseId}/${timestamp}-${safeFileName}`;

  const { error: uploadError } = await supabase.storage
    .from(RECEIPTS_BUCKET_NAME)
    .upload(storagePath, file, {
      contentType: mimeType,
      upsert: false
    });

  if (uploadError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "UPLOAD_FAILED",
        message: "Unable to upload payment proof file."
      },
      meta: buildMeta()
    });
  }

  // Update expense with the payment proof path
  const { error: updateError } = await supabase
    .from("expenses")
    .update({ reimbursement_receipt_path: storagePath })
    .eq("id", expenseId);

  if (updateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "UPDATE_FAILED",
        message: "File uploaded but failed to link to expense."
      },
      meta: buildMeta()
    });
  }

  return jsonResponse<{ path: string }>(200, {
    data: { path: storagePath },
    error: null,
    meta: buildMeta()
  });
}
