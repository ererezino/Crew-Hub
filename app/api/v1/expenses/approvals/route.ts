import { z } from "zod";

import { logAuditBatch } from "../../../../../lib/audit";
import { formatCurrency } from "../../../../../lib/format-currency";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import {
  getEffectiveApproverScope,
  resolveDelegationContext,
  type ApproverScope
} from "../../../../../lib/delegation";
import { logger } from "../../../../../lib/logger";
import { sendExpenseDisbursedEmail } from "../../../../../lib/notifications/email";
import { createBulkNotifications, createNotification } from "../../../../../lib/notifications/service";
import { addCurrencyAmount, currentMonthKey, isIsoMonth, monthDateRange, parseIntegerAmount } from "../../../../../lib/expenses";
import { countAdditionalExpenses } from "../../../../../lib/approvals/fetch-approvals-counts";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type {
  CurrencyAmounts,
  ExpenseApprovalStage,
  ExpenseApprovalsResponseData,
  ExpenseBulkApprovePayload,
  ExpenseBulkApproveResponseData
} from "../../../../../types/expenses";
import {
  buildMeta,
  canFinanceApproveExpenses,
  canManagerApproveExpenses,
  collectProfileIds,
  expenseRowSchema,
  expenseSelectColumns,
  jsonResponse,
  profileRowSchema,
  toExpenseRecord
} from "../_helpers";
import { loadLatestExpenseCommentStates } from "../_comment-state";
import { loadExpenseAttachments } from "../../../../../lib/expenses/fetch-expense-attachments";

const approvalsQuerySchema = z.object({
  month: z
    .string()
    .optional()
    .refine((value) => (value ? isIsoMonth(value) : true), "Month must be in YYYY-MM format"),
  stage: z.enum(["manager", "additional", "finance"]).optional()
});

const bulkApprovePayloadSchema = z.object({
  expenseIds: z.array(z.string().uuid()).min(1, "Select at least one expense to approve.").max(200),
  stage: z.enum(["manager", "additional", "finance"])
});

const approverProfileSchema = z.object({
  id: z.string().uuid(),
  roles: z.array(z.string()).nullable()
});

function statusForStage(stage: ExpenseApprovalStage): "pending" | "manager_approved" | "manager_approved" {
  if (stage === "manager") return "pending";
  if (stage === "additional") return "manager_approved";
  return "manager_approved"; // finance sees manager_approved (no additional) or additional_approved
}

function stageLabel(stage: ExpenseApprovalStage): string {
  if (stage === "manager") return "manager approval";
  if (stage === "additional") return "additional approval";
  return "finance payment confirmation";
}

function resolveStage({
  requestedStage,
  canManagerApprove,
  canFinanceApprove,
  isNamedAdditionalApprover = false
}: {
  requestedStage: ExpenseApprovalStage | undefined;
  canManagerApprove: boolean;
  canFinanceApprove: boolean;
  /** Named on ≥1 routed expense — may open the additional queue with no other role. */
  isNamedAdditionalApprover?: boolean;
}): ExpenseApprovalStage | null {
  const stage =
    requestedStage ??
    (canManagerApprove
      ? "manager"
      : canFinanceApprove
        ? "finance"
        : isNamedAdditionalApprover
          ? "additional"
          : null);

  if (!stage) {
    return null;
  }

  if (stage === "manager" && !canManagerApprove) {
    return null;
  }

  // Additional stage: anyone who is a configured additional approver can view
  // We allow it through — filtering happens in the query by additional_approver_id
  if (stage === "additional") {
    return stage;
  }

  if (stage === "finance" && !canFinanceApprove) {
    return null;
  }

  return stage;
}

function formatMinorUnits(amount: number, currency: string): string {
  return formatCurrency(parseIntegerAmount(amount) / 100, currency);
}

async function getManagerStageScope({
  supabase,
  orgId,
  userId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
  userId: string;
}): Promise<ApproverScope> {
  return getEffectiveApproverScope({
    supabase,
    orgId,
    userId,
    scope: "expense"
  });
}

