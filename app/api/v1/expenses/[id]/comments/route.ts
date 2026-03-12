import { z } from "zod";

import { logAudit } from "../../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import {
  ALLOWED_RECEIPT_EXTENSIONS,
  ALLOWED_RECEIPT_MIME_TYPES,
  MAX_EXPENSE_COMMENT_ATTACHMENTS,
  MAX_RECEIPT_FILE_BYTES,
  RECEIPTS_BUCKET_NAME,
  sanitizeFileName
} from "../../../../../../lib/expenses";
import {
  sendExpenseInfoRequestedEmail,
  sendExpenseInfoResponseEmail
} from "../../../../../../lib/notifications/email";
import { createNotification } from "../../../../../../lib/notifications/service";
import type { UserRole } from "../../../../../../lib/navigation";
import { hasRole } from "../../../../../../lib/roles";
import { validateUploadMagicBytes } from "../../../../../../lib/security/upload-signatures";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type {
  ExpenseCommentAttachment,
  ExpenseCommentRecord,
  ExpenseCommentsResponseData,
  ExpenseCommentType
} from "../../../../../../types/expenses";
import { expenseCommentTypeSchema } from "../../_comment-state";
import { buildMeta, jsonResponse } from "../../_helpers";

const expenseRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  status: z.string(),
  description: z.string()
});

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  manager_id: z.string().uuid().nullable()
});

const expenseCommentAttachmentRowSchema = z.object({
  id: z.string().uuid(),
  comment_id: z.string().uuid(),
  file_name: z.string(),
  file_path: z.string(),
  mime_type: z.string(),
  file_size_bytes: z.union([z.number(), z.string()]),
  created_at: z.string()
});

const expenseCommentRowSchema = z.object({
  id: z.string().uuid(),
  expense_id: z.string().uuid(),
  author_id: z.string().uuid(),
  comment_type: expenseCommentTypeSchema,
  message: z.string(),
  created_at: z.string()
});

const expenseCommentPayloadSchema = z.object({
  action: expenseCommentTypeSchema,
  message: z.string().trim().max(2000, "Message is too long.").optional().default("")
});

const COMMENTABLE_EXPENSE_STATUSES = new Set(["pending", "manager_approved", "approved"]);
const FINANCE_THREAD_STATUSES = new Set(["manager_approved", "approved"]);

function canAdminViewExpense(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

function canRequestExpenseInfo({
  roles,
  isOwner,
  isSuperAdmin,
  isManagerOwner,
  status
}: {
  roles: readonly UserRole[];
  isOwner: boolean;
  isSuperAdmin: boolean;
  isManagerOwner: boolean;
  status: string;
}): boolean {
  if (isOwner || !COMMENTABLE_EXPENSE_STATUSES.has(status)) {
    return false;
  }

  if (status === "pending") {
    return isSuperAdmin || isManagerOwner;
  }

  if (FINANCE_THREAD_STATUSES.has(status)) {
    return isSuperAdmin || hasRole(roles, "FINANCE_ADMIN");
  }

  return false;
}

function mapExpenseCommentAttachment(
  row: z.infer<typeof expenseCommentAttachmentRowSchema>
): ExpenseCommentAttachment {
  return {
    id: row.id,
    commentId: row.comment_id,
    fileName: row.file_name,
    filePath: row.file_path,
    mimeType: row.mime_type,
    fileSizeBytes:
      typeof row.file_size_bytes === "number"
        ? row.file_size_bytes
        : Number.parseInt(row.file_size_bytes, 10),
    createdAt: row.created_at
  };
}

function mapExpenseComment(
  row: z.infer<typeof expenseCommentRowSchema>,
  profileById: ReadonlyMap<string, z.infer<typeof profileRowSchema>>,
  attachmentsByCommentId: ReadonlyMap<string, ExpenseCommentAttachment[]>
): ExpenseCommentRecord {
  return {
    id: row.id,
    expenseId: row.expense_id,
    authorId: row.author_id,
    authorName: profileById.get(row.author_id)?.full_name ?? "Unknown user",
    commentType: row.comment_type,
    message: row.message,
    attachments: attachmentsByCommentId.get(row.id) ?? [],
    createdAt: row.created_at
  };
}

async function parseExpenseCommentRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    let formData: FormData;

    try {
      formData = await request.formData();
    } catch {
      return {
        payload: null,
        attachments: [] as File[],
        error: "Request body must be multipart form data."
      };
    }

    const action = String(formData.get("action") ?? "").trim();
    const message = String(formData.get("message") ?? "");
    const attachments = formData
      .getAll("attachments")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    const parsedPayload = expenseCommentPayloadSchema.safeParse({ action, message });

    if (!parsedPayload.success) {
      return {
        payload: null,
        attachments: [] as File[],
        error: parsedPayload.error.issues[0]?.message ?? "Invalid expense comment payload."
      };
    }

    return {
      payload: parsedPayload.data,
      attachments,
      error: null
    };
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return {
      payload: null,
      attachments: [] as File[],
      error: "Request body must be valid JSON or multipart form data."
    };
  }

  const parsedPayload = expenseCommentPayloadSchema.safeParse(body);

  if (!parsedPayload.success) {
    return {
      payload: null,
      attachments: [] as File[],
      error: parsedPayload.error.issues[0]?.message ?? "Invalid expense comment payload."
    };
  }

  return {
    payload: parsedPayload.data,
    attachments: [] as File[],
    error: null
  };
}

