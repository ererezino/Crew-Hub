import { z } from "zod";

import { logAudit } from "../../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import {
  sendExpenseInfoRequestedEmail,
  sendExpenseInfoResponseEmail
} from "../../../../../../lib/notifications/email";
import { createNotification } from "../../../../../../lib/notifications/service";
import type { UserRole } from "../../../../../../lib/navigation";
import { hasRole } from "../../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type {
  CreateExpenseCommentPayload,
  ExpenseCommentRecord,
  ExpenseCommentsResponseData
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
  message: z.string().trim().min(1, "Message is required.").max(2000, "Message is too long.")
});

function canAdminViewExpense(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

async function isDirectManager({
  supabase,
  orgId,
  employeeId,
  managerId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
  employeeId: string;
  managerId: string;
}): Promise<boolean> {
  const { data: rawEmployeeProfile, error } = await supabase
    .from("profiles")
    .select("id, manager_id")
    .eq("id", employeeId)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !rawEmployeeProfile) {
    return false;
  }

  const parsedProfile = profileRowSchema.safeParse(rawEmployeeProfile);

  if (!parsedProfile.success) {
    return false;
  }

  return parsedProfile.data.manager_id === managerId;
}

function mapExpenseComment(
  row: z.infer<typeof expenseCommentRowSchema>,
  profileById: ReadonlyMap<string, z.infer<typeof profileRowSchema>>
): ExpenseCommentRecord {
  return {
    id: row.id,
    expenseId: row.expense_id,
    authorId: row.author_id,
    authorName: profileById.get(row.author_id)?.full_name ?? "Unknown user",
    commentType: row.comment_type,
    message: row.message,
    createdAt: row.created_at
  };
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

  const { data: rawExpense, error: expenseError } = await supabase
    .from("expenses")
    .select("id, org_id, employee_id, status, description")
    .eq("id", expenseId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (expenseError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_FETCH_FAILED",
        message: "Unable to load expense record."
      },
      meta: buildMeta()
    });
  }

  const parsedExpense = expenseRowSchema.safeParse(rawExpense);

  if (!parsedExpense.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Expense was not found."
      },
      meta: buildMeta()
    });
  }

  const expense = parsedExpense.data;
  const isOwner = expense.employee_id === session.profile.id;
  const isSuperAdmin = hasRole(session.profile.roles, "SUPER_ADMIN");
  const isAdminViewer = canAdminViewExpense(session.profile.roles);
  const hasManagerRole = hasRole(session.profile.roles, "MANAGER");
  const isManagerOwner =
    hasManagerRole && !isSuperAdmin
      ? await isDirectManager({
          supabase,
          orgId: session.profile.org_id,
          employeeId: expense.employee_id,
          managerId: session.profile.id
        })
      : false;

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

  const { data: rawComments, error: commentsError } = await supabase
    .from("expense_comments")
    .select("id, expense_id, author_id, comment_type, message, created_at")
    .eq("org_id", session.profile.org_id)
    .eq("expense_id", expense.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (commentsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_COMMENTS_FETCH_FAILED",
        message: "Unable to load expense comments."
      },
      meta: buildMeta()
    });
  }

  const parsedComments = z.array(expenseCommentRowSchema).safeParse(rawComments ?? []);

  if (!parsedComments.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_COMMENTS_PARSE_FAILED",
        message: "Expense comments are not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const authorIds = [...new Set(parsedComments.data.map((comment) => comment.author_id))];
  let profileById = new Map<string, z.infer<typeof profileRowSchema>>();

  if (authorIds.length > 0) {
    const { data: rawProfiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name, manager_id")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .in("id", authorIds);

    if (profilesError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "EXPENSE_COMMENT_PROFILES_FETCH_FAILED",
          message: "Unable to resolve comment author names."
        },
        meta: buildMeta()
      });
    }

    const parsedProfiles = z.array(profileRowSchema).safeParse(rawProfiles ?? []);

    if (!parsedProfiles.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "EXPENSE_COMMENT_PROFILES_PARSE_FAILED",
          message: "Comment author data is not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    profileById = new Map(parsedProfiles.data.map((profile) => [profile.id, profile] as const));
  }

  const comments = parsedComments.data.map((comment) => mapExpenseComment(comment, profileById));

  const latestComment = parsedComments.data[parsedComments.data.length - 1] ?? null;

  const canRequestInfo =
    expense.status === "pending" && (isSuperAdmin || isManagerOwner) && !isOwner;
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

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Request body must be valid JSON."
      },
      meta: buildMeta()
    });
  }

  const parsedBody = expenseCommentPayloadSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid expense comment payload."
      },
      meta: buildMeta()
    });
  }

  const payload: CreateExpenseCommentPayload = parsedBody.data;
  const supabase = await createSupabaseServerClient();

  const { data: rawExpense, error: expenseError } = await supabase
    .from("expenses")
    .select("id, org_id, employee_id, status, description")
    .eq("id", expenseId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (expenseError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_FETCH_FAILED",
        message: "Unable to load expense record."
      },
      meta: buildMeta()
    });
  }

  const parsedExpense = expenseRowSchema.safeParse(rawExpense);

  if (!parsedExpense.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Expense was not found."
      },
      meta: buildMeta()
    });
  }

  const expense = parsedExpense.data;
  const isOwner = expense.employee_id === session.profile.id;
  const isSuperAdmin = hasRole(session.profile.roles, "SUPER_ADMIN");
  const hasManagerRole = hasRole(session.profile.roles, "MANAGER");
  const isManagerOwner =
    hasManagerRole && !isSuperAdmin
      ? await isDirectManager({
          supabase,
          orgId: session.profile.org_id,
          employeeId: expense.employee_id,
          managerId: session.profile.id
        })
      : false;

  const canRequestInfo =
    expense.status === "pending" && (isSuperAdmin || isManagerOwner) && !isOwner;

  const { data: rawExistingComments, error: existingCommentsError } = await supabase
    .from("expense_comments")
    .select("id, expense_id, author_id, comment_type, message, created_at")
    .eq("org_id", session.profile.org_id)
    .eq("expense_id", expense.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (existingCommentsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_COMMENTS_FETCH_FAILED",
        message: "Unable to load existing expense comments."
      },
      meta: buildMeta()
    });
  }

  const parsedExistingComments = z.array(expenseCommentRowSchema).safeParse(rawExistingComments ?? []);

  if (!parsedExistingComments.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_COMMENTS_PARSE_FAILED",
        message: "Existing expense comments are not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const latestComment = parsedExistingComments.data[parsedExistingComments.data.length - 1] ?? null;
  const canReply = isOwner && latestComment?.comment_type === "request_info";

  if (payload.action === "request_info" && !canRequestInfo) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only the direct manager or Super Admin can request more info on this expense."
      },
      meta: buildMeta()
    });
  }

  if (payload.action === "response" && !canReply) {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "INVALID_STATE",
        message: "A manager must request more info before you can reply."
      },
      meta: buildMeta()
    });
  }

  const { data: rawInsertedComment, error: insertError } = await supabase
    .from("expense_comments")
    .insert({
      org_id: session.profile.org_id,
      expense_id: expense.id,
      author_id: session.profile.id,
      comment_type: payload.action,
      message: payload.message.trim()
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
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_COMMENT_PARSE_FAILED",
        message: "Saved expense comment is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const comment = mapExpenseComment(parsedInsertedComment.data, new Map([
    [session.profile.id, { id: session.profile.id, full_name: session.profile.full_name, manager_id: null }]
  ]));

  await logAudit({
    action: "updated",
    tableName: "expenses",
    recordId: expense.id,
    oldValue: null,
    newValue: {
      event: payload.action === "request_info" ? "expense_info_requested" : "expense_info_response",
      expenseId: expense.id,
      message: payload.message.trim()
    }
  });

  if (payload.action === "request_info") {
    await createNotification({
      orgId: session.profile.org_id,
      userId: expense.employee_id,
      type: "expense_status",
      title: "More info requested on your expense",
      body: `${session.profile.full_name} requested additional details before approval.`,
      link: "/expenses"
    });

    void sendExpenseInfoRequestedEmail({
      orgId: session.profile.org_id,
      userId: expense.employee_id,
      requesterName: session.profile.full_name,
      description: expense.description,
      message: payload.message.trim()
    });
  }

  if (payload.action === "response") {
    const latestRequestComment = [...parsedExistingComments.data]
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
        message: payload.message.trim()
      });
    }
  }

  return jsonResponse<{ comment: ExpenseCommentRecord }>(201, {
    data: { comment },
    error: null,
    meta: buildMeta()
  });
}