async function listFinanceAdminIds({
  supabase,
  orgId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
}): Promise<string[]> {
  const { data: rows, error } = await supabase
    .from("profiles")
    .select("id, roles")
    .eq("org_id", orgId)
    .is("deleted_at", null);

  if (error) {
    logger.error("Unable to load finance admin recipients for expense bulk approval.", {
      orgId,
      message: error.message
    });

    return [];
  }

  const parsedRows = z.array(approverProfileSchema).safeParse(rows ?? []);

  if (!parsedRows.success) {
    return [];
  }

  return parsedRows.data
    .filter((row) => row.roles?.includes("FINANCE_ADMIN") || row.roles?.includes("FINANCE_APPROVER"))
    .map((row) => row.id);
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view expense approvals."
      },
      meta: buildMeta()
    });
  }

  const profile = session.profile;
  const canManagerApprove = canManagerApproveExpenses(profile.roles);
  const canFinanceApprove = canFinanceApproveExpenses(profile.roles);
  const svcClient = createSupabaseServiceRoleClient();

  /* Routing rules can name ANY employee as an additional approver
   * (approver_type = specific_person). Someone with no manager/finance role
   * can still be the only person able to move those expenses — they must be
   * able to open their queue. */
  let isNamedAdditionalApprover = false;
  if (!canManagerApprove && !canFinanceApprove) {
    const namedCount = await countAdditionalExpenses({
      supabase: svcClient,
      orgId: profile.org_id,
      userId: profile.id
    });
    isNamedAdditionalApprover = namedCount > 0;

    if (!isNamedAdditionalApprover) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "You are not allowed to view expense approvals."
        },
        meta: buildMeta()
      });
    }
  }

  const requestUrl = new URL(request.url);
  const parsedQuery = approvalsQuerySchema.safeParse(
    Object.fromEntries(requestUrl.searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid approvals query."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;
  const stage = resolveStage({
    requestedStage: query.stage,
    canManagerApprove,
    canFinanceApprove,
    isNamedAdditionalApprover
  });

  if (!stage) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You do not have permission to view this approval stage."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const isSuperAdmin = hasRole(profile.roles, "SUPER_ADMIN");

  let allowedEmployeeIds: string[] = [];
  if (stage === "manager" && !isSuperAdmin) {
    const scope = await getManagerStageScope({
      supabase,
      orgId: profile.org_id,
      userId: profile.id
    });

    allowedEmployeeIds = [...scope.directReportIds, ...scope.delegatedReportIds];

    if (allowedEmployeeIds.length === 0) {
      return jsonResponse<ExpenseApprovalsResponseData>(200, {
        data: {
          stage,
          expenses: [],
          pendingCount: 0,
          pendingAmountByCurrency: {}
        },
        error: null,
        meta: buildMeta()
      });
    }
  }

  let expenseQuery = svcClient
    .from("expenses")
    .select(expenseSelectColumns)
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (stage === "manager") {
    expenseQuery = expenseQuery.eq("status", "pending");
    if (!isSuperAdmin) {
      expenseQuery = expenseQuery.in("employee_id", allowedEmployeeIds);
    }
  } else if (stage === "additional") {
    // Show manager_approved expenses that require additional approval
    expenseQuery = expenseQuery
      .eq("status", "manager_approved")
      .eq("requires_additional_approval", true);
    if (!isSuperAdmin) {
      // Only show expenses where this user is the additional approver
      expenseQuery = expenseQuery.eq("additional_approver_id", profile.id);
    }
  } else {
    // Finance stage: show expenses ready for payment
    // manager_approved where no additional needed, OR additional_approved, OR legacy approved
    expenseQuery = expenseQuery.or(
      "and(status.eq.manager_approved,requires_additional_approval.eq.false)," +
      "status.eq.additional_approved," +
      "status.eq.approved"
    );
  }

  if (query.month) {
    const range = monthDateRange(query.month);

    if (!range) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Month must be in YYYY-MM format."
        },
        meta: buildMeta()
      });
    }

    expenseQuery = expenseQuery.gte("expense_date", range.startDate).lte("expense_date", range.endDate);
  }

  const { data: rawExpenses, error: expensesError } = await expenseQuery;

  if (expensesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_APPROVALS_FETCH_FAILED",
        message: `Unable to load expenses for ${stageLabel(stage)}.`
      },
      meta: buildMeta()
    });
  }

  const parsedExpenses = z.array(expenseRowSchema).safeParse(rawExpenses ?? []);

  if (!parsedExpenses.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_APPROVALS_PARSE_FAILED",
        message: "Pending expenses are not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  if (parsedExpenses.data.length === 0) {
    return jsonResponse<ExpenseApprovalsResponseData>(200, {
      data: {
        stage,
        expenses: [],
        pendingCount: 0,
        pendingAmountByCurrency: {}
      },
      error: null,
      meta: buildMeta()
    });
  }

  const latestCommentStates = await loadLatestExpenseCommentStates({
    supabase: svcClient,
    orgId: profile.org_id,
    expenseIds: parsedExpenses.data.map((row) => row.id)
  });
  const attachmentsByExpenseId = await loadExpenseAttachments({
    supabase: svcClient,
    orgId: profile.org_id,
    expenseIds: parsedExpenses.data.map((row) => row.id)
  });
  const commentAuthorIds = [...new Set(
    [...latestCommentStates.values()]
      .map((state) => state.updatedBy)
      .filter((id): id is string => Boolean(id))
  )];

  const profileIds = [...new Set([...collectProfileIds(parsedExpenses.data), ...commentAuthorIds])];
  const { data: rawProfiles, error: profilesError } = await svcClient
    .from("profiles")
    .select("id, full_name, department, country_code, manager_id")
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .in("id", profileIds);

  if (profilesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_APPROVAL_PROFILES_FETCH_FAILED",
        message: "Unable to resolve expense profile metadata."
      },
      meta: buildMeta()
    });
  }

  const parsedProfiles = z.array(profileRowSchema).safeParse(rawProfiles ?? []);

  if (!parsedProfiles.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_APPROVAL_PROFILES_PARSE_FAILED",
        message: "Expense profile metadata is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const profileById = new Map(parsedProfiles.data.map((row) => [row.id, row] as const));
  const expenses = parsedExpenses.data.map((row) => {
    const baseExpense = toExpenseRecord(row, profileById, attachmentsByExpenseId);
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
  const pendingAmountByCurrency: CurrencyAmounts = {};
  for (const expense of expenses) {
    addCurrencyAmount(pendingAmountByCurrency, expense.currency, expense.amount);
  }

  const responseData: ExpenseApprovalsResponseData = {
    stage,
    expenses,
    pendingCount: expenses.length,
    pendingAmountByCurrency
  };

  return jsonResponse<ExpenseApprovalsResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to approve expenses."
      },
      meta: buildMeta()
    });
  }

  const profile = session.profile;
  const canManagerApprove = canManagerApproveExpenses(profile.roles);
  const canFinanceApprove = canFinanceApproveExpenses(profile.roles);

  if (!canManagerApprove && !canFinanceApprove) {
    /* Named additional approvers may bulk-process their own queue; the
     * per-expense filter below still restricts rows to ones naming them. */
    const namedCount = await countAdditionalExpenses({
      supabase: createSupabaseServiceRoleClient(),
      orgId: profile.org_id,
      userId: profile.id
    });

    if (namedCount === 0) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "You are not allowed to bulk approve expenses."
        },
        meta: buildMeta()
      });
    }
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

  const parsedPayload = bulkApprovePayloadSchema.safeParse(body);

  if (!parsedPayload.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedPayload.error.issues[0]?.message ?? "Invalid bulk approval payload."
      },
      meta: buildMeta()
    });
  }

  const payload: ExpenseBulkApprovePayload = parsedPayload.data;
  const stage = resolveStage({
    requestedStage: payload.stage,
    canManagerApprove,
    canFinanceApprove
  });

  if (!stage) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You do not have permission to bulk process this stage."
      },
      meta: buildMeta()
    });
  }

  if (stage === "finance") {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Bulk mark paid is disabled. Each expense must include an uploaded payment proof receipt."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const svcClient = createSupabaseServiceRoleClient();
  const isSuperAdmin = hasRole(profile.roles, "SUPER_ADMIN");
  const nowIso = new Date().toISOString();
  const currentMonth = currentMonthKey();

  // Build the target query based on stage
  let targetQuery = svcClient
    .from("expenses")
    .select(expenseSelectColumns)
    .eq("org_id", profile.org_id)
    .in("id", payload.expenseIds)
    .is("deleted_at", null);

  if (stage === "manager") {
    targetQuery = targetQuery.eq("status", "pending");
  } else if (stage === "additional") {
    targetQuery = targetQuery
      .eq("status", "manager_approved")
      .eq("requires_additional_approval", true);
  } else {
    /* Finance stage: only expenses actually ready for payment can be bulk
     * reimbursed — mirrors the approvals listing eligibility. Without this,
     * arbitrary expense IDs (pending, rejected) could be marked reimbursed. */
    targetQuery = targetQuery.or(
      "and(status.eq.manager_approved,requires_additional_approval.eq.false)," +
      "status.eq.additional_approved," +
      "status.eq.approved"
    );
  }

  const { data: rawTargetRows, error: targetRowsError } = await targetQuery;

  if (targetRowsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_APPROVAL_FETCH_FAILED",
        message: "Unable to load selected expenses."
      },
      meta: buildMeta()
    });
  }

  const parsedTargetRows = z.array(expenseRowSchema).safeParse(rawTargetRows ?? []);

  if (!parsedTargetRows.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_APPROVAL_PARSE_FAILED",
        message: "Selected expenses are not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  let allowedRows = parsedTargetRows.data;
  let managerStageScope: ApproverScope | null = null;

  if (stage === "manager" && !isSuperAdmin) {
    const currentUserId = profile.id;
    managerStageScope = await getManagerStageScope({
      supabase,
      orgId: profile.org_id,
      userId: profile.id
    });

    const reportIdSet = new Set([
      ...managerStageScope.directReportIds,
      ...managerStageScope.delegatedReportIds
    ]);

    // No self-approval: exclude expenses submitted by the approver
    allowedRows = allowedRows.filter(
      (row) => reportIdSet.has(row.employee_id) && row.employee_id !== currentUserId
    );
  }

  let additionalStageScope: ApproverScope | null = null;

  if (stage === "additional" && !isSuperAdmin) {
    // Allow expenses where this user is the additional approver, or is a
    // delegate covering for the assigned additional approver — the same
    // rules canApproveAtStage applies on the individual route.
    additionalStageScope = await getManagerStageScope({
      supabase,
      orgId: profile.org_id,
      userId: profile.id
    });
    const coveredPrincipalIds = new Set(
      additionalStageScope.coveringFor.map((entry) => entry.principalId)
    );

    allowedRows = allowedRows.filter((row) => {
      const approverId = row.additional_approver_id ?? null;
      return (
        row.employee_id !== profile.id &&
        approverId !== null &&
        (approverId === profile.id || coveredPrincipalIds.has(approverId))
      );
    });
  }

  const allowedIds = allowedRows.map((row) => row.id);
  const skippedIds = payload.expenseIds.filter((id) => !allowedIds.includes(id));

  if (allowedIds.length === 0) {
    return jsonResponse<ExpenseBulkApproveResponseData>(200, {
      data: {
        stage,
        expenses: [],
        approvedCount: 0,
        skippedIds,
        failedIds: []
      },
      error: null,
      meta: buildMeta()
    });
  }

  const batchReference = `EXP-${currentMonth.replace("-", "")}-${Date.now()}`;

  // For manager stage, resolve delegation context per expense and group by context
  // to minimize DB round-trips while maintaining per-item audit accuracy.
  let updatedRowsRaw: unknown[] | null = null;
  // APPROVAL-02: collect per-group failures so a later group error no longer
  // discards the groups that already committed. A permission error fails closed;
  // a transient error on one group surfaces those ids as failedIds while the
  // successful groups are still audited and reported.
  const failedIds: string[] = [];
  let permissionDenied = false;
  function recordGroupError(error: { code?: string; message: string }, ids: string[]) {
    if (error.code === "42501" || error.code === "PGRST301") {
      permissionDenied = true;
    }
    failedIds.push(...ids);
  }

  if (stage === "additional") {
    // Group by delegation context (direct vs covering for the assigned
    // additional approver) so each update records the correct
    // additional_acting_for / additional_delegate_type for the audit trail.
    type AdditionalGroup = {
      ids: string[];
      actingFor: string | null;
      delegateType: string | null;
    };

    const additionalGroups = new Map<string, AdditionalGroup>();

    for (const row of allowedRows) {
      const approverId = row.additional_approver_id ?? null;
      const coveringEntry =
        approverId && approverId !== profile.id && additionalStageScope
          ? additionalStageScope.coveringFor.find((entry) => entry.principalId === approverId) ?? null
          : null;
      const key = coveringEntry ? coveringEntry.principalId : "direct";

      if (!additionalGroups.has(key)) {
        additionalGroups.set(key, {
          ids: [],
          actingFor: coveringEntry ? coveringEntry.principalId : null,
          delegateType: coveringEntry ? coveringEntry.delegateType : null
        });
      }

      additionalGroups.get(key)!.ids.push(row.id);
    }

    const allUpdatedAdditionalRows: unknown[] = [];

    for (const group of additionalGroups.values()) {
      const { data: groupRows, error: groupError } = await svcClient
        .from("expenses")
        .update({
          status: "additional_approved" as const,
          additional_approved_by: profile.id,
          additional_approved_at: nowIso,
          additional_acting_for: group.actingFor,
          additional_delegate_type: group.delegateType,
          additional_rejected_by: null,
          additional_rejected_at: null,
          additional_rejection_reason: null
        })
        .eq("org_id", profile.org_id)
        .in("id", group.ids)
        /* Apply only to rows still awaiting this stage — concurrent
         * transitions must not be overwritten. */
        .eq("status", "manager_approved")
        .select(expenseSelectColumns);

      if (groupError) {
        recordGroupError(groupError, group.ids);
        continue;
      }

      if (groupRows) {
        allUpdatedAdditionalRows.push(...groupRows);
      }
    }

    updatedRowsRaw = allUpdatedAdditionalRows;
  } else if (stage === "manager") {
    type DelegationGroup = {
      ids: string[];
      actingFor: string | null;
      delegateType: string | null;
    };

    const groups = new Map<string, DelegationGroup>();

    for (const row of allowedRows) {
      const ctx = managerStageScope
        ? resolveDelegationContext(row.employee_id, managerStageScope)
        : { actingFor: null, delegateType: null };

      const key = ctx.actingFor ?? "direct";

      if (!groups.has(key)) {
        groups.set(key, {
          ids: [],
          actingFor: ctx.actingFor,
          delegateType: ctx.delegateType
        });
      }

      groups.get(key)!.ids.push(row.id);
    }

    const allUpdatedRows: unknown[] = [];

    for (const group of groups.values()) {
      const { data: groupRows, error: groupError } = await svcClient
        .from("expenses")
        .update({
          status: "manager_approved" as const,
          manager_approved_by: profile.id,
          manager_approved_at: nowIso,
          manager_acting_for: group.actingFor,
          manager_delegate_type: group.delegateType,
          approved_by: profile.id,
          approved_at: nowIso,
          rejected_by: null,
          rejected_at: null,
          rejection_reason: null,
          finance_rejected_by: null,
          finance_rejected_at: null,
          finance_rejection_reason: null
        })
        .eq("org_id", profile.org_id)
        .in("id", group.ids)
        /* Apply only to rows still awaiting this stage — concurrent
         * transitions must not be overwritten. */
        .eq("status", "pending")
        .select(expenseSelectColumns);

      if (groupError) {
        recordGroupError(groupError, group.ids);
        continue;
      }

      if (groupRows) {
        allUpdatedRows.push(...groupRows);
      }
    }

    updatedRowsRaw = allUpdatedRows;
  } else {
    const financeResult = await svcClient
      .from("expenses")
      .update({
        status: "reimbursed" as const,
        finance_approved_by: profile.id,
        finance_approved_at: nowIso,
        reimbursed_by: profile.id,
        reimbursed_at: nowIso,
        reimbursement_reference: batchReference,
        reimbursement_notes: "Bulk reimbursement run",
        finance_rejected_by: null,
        finance_rejected_at: null,
        finance_rejection_reason: null
      })
      .eq("org_id", profile.org_id)
      .in("id", allowedIds)
      /* Apply only to rows still in a payable state — concurrent
       * transitions must not be overwritten. */
      .or(
        "and(status.eq.manager_approved,requires_additional_approval.eq.false)," +
        "status.eq.additional_approved," +
        "status.eq.approved"
      )
      .select(expenseSelectColumns);

    if (financeResult.error) {
      recordGroupError(financeResult.error, allowedIds);
      updatedRowsRaw = [];
    } else {
      updatedRowsRaw = financeResult.data;
    }
  }

  // APPROVAL-02: only fail the whole request when NOTHING committed. A
  // permission denial with no successes is a 403; any other total failure is a
  // 500. When some groups committed, we proceed and report failedIds precisely
  // rather than returning an ambiguous blanket failure that hides the commits.
  const anySucceeded = (updatedRowsRaw ?? []).length > 0;
  if (!anySucceeded && failedIds.length > 0) {
    return jsonResponse<null>(permissionDenied ? 403 : 500, {
      data: null,
      error: {
        code: permissionDenied ? "FORBIDDEN" : "EXPENSE_BULK_APPROVE_FAILED",
        message: permissionDenied
          ? "You are not allowed to bulk process the selected expenses."
          : "Unable to process the selected expenses."
      },
      meta: buildMeta()
    });
  }

  const parsedUpdatedRows = z.array(expenseRowSchema).safeParse(updatedRowsRaw ?? []);

  if (!parsedUpdatedRows.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_BULK_APPROVE_PARSE_FAILED",
        message: "Processed expenses are not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const profileIds = collectProfileIds(parsedUpdatedRows.data);
  const { data: rawProfiles, error: profilesError } = await svcClient
    .from("profiles")
    .select("id, full_name, department, country_code, manager_id")
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .in("id", profileIds);

  if (profilesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_BULK_APPROVE_PROFILES_FETCH_FAILED",
        message: "Unable to resolve profile metadata for processed expenses."
      },
      meta: buildMeta()
    });
  }

  const parsedProfiles = z.array(profileRowSchema).safeParse(rawProfiles ?? []);

  if (!parsedProfiles.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_BULK_APPROVE_PROFILES_PARSE_FAILED",
        message: "Processed expense profile metadata is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const profileById = new Map(parsedProfiles.data.map((row) => [row.id, row] as const));
  const bulkAttachmentsByExpenseId = await loadExpenseAttachments({
    supabase: svcClient,
    orgId: profile.org_id,
    expenseIds: parsedUpdatedRows.data.map((row) => row.id)
  });
  const expenses = parsedUpdatedRows.data.map((row) =>
    toExpenseRecord(row, profileById, bulkAttachmentsByExpenseId)
  );
  const employeeIds = [...new Set(expenses.map((expense) => expense.employeeId))];

  /* One audit record per expense so "who approved expense X" is queryable by
   * recordId, plus the bulk context on every entry. All stages are approvals,
   * so they log as "approved" with the stage disambiguated in newValue. */
  await logAuditBatch(
    parsedUpdatedRows.data.map((row) => ({
      action: "approved" as const,
      tableName: "expenses",
      recordId: row.id,
      oldValue: null,
      newValue: {
        bulk: true,
        stage,
        status: row.status,
        batchSize: expenses.length
      }
    }))
  );

  if (stage === "additional") {
    await createBulkNotifications({
      orgId: profile.org_id,
      userIds: employeeIds,
      type: "expense_status",
      title: "Expense additionally approved",
      body: `Your expense received additional approval and is pending finance payment confirmation.`,
      link: "/expenses"
    });

    const financeAdminIds = await listFinanceAdminIds({
      supabase,
      orgId: profile.org_id
    });

    await createBulkNotifications({
      orgId: profile.org_id,
      userIds: financeAdminIds,
      type: "expense_status",
      title: "Expenses ready for payment confirmation",
      body: `${expenses.length} expense${expenses.length === 1 ? "" : "s"} received additional approval and are ready for finance payment confirmation.`,
      link: "/expenses/approvals"
    });
  } else if (stage === "manager") {
    const coveringFor = managerStageScope?.coveringFor ?? [];
    const delegationSuffix = coveringFor.length > 0
      ? ` (covering for ${coveringFor.map((c) => c.principalName).join(", ")})`
      : "";

    await createBulkNotifications({
      orgId: profile.org_id,
      userIds: employeeIds,
      type: "expense_status",
      title: "Expense manager-approved",
      body: `Your expense was approved by ${profile.full_name}${delegationSuffix} and is pending finance payment confirmation.`,
      link: "/expenses"
    });

    const financeAdminIds = await listFinanceAdminIds({
      supabase,
      orgId: profile.org_id
    });

    await createBulkNotifications({
      orgId: profile.org_id,
      userIds: financeAdminIds,
      type: "expense_status",
      title: "Expenses ready for payment confirmation",
      body: `${expenses.length} expense${expenses.length === 1 ? "" : "s"} are ready for finance payment confirmation.`,
      link: "/expenses/approvals"
    });
  } else {
    await Promise.all(
      expenses.map((expense) =>
        createNotification({
          orgId: profile.org_id,
          userId: expense.employeeId,
          type: "expense_status",
          title: "Expense reimbursed",
          body: `Your expense of ${formatMinorUnits(expense.amount, expense.currency)} has been reimbursed. Reference: ${expense.reimbursementReference ?? batchReference}.`,
          link: "/expenses"
        })
      )
    );

    // Fire-and-forget email notifications for bulk payment confirmations
    for (const expense of expenses) {
      sendExpenseDisbursedEmail({
        orgId: profile.org_id,
        userId: expense.employeeId,
        amount: formatMinorUnits(expense.amount, expense.currency),
        description: expense.description
      }).catch(err => console.error('Email send failed:', err));
    }
  }

  // APPROVAL-02: account for EVERY input id precisely. An id is approved (in
  // `expenses`), failed (group errored), or skipped — where skipped now also
  // includes "stale" rows that were allowed but whose conditional status guard
  // matched nothing (a concurrent transition already moved them).
  const approvedIdSet = new Set(expenses.map((expense) => expense.id));
  const failedIdSet = new Set(failedIds);
  const preciseSkippedIds = payload.expenseIds.filter(
    (id) => !approvedIdSet.has(id) && !failedIdSet.has(id)
  );

  const responseData: ExpenseBulkApproveResponseData = {
    stage,
    expenses,
    approvedCount: expenses.length,
    skippedIds: preciseSkippedIds,
    failedIds
  };

  return jsonResponse<ExpenseBulkApproveResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