async function validateCommentAttachments(files: readonly File[]) {
  if (files.length > MAX_EXPENSE_COMMENT_ATTACHMENTS) {
    return `You can upload up to ${MAX_EXPENSE_COMMENT_ATTACHMENTS} attachments per message.`;
  }

  for (const file of files) {
    if (file.size > MAX_RECEIPT_FILE_BYTES) {
      return "Each attachment must be under 10 MB.";
    }

    if (
      !ALLOWED_RECEIPT_MIME_TYPES.includes(
        file.type as (typeof ALLOWED_RECEIPT_MIME_TYPES)[number]
      )
    ) {
      return "Only PDF, PNG, and JPG files are accepted.";
    }

    const magicResult = await validateUploadMagicBytes({
      file,
      fileName: file.name,
      allowedExtensions: [...ALLOWED_RECEIPT_EXTENSIONS]
    });

    if (!magicResult.valid) {
      return magicResult.message ?? "Attachment content does not match its extension.";
    }
  }

  return null;
}

async function loadExpenseContext({
  supabase,
  orgId,
  expenseId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
  expenseId: string;
}) {
  const { data: rawExpense, error: expenseError } = await supabase
    .from("expenses")
    .select("id, org_id, employee_id, status, description")
    .eq("id", expenseId)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (expenseError) {
    return { errorCode: "EXPENSE_FETCH_FAILED", errorMessage: "Unable to load expense record.", expense: null, employeeProfile: null };
  }

  const parsedExpense = expenseRowSchema.safeParse(rawExpense);

  if (!parsedExpense.success) {
    return { errorCode: "NOT_FOUND", errorMessage: "Expense was not found.", expense: null, employeeProfile: null };
  }

  const { data: rawEmployeeProfile, error: employeeProfileError } = await supabase
    .from("profiles")
    .select("id, full_name, manager_id")
    .eq("id", parsedExpense.data.employee_id)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (employeeProfileError) {
    return {
      errorCode: "EXPENSE_EMPLOYEE_PROFILE_FETCH_FAILED",
      errorMessage: "Unable to verify expense ownership.",
      expense: null,
      employeeProfile: null
    };
  }

  const parsedEmployeeProfile = profileRowSchema.safeParse(rawEmployeeProfile);

  if (!parsedEmployeeProfile.success) {
    return {
      errorCode: "EXPENSE_EMPLOYEE_PROFILE_PARSE_FAILED",
      errorMessage: "Expense employee data is not in the expected shape.",
      expense: null,
      employeeProfile: null
    };
  }

  return {
    errorCode: null,
    errorMessage: null,
    expense: parsedExpense.data,
    employeeProfile: parsedEmployeeProfile.data
  };
}

