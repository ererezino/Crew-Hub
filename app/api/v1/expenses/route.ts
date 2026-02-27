import { z } from "zod";

import { logAudit } from "../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { createBulkNotifications } from "../../../../lib/notifications/service";
import {
  ALLOWED_RECEIPT_EXTENSIONS,
  isAllowedReceiptUpload,
  isIsoMonth,
  MAX_RECEIPT_FILE_BYTES,
  monthDateRange,
  normalizeCurrency,
  sanitizeFileName,
  summarizeExpenses,
  RECEIPTS_BUCKET_NAME
} from "../../../../lib/expenses";
import { validateUploadMagicBytes } from "../../../../lib/security/upload-signatures";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import type { ExpenseMutationResponseData, ExpensesListResponseData } from "../../../../types/expenses";
import {
  buildMeta,
  collectProfileIds,
  expenseCategorySchema,
  expenseRowSchema,
  expenseStatusSchema,
  jsonResponse,
  profileRowSchema,
  toExpenseRecord
} from "./_helpers";

const listQuerySchema = z.object({
  status: expenseStatusSchema.optional(),
  month: z
    .string()
    .optional()
    .refine((value) => (value ? isIsoMonth(value) : true), "Month must be in YYYY-MM format")
});

const createExpensePayloadSchema = z.object({
  category: expenseCategorySchema,
  description: z.string().trim().min(1, "Description is required").max(3000, "Description is too long"),
  amount: z
    .string()
    .trim()
    .regex(/^\d+$/, "Amount must be a whole number in the smallest currency unit."),
  expenseDate: z.iso.date(),
  currency: z.string().trim().length(3).optional()
});

function getFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function cleanupUploadedFile(filePath: string): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.storage.from(RECEIPTS_BUCKET_NAME).remove([filePath]);
  } catch {
    // Cleanup failure should not override the original mutation error.
  }
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view expenses."
      },
      meta: buildMeta()
    });
  }

  const requestUrl = new URL(request.url);
  const parsedQuery = listQuerySchema.safeParse(
    Object.fromEntries(requestUrl.searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid expenses query."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;
  const supabase = await createSupabaseServerClient();

  let expenseQuery = supabase
    .from("expenses")
    .select(
      "id, org_id, employee_id, category, description, amount, currency, receipt_file_path, expense_date, status, approved_by, approved_at, rejected_by, rejected_at, rejection_reason, reimbursed_by, reimbursed_at, reimbursement_reference, reimbursement_notes, created_at, updated_at"
    )
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (query.status) {
    expenseQuery = expenseQuery.eq("status", query.status);
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
        code: "EXPENSES_FETCH_FAILED",
        message: "Unable to load expenses."
      },
      meta: buildMeta()
    });
  }

  const parsedExpenses = z.array(expenseRowSchema).safeParse(rawExpenses ?? []);

  if (!parsedExpenses.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSES_PARSE_FAILED",
        message: "Expense records are not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const profileIds = collectProfileIds(parsedExpenses.data);
  let profileById = new Map<string, z.infer<typeof profileRowSchema>>();

  if (profileIds.length > 0) {
    const { data: rawProfiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name, department, country_code, manager_id")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .in("id", profileIds);

    if (profilesError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "EXPENSE_PROFILES_FETCH_FAILED",
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
          code: "EXPENSE_PROFILES_PARSE_FAILED",
          message: "Expense profile metadata is not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    profileById = new Map(parsedProfiles.data.map((row) => [row.id, row] as const));
  }

  const expenses = parsedExpenses.data.map((row) => toExpenseRecord(row, profileById));
  const summary = summarizeExpenses(expenses);

  const responseData: ExpensesListResponseData = {
    expenses,
    summary,
    month: query.month ?? null
  };

  return jsonResponse<ExpensesListResponseData>(200, {
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
        message: "You must be logged in to submit an expense."
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
      error: {
        code: "BAD_REQUEST",
        message: "Request must be multipart form data."
      },
      meta: buildMeta()
    });
  }

  const rawFile = formData.get("receipt");

  if (!(rawFile instanceof File)) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Receipt file is required."
      },
      meta: buildMeta()
    });
  }

  if (rawFile.size <= 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Uploaded receipt is empty."
      },
      meta: buildMeta()
    });
  }

  if (rawFile.size > MAX_RECEIPT_FILE_BYTES) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Receipt exceeds the 10MB upload limit."
      },
      meta: buildMeta()
    });
  }

  if (!isAllowedReceiptUpload(rawFile.name, rawFile.type)) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Unsupported file type. Allowed formats: pdf, png, jpg."
      },
      meta: buildMeta()
    });
  }

  const magicBytesResult = await validateUploadMagicBytes({
    file: rawFile,
    fileName: rawFile.name,
    allowedExtensions: ALLOWED_RECEIPT_EXTENSIONS
  });

  if (!magicBytesResult.valid) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message:
          "Receipt signature validation failed. Upload a file whose binary format matches the selected extension."
      },
      meta: buildMeta()
    });
  }

  const parsedPayload = createExpensePayloadSchema.safeParse({
    category: getFormString(formData, "category"),
    description: getFormString(formData, "description"),
    amount: getFormString(formData, "amount"),
    expenseDate: getFormString(formData, "expenseDate"),
    currency: getFormString(formData, "currency")
  });

  if (!parsedPayload.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedPayload.error.issues[0]?.message ?? "Invalid expense payload."
      },
      meta: buildMeta()
    });
  }

  const payload = parsedPayload.data;
  const amount = Number.parseInt(payload.amount, 10);

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Amount must be a positive whole number in the smallest currency unit."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const timestamp = Date.now();
  const safeFileName = sanitizeFileName(rawFile.name);
  const expenseId = crypto.randomUUID();
  const filePath = `${session.profile.org_id}/${session.profile.id}/${expenseId}/${timestamp}-${safeFileName}`;
  const contentType = rawFile.type || "application/octet-stream";

  const { error: uploadError } = await supabase.storage
    .from(RECEIPTS_BUCKET_NAME)
    .upload(filePath, rawFile, {
      upsert: false,
      contentType
    });

  if (uploadError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "RECEIPT_UPLOAD_FAILED",
        message: "Unable to upload receipt file."
      },
      meta: buildMeta()
    });
  }

  const mutationPayload = {
    id: expenseId,
    org_id: session.profile.org_id,
    employee_id: session.profile.id,
    category: payload.category,
    description: payload.description.trim(),
    amount,
    currency: normalizeCurrency(payload.currency),
    receipt_file_path: filePath,
    expense_date: payload.expenseDate,
    status: "pending" as const
  };

  const { data: insertedExpense, error: insertExpenseError } = await supabase
    .from("expenses")
    .insert(mutationPayload)
    .select(
      "id, org_id, employee_id, category, description, amount, currency, receipt_file_path, expense_date, status, approved_by, approved_at, rejected_by, rejected_at, rejection_reason, reimbursed_by, reimbursed_at, reimbursement_reference, reimbursement_notes, created_at, updated_at"
    )
    .single();

  if (insertExpenseError || !insertedExpense) {
    await cleanupUploadedFile(filePath);

    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_CREATE_FAILED",
        message: "Unable to create expense record."
      },
      meta: buildMeta()
    });
  }

  const parsedExpense = expenseRowSchema.safeParse(insertedExpense);

  if (!parsedExpense.success) {
    await cleanupUploadedFile(filePath);

    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_PARSE_FAILED",
        message: "Created expense record is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const { data: rawProfileRows, error: profileRowsError } = await supabase
    .from("profiles")
    .select("id, full_name, department, country_code, manager_id")
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .in("id", [session.profile.id]);

  if (profileRowsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_PROFILE_FETCH_FAILED",
        message: "Unable to resolve employee metadata for created expense."
      },
      meta: buildMeta()
    });
  }

  const parsedProfiles = z.array(profileRowSchema).safeParse(rawProfileRows ?? []);

  if (!parsedProfiles.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_PROFILE_PARSE_FAILED",
        message: "Employee metadata is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const profileById = new Map(parsedProfiles.data.map((row) => [row.id, row] as const));
  const expense = toExpenseRecord(parsedExpense.data, profileById);
  const employeeProfile = profileById.get(expense.employeeId) ?? null;

  await logAudit({
    action: "created",
    tableName: "expenses",
    recordId: expense.id,
    oldValue: null,
    newValue: {
      id: expense.id,
      employeeId: expense.employeeId,
      amount: expense.amount,
      currency: expense.currency,
      status: expense.status,
      expenseDate: expense.expenseDate,
      category: expense.category
    }
  });

  const { data: approvalRows, error: approvalError } = await supabase
    .from("profiles")
    .select("id, roles")
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null);

  if (approvalError) {
    console.error("Unable to load expense approval recipients.", {
      expenseId: expense.id,
      message: approvalError.message
    });
  } else {
    const adminApproverIds = (approvalRows ?? [])
      .filter((row) => {
        const roles = Array.isArray(row.roles)
          ? row.roles.filter((role): role is string => typeof role === "string")
          : [];

        return (
          roles.includes("FINANCE_ADMIN") ||
          roles.includes("HR_ADMIN") ||
          roles.includes("SUPER_ADMIN")
        );
      })
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string");

    const recipientIds = [
      ...(employeeProfile?.manager_id ? [employeeProfile.manager_id] : []),
      ...adminApproverIds
    ].filter((id) => id !== expense.employeeId);

    await createBulkNotifications({
      orgId: session.profile.org_id,
      userIds: recipientIds,
      type: "expense_submitted",
      title: `Expense submitted by ${expense.employeeName}`,
      body: `${expense.category} expense for ${expense.expenseDate} is pending approval.`,
      link: "/expenses/approvals"
    });
  }

  const responseData: ExpenseMutationResponseData = {
    expense
  };

  return jsonResponse<ExpenseMutationResponseData>(201, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
