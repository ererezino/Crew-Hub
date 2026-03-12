import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../../lib/auth/session";
import { RECEIPTS_BUCKET_NAME } from "../../../../../../../../lib/expenses";
import { hasRole } from "../../../../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../../../../types/auth";

type SignedUrlResponseData = {
  url: string;
  fileName: string;
  mimeType: string;
  expiresInSeconds: number;
};

const paramsSchema = z.object({
  id: z.string().uuid(),
  attachmentId: z.string().uuid()
});

const attachmentRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  comment_id: z.string().uuid(),
  file_path: z.string(),
  file_name: z.string(),
  mime_type: z.string()
});

const commentRowSchema = z.object({
  id: z.string().uuid(),
  expense_id: z.string().uuid()
});

const expenseRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid()
});

const profileRowSchema = z.object({
  id: z.string().uuid(),
  manager_id: z.string().uuid().nullable()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return Response.json(payload, { status });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Invalid parameters." },
      meta: buildMeta()
    });
  }

  const { id: expenseId, attachmentId } = parsedParams.data;
  const supabase = await createSupabaseServerClient();

  const { data: rawAttachment, error: attachmentError } = await supabase
    .from("expense_comment_attachments")
    .select("id, org_id, comment_id, file_path, file_name, mime_type")
    .eq("id", attachmentId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (attachmentError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "FETCH_FAILED", message: "Unable to load comment attachment." },
      meta: buildMeta()
    });
  }

  const parsedAttachment = attachmentRowSchema.safeParse(rawAttachment);

  if (!parsedAttachment.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Attachment not found." },
      meta: buildMeta()
    });
  }

  const { data: rawComment, error: commentError } = await supabase
    .from("expense_comments")
    .select("id, expense_id")
    .eq("id", parsedAttachment.data.comment_id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (commentError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "FETCH_FAILED", message: "Unable to load comment context." },
      meta: buildMeta()
    });
  }

  const parsedComment = commentRowSchema.safeParse(rawComment);

  if (!parsedComment.success || parsedComment.data.expense_id !== expenseId) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Attachment not found." },
      meta: buildMeta()
    });
  }

  const { data: rawExpense, error: expenseError } = await supabase
    .from("expenses")
    .select("id, employee_id")
    .eq("id", expenseId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (expenseError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "FETCH_FAILED", message: "Unable to load expense context." },
      meta: buildMeta()
    });
  }

  const parsedExpense = expenseRowSchema.safeParse(rawExpense);

  if (!parsedExpense.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Expense not found." },
      meta: buildMeta()
    });
  }

  const isOwner = parsedExpense.data.employee_id === session.profile.id;
  const isAdmin =
    hasRole(session.profile.roles, "HR_ADMIN") ||
    hasRole(session.profile.roles, "FINANCE_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  let isManagerOwner = false;

  if (!isOwner && !isAdmin && hasRole(session.profile.roles, "MANAGER")) {
    const { data: rawEmployeeProfile, error: employeeProfileError } = await supabase
      .from("profiles")
      .select("id, manager_id")
      .eq("id", parsedExpense.data.employee_id)
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (employeeProfileError) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "FETCH_FAILED", message: "Unable to verify manager scope." },
        meta: buildMeta()
      });
    }

    const parsedProfile = profileRowSchema.safeParse(rawEmployeeProfile);
    isManagerOwner = parsedProfile.success && parsedProfile.data.manager_id === session.profile.id;
  }

  if (!isOwner && !isAdmin && !isManagerOwner) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "You are not allowed to view this attachment." },
      meta: buildMeta()
    });
  }

  const expiresInSeconds = 300;
  const storageClient = createSupabaseServiceRoleClient();
  const { data: signedUrlData, error: signedUrlError } = await storageClient.storage
    .from(RECEIPTS_BUCKET_NAME)
    .createSignedUrl(parsedAttachment.data.file_path, expiresInSeconds);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "STORAGE_ERROR", message: "Unable to generate download URL." },
      meta: buildMeta()
    });
  }

  return jsonResponse<SignedUrlResponseData>(200, {
    data: {
      url: signedUrlData.signedUrl,
      fileName: parsedAttachment.data.file_name,
      mimeType: parsedAttachment.data.mime_type,
      expiresInSeconds
    },
    error: null,
    meta: buildMeta()
  });
}