async function loadExpenseComments({
  supabase,
  orgId,
  expenseId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
  expenseId: string;
}) {
  const { data: rawComments, error: commentsError } = await supabase
    .from("expense_comments")
    .select("id, expense_id, author_id, comment_type, message, created_at")
    .eq("org_id", orgId)
    .eq("expense_id", expenseId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (commentsError) {
    return {
      errorCode: "EXPENSE_COMMENTS_FETCH_FAILED",
      errorMessage: "Unable to load expense comments.",
      comments: [] as z.infer<typeof expenseCommentRowSchema>[]
    };
  }

  const parsedComments = z.array(expenseCommentRowSchema).safeParse(rawComments ?? []);

  if (!parsedComments.success) {
    return {
      errorCode: "EXPENSE_COMMENTS_PARSE_FAILED",
      errorMessage: "Expense comments are not in the expected shape.",
      comments: [] as z.infer<typeof expenseCommentRowSchema>[]
    };
  }

  return {
    errorCode: null,
    errorMessage: null,
    comments: parsedComments.data
  };
}

async function loadCommentAttachments({
  supabase,
  orgId,
  commentIds
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
  commentIds: string[];
}) {
  if (commentIds.length === 0) {
    return {
      errorCode: null,
      errorMessage: null,
      attachmentsByCommentId: new Map<string, ExpenseCommentAttachment[]>()
    };
  }

  const { data: rawAttachments, error: attachmentsError } = await supabase
    .from("expense_comment_attachments")
    .select("id, comment_id, file_name, file_path, mime_type, file_size_bytes, created_at")
    .eq("org_id", orgId)
    .in("comment_id", commentIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (attachmentsError) {
    return {
      errorCode: "EXPENSE_COMMENT_ATTACHMENTS_FETCH_FAILED",
      errorMessage: "Unable to load comment attachments.",
      attachmentsByCommentId: new Map<string, ExpenseCommentAttachment[]>()
    };
  }

  const parsedAttachments = z.array(expenseCommentAttachmentRowSchema).safeParse(rawAttachments ?? []);

  if (!parsedAttachments.success) {
    return {
      errorCode: "EXPENSE_COMMENT_ATTACHMENTS_PARSE_FAILED",
      errorMessage: "Comment attachments are not in the expected shape.",
      attachmentsByCommentId: new Map<string, ExpenseCommentAttachment[]>()
    };
  }

  const attachmentsByCommentId = new Map<string, ExpenseCommentAttachment[]>();

  for (const attachment of parsedAttachments.data) {
    const mapped = mapExpenseCommentAttachment(attachment);
    const current = attachmentsByCommentId.get(mapped.commentId) ?? [];
    current.push(mapped);
    attachmentsByCommentId.set(mapped.commentId, current);
  }

  return {
    errorCode: null,
    errorMessage: null,
    attachmentsByCommentId
  };
}

async function loadProfilesById({
  supabase,
  orgId,
  profileIds
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
  profileIds: string[];
}) {
  if (profileIds.length === 0) {
    return { errorCode: null, errorMessage: null, profileById: new Map<string, z.infer<typeof profileRowSchema>>() };
  }

  const { data: rawProfiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, full_name, manager_id")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .in("id", profileIds);

  if (profilesError) {
    return {
      errorCode: "EXPENSE_COMMENT_PROFILES_FETCH_FAILED",
      errorMessage: "Unable to resolve comment author names.",
      profileById: new Map<string, z.infer<typeof profileRowSchema>>()
    };
  }

  const parsedProfiles = z.array(profileRowSchema).safeParse(rawProfiles ?? []);

  if (!parsedProfiles.success) {
    return {
      errorCode: "EXPENSE_COMMENT_PROFILES_PARSE_FAILED",
      errorMessage: "Comment author data is not in the expected shape.",
      profileById: new Map<string, z.infer<typeof profileRowSchema>>()
    };
  }

  return {
    errorCode: null,
    errorMessage: null,
    profileById: new Map(parsedProfiles.data.map((profile) => [profile.id, profile] as const))
  };
}

async function rollbackCreatedComment({
  commentId,
  uploadedPaths
}: {
  commentId: string;
  uploadedPaths: string[];
}) {
  const serviceClient = createSupabaseServiceRoleClient();

  if (uploadedPaths.length > 0) {
    await serviceClient.storage.from(RECEIPTS_BUCKET_NAME).remove(uploadedPaths);
  }

  await serviceClient.from("expense_comment_attachments").delete().eq("comment_id", commentId);
  await serviceClient.from("expense_comments").delete().eq("id", commentId);
}

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
        message: "You must be logged in to view expense comments."
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
  const expenseContext = await loadExpenseContext({
    supabase,
    orgId: session.profile.org_id,
    expenseId
  });

  if (expenseContext.errorCode || !expenseContext.expense || !expenseContext.employeeProfile) {
    return jsonResponse<null>(expenseContext.errorCode === "NOT_FOUND" ? 404 : 500, {
      data: null,
      error: {
        code: expenseContext.errorCode ?? "EXPENSE_FETCH_FAILED",
        message: expenseContext.errorMessage ?? "Unable to load expense record."
      },
      meta: buildMeta()
    });
  }

  const { expense, employeeProfile } = expenseContext;
  const isOwner = expense.employee_id === session.profile.id;
  const isSuperAdmin = hasRole(session.profile.roles, "SUPER_ADMIN");
  const isAdminViewer = canAdminViewExpense(session.profile.roles);
  const isManagerOwner = employeeProfile.manager_id === session.profile.id && !isOwner;
  const canView = isOwner || isSuperAdmin || isAdminViewer || isManagerOwner;

  if (!canView) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to view comments for this expense."
      },
      meta: buildMeta()
    });
  }

  const commentsResult = await loadExpenseComments({
    supabase,
    orgId: session.profile.org_id,
    expenseId: expense.id
  });

  if (commentsResult.errorCode) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: commentsResult.errorCode,
        message: commentsResult.errorMessage ?? "Unable to load expense comments."
      },
      meta: buildMeta()
    });
  }

  const attachmentsResult = await loadCommentAttachments({
    supabase,
    orgId: session.profile.org_id,
    commentIds: commentsResult.comments.map((comment) => comment.id)
  });

  if (attachmentsResult.errorCode) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: attachmentsResult.errorCode,
        message: attachmentsResult.errorMessage ?? "Unable to load comment attachments."
      },
      meta: buildMeta()
    });
  }

  const profileResult = await loadProfilesById({
    supabase,
    orgId: session.profile.org_id,
    profileIds: [...new Set(commentsResult.comments.map((comment) => comment.author_id))]
  });

  if (profileResult.errorCode) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: profileResult.errorCode,
        message: profileResult.errorMessage ?? "Unable to resolve comment author names."
      },
      meta: buildMeta()
    });
  }

  const comments = commentsResult.comments.map((comment) =>
    mapExpenseComment(comment, profileResult.profileById, attachmentsResult.attachmentsByCommentId)
  );

  const latestComment = commentsResult.comments[commentsResult.comments.length - 1] ?? null;
  const canRequestInfo = canRequestExpenseInfo({
    roles: session.profile.roles,
    isOwner,
    isSuperAdmin,
    isManagerOwner,
    status: expense.status
  });
  const canReply = isOwner && latestComment?.comment_type === "request_info";

  return jsonResponse<ExpenseCommentsResponseData>(200, {
    data: {
      comments,
      canRequestInfo,
      canReply
    },
    error: null,
    meta: buildMeta()
  });
}

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
        message: "You must be logged in to post an expense comment."
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

  const parsedRequest = await parseExpenseCommentRequest(request);

  if (!parsedRequest.payload) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: parsedRequest.error ?? "Invalid expense comment payload."
      },
      meta: buildMeta()
    });
  }

  const message = parsedRequest.payload.message?.trim() ?? "";

  if (!message && parsedRequest.attachments.length === 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Add a message or at least one attachment."
      },
      meta: buildMeta()
    });
  }

  const attachmentValidationError = await validateCommentAttachments(parsedRequest.attachments);

  if (attachmentValidationError) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: attachmentValidationError
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const expenseContext = await loadExpenseContext({
    supabase,
    orgId: session.profile.org_id,
    expenseId
  });

  if (expenseContext.errorCode || !expenseContext.expense || !expenseContext.employeeProfile) {
    return jsonResponse<null>(expenseContext.errorCode === "NOT_FOUND" ? 404 : 500, {
      data: null,
      error: {
        code: expenseContext.errorCode ?? "EXPENSE_FETCH_FAILED",
        message: expenseContext.errorMessage ?? "Unable to load expense record."
      },
      meta: buildMeta()
    });
  }

  const { expense, employeeProfile } = expenseContext;
  const isOwner = expense.employee_id === session.profile.id;
  const isSuperAdmin = hasRole(session.profile.roles, "SUPER_ADMIN");
  const isManagerOwner = employeeProfile.manager_id === session.profile.id && !isOwner;
  const canRequestInfo = canRequestExpenseInfo({
    roles: session.profile.roles,
    isOwner,
    isSuperAdmin,
    isManagerOwner,
    status: expense.status
  });

  const existingCommentsResult = await loadExpenseComments({
    supabase,
    orgId: session.profile.org_id,
    expenseId: expense.id
  });

  if (existingCommentsResult.errorCode) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: existingCommentsResult.errorCode,
        message: existingCommentsResult.errorMessage ?? "Unable to load existing expense comments."
      },
      meta: buildMeta()
    });
  }

  const latestComment = existingCommentsResult.comments[existingCommentsResult.comments.length - 1] ?? null;
  const canReply = isOwner && latestComment?.comment_type === "request_info";

  if (parsedRequest.payload.action === "request_info" && !canRequestInfo) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only the current approver can request more info on this expense."
      },
      meta: buildMeta()
    });
  }

  if (parsedRequest.payload.action === "response" && !canReply) {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "INVALID_STATE",
        message: "A reviewer must request more info before you can reply."
      },
      meta: buildMeta()
    });
  }

  const commentId = crypto.randomUUID();
  const { data: rawInsertedComment, error: insertError } = await supabase
    .from("expense_comments")
    .insert({
      id: commentId,
      org_id: session.profile.org_id,
      expense_id: expense.id,
      author_id: session.profile.id,
      comment_type: parsedRequest.payload.action,
      message
    })
    .select("id, expense_id, author_id, comment_type, message, created_at")
    .single();

  if (insertError || !rawInsertedComment) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_COMMENT_CREATE_FAILED",
        message: "Unable to save expense comment."
      },
      meta: buildMeta()
    });
  }

  const parsedInsertedComment = expenseCommentRowSchema.safeParse(rawInsertedComment);

  if (!parsedInsertedComment.success) {
    await rollbackCreatedComment({ commentId, uploadedPaths: [] });
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_COMMENT_PARSE_FAILED",
        message: "Saved expense comment is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const storageClient = createSupabaseServiceRoleClient();
  const uploadedPaths: string[] = [];
  const attachmentRowsToInsert: Array<{
    org_id: string;
    comment_id: string;
    file_name: string;
    file_path: string;
    file_size_bytes: number;
    mime_type: string;
  }> = [];

  for (const [index, file] of parsedRequest.attachments.entries()) {
    const safeName = sanitizeFileName(file.name);
    const storagePath = `${session.profile.org_id}/expense-comment-attachments/${expense.id}/${commentId}/${Date.now()}-${index}-${safeName}`;

    const { error: uploadError } = await storageClient.storage
      .from(RECEIPTS_BUCKET_NAME)
      .upload(storagePath, file, { upsert: false, contentType: file.type });

    if (uploadError) {
      await rollbackCreatedComment({ commentId, uploadedPaths });
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "EXPENSE_COMMENT_ATTACHMENT_UPLOAD_FAILED",
          message: "Unable to upload comment attachment."
        },
        meta: buildMeta()
      });
    }

    uploadedPaths.push(storagePath);
    attachmentRowsToInsert.push({
      org_id: session.profile.org_id,
      comment_id: commentId,
      file_name: safeName,
      file_path: storagePath,
      file_size_bytes: file.size,
      mime_type: file.type
    });
  }

  let commentAttachments: ExpenseCommentAttachment[] = [];

  if (attachmentRowsToInsert.length > 0) {
    const { data: rawInsertedAttachments, error: attachmentInsertError } = await supabase
      .from("expense_comment_attachments")
      .insert(attachmentRowsToInsert)
      .select("id, comment_id, file_name, file_path, mime_type, file_size_bytes, created_at");

    if (attachmentInsertError) {
      await rollbackCreatedComment({ commentId, uploadedPaths });
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "EXPENSE_COMMENT_ATTACHMENT_CREATE_FAILED",
          message: "Unable to save comment attachments."
        },
        meta: buildMeta()
      });
    }

    const parsedInsertedAttachments = z.array(expenseCommentAttachmentRowSchema).safeParse(rawInsertedAttachments ?? []);

    if (!parsedInsertedAttachments.success) {
      await rollbackCreatedComment({ commentId, uploadedPaths });
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "EXPENSE_COMMENT_ATTACHMENT_PARSE_FAILED",
          message: "Saved comment attachments are not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    commentAttachments = parsedInsertedAttachments.data.map(mapExpenseCommentAttachment);
  }

  const comment: ExpenseCommentRecord = {
    id: parsedInsertedComment.data.id,
    expenseId: parsedInsertedComment.data.expense_id,
    authorId: parsedInsertedComment.data.author_id,
    authorName: session.profile.full_name,
    commentType: parsedInsertedComment.data.comment_type,
    message: parsedInsertedComment.data.message,
    attachments: commentAttachments,
    createdAt: parsedInsertedComment.data.created_at
  };

  await logAudit({
    action: "updated",
    tableName: "expenses",
    recordId: expense.id,
    oldValue: null,
    newValue: {
      event:
        parsedRequest.payload.action === "request_info"
          ? "expense_info_requested"
          : "expense_info_response",
      expenseId: expense.id,
      message,
      attachments: commentAttachments.map((attachment) => ({
        id: attachment.id,
        fileName: attachment.fileName,
        filePath: attachment.filePath,
        mimeType: attachment.mimeType,
        fileSizeBytes: attachment.fileSizeBytes
      }))
    }
  });

  const directManagerId = employeeProfile.manager_id;
  const isFinanceStageRequester =
    parsedRequest.payload.action === "request_info" &&
    FINANCE_THREAD_STATUSES.has(expense.status) &&
    (hasRole(session.profile.roles, "FINANCE_ADMIN") || isSuperAdmin);

  if (parsedRequest.payload.action === "request_info") {
    await createNotification({
      orgId: session.profile.org_id,
      userId: expense.employee_id,
      type: "expense_status",
      title: "More info requested on your expense",
      body: `${session.profile.full_name} requested additional details before payment can continue.`,
      link: "/expenses"
    });

    if (
      isFinanceStageRequester &&
      directManagerId &&
      directManagerId !== session.profile.id &&
      directManagerId !== expense.employee_id
    ) {
      await createNotification({
        orgId: session.profile.org_id,
        userId: directManagerId,
        type: "expense_status",
        title: "Finance requested more info on an approved expense",
        body: `${session.profile.full_name} requested more details from ${employeeProfile.full_name}.`,
        link: "/expenses/approvals"
      });
    }

    void sendExpenseInfoRequestedEmail({
      orgId: session.profile.org_id,
      userId: expense.employee_id,
      requesterName: session.profile.full_name,
      description: expense.description,
      message: message || "Additional attachments were shared in Crew Hub."
    });
  }

  if (parsedRequest.payload.action === "response") {
    const latestRequestComment = [...existingCommentsResult.comments]
      .reverse()
      .find((existingComment) => existingComment.comment_type === "request_info");

    const requestOwnerId = latestRequestComment?.author_id ?? null;

    if (requestOwnerId && requestOwnerId !== session.profile.id) {
      await createNotification({
        orgId: session.profile.org_id,
        userId: requestOwnerId,
        type: "expense_status",
        title: "Expense info response received",
        body: `${session.profile.full_name} replied to your expense info request.`,
        link: "/expenses/approvals"
      });

      void sendExpenseInfoResponseEmail({
        orgId: session.profile.org_id,
        userId: requestOwnerId,
        responderName: session.profile.full_name,
        description: expense.description,
        message: message || "New attachments were added in Crew Hub."
      });
    }

    if (
      directManagerId &&
      directManagerId !== session.profile.id &&
      directManagerId !== requestOwnerId
    ) {
      await createNotification({
        orgId: session.profile.org_id,
        userId: directManagerId,
        type: "expense_status",
        title: "Expense clarification updated",
        body: `${session.profile.full_name} responded to a finance clarification request.`,
        link: "/expenses/approvals"
      });
    }
  }

  return jsonResponse<{ comment: ExpenseCommentRecord }>(201, {
    data: { comment },
    error: null,
    meta: buildMeta()
  });
}
