import { z } from "zod";

import { logAudit } from "../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { sendExpenseSubmittedEmail } from "../../../../lib/notifications/email";
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
  expenseSelectColumns,
  expenseStatusSchema,
  jsonResponse,
  profileRowSchema,
  toExpenseRecord
} from "./_helpers";
import { loadLatestExpenseCommentStates } from "./_comment-state";

const listQuerySchema = z.object({
  status: expenseStatusSchema.optional(),
  month: z
    .string()
    .optional()
    .refine((value) => (value ? isIsoMonth(value) : true), "Month must be in YYYY-MM format")
});

const createExpensePayloadSchema = z.object({
  category: expenseCategorySchema,
  customCategory: z.string().trim().max(100, "Custom category is too long").optional(),
  description: z.string().trim().min(1, "Description is required").max(3000, "Description is too long"),
  amount: z
    .string()
    .trim()
    .regex(/^\d+$/, "Amount must be a whole number in the smallest currency unit."),
  expenseDate: z.iso.date(),
  currency: z.string().trim().length(3).optional(),
  expenseType: z.enum(["personal_reimbursement", "work_expense"]).default("personal_reimbursement"),
  vendorName: z.string().trim().max(200, "Vendor name is too long").optional(),
  vendorPaymentMethod: z.enum(["bank_transfer", "mobile_money", "crew_tag", "international_wire"]).default("bank_transfer"),
  vendorBankAccountName: z.string().trim().max(200, "Bank account name is too long").optional(),
  vendorBankAccountNumber: z.string().trim().max(50, "Bank account number is too long").optional(),
  vendorMobileMoneyProvider: z.string().trim().max(200, "Mobile money provider is too long").optional(),
  vendorMobileMoneyNumber: z.string().trim().max(30, "Mobile money number is too long").optional(),
  vendorCrewTag: z.string().trim().max(100, "Crew Tag is too long").optional(),
  vendorWireBankName: z.string().trim().max(200, "Wire bank name is too long").optional(),
  vendorWireAccountNumber: z.string().trim().max(50, "Wire account number is too long").optional(),
  vendorWireSwiftBic: z.string().trim().max(20, "SWIFT/BIC code is too long").optional(),
  vendorWireIban: z.string().trim().max(50, "IBAN is too long").optional(),
  vendorWireBankCountry: z.string().trim().max(100, "Bank country is too long").optional(),
  vendorWireCurrency: z.string().trim().length(3, "Wire currency must be a 3-letter code").optional(),
  saveVendor: z.enum(["true", "false"]).optional()
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
    .select(expenseSelectColumns)
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

  const latestCommentStates = await loadLatestExpenseCommentStates({
    supabase,
    orgId: session.profile.org_id,
    expenseIds: parsedExpenses.data.map((row) => row.id)
  });

  const commentAuthorIds = [...new Set(
    [...latestCommentStates.values()]
      .map((state) => state.updatedBy)
      .filter((id): id is string => Boolean(id))
  )];

  const profileIds = [...new Set([...collectProfileIds(parsedExpenses.data), ...commentAuthorIds])];
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

  const expenses = parsedExpenses.data.map((row) => {
    const baseExpense = toExpenseRecord(row, profileById);
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
        message: "Receipt or invoice file is required."
      },
      meta: buildMeta()
    });
  }

  if (rawFile.size <= 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Uploaded receipt/invoice is empty."
      },
      meta: buildMeta()
    });
  }

  if (rawFile.size > MAX_RECEIPT_FILE_BYTES) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Receipt/invoice exceeds the 10MB upload limit."
      },
      meta: buildMeta()
    });
  }

  if (!isAllowedReceiptUpload(rawFile.name, rawFile.type)) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Unsupported file type. Allowed formats for receipt/invoice: pdf, png, jpg."
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
          "Receipt/invoice signature validation failed. Upload a file whose binary format matches the selected extension."
      },
      meta: buildMeta()
    });
  }

  const parsedPayload = createExpensePayloadSchema.safeParse({
    category: getFormString(formData, "category"),
    customCategory: getFormString(formData, "customCategory") || undefined,
    description: getFormString(formData, "description"),
    amount: getFormString(formData, "amount"),
    expenseDate: getFormString(formData, "expenseDate"),
    currency: getFormString(formData, "currency"),
    expenseType: getFormString(formData, "expenseType") || "personal_reimbursement",
    vendorName: getFormString(formData, "vendorName") || undefined,
    vendorPaymentMethod: (getFormString(formData, "vendorPaymentMethod") || "bank_transfer") as "bank_transfer" | "mobile_money" | "crew_tag" | "international_wire",
    vendorBankAccountName: getFormString(formData, "vendorBankAccountName") || undefined,
    vendorBankAccountNumber: getFormString(formData, "vendorBankAccountNumber") || undefined,
    vendorMobileMoneyProvider: getFormString(formData, "vendorMobileMoneyProvider") || undefined,
    vendorMobileMoneyNumber: getFormString(formData, "vendorMobileMoneyNumber") || undefined,
    vendorCrewTag: getFormString(formData, "vendorCrewTag") || undefined,
    vendorWireBankName: getFormString(formData, "vendorWireBankName") || undefined,
    vendorWireAccountNumber: getFormString(formData, "vendorWireAccountNumber") || undefined,
    vendorWireSwiftBic: getFormString(formData, "vendorWireSwiftBic") || undefined,
    vendorWireIban: getFormString(formData, "vendorWireIban") || undefined,
    vendorWireBankCountry: getFormString(formData, "vendorWireBankCountry") || undefined,
    vendorWireCurrency: getFormString(formData, "vendorWireCurrency") || undefined,
    saveVendor: getFormString(formData, "saveVendor") || undefined
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

  if (payload.expenseType === "work_expense") {
    if (!payload.vendorName?.trim()) {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Vendor name is required for work expenses."
        },
        meta: buildMeta()
      });
    }

    // Bank fields only required when vendor payment method is bank_transfer
    if (payload.vendorPaymentMethod === "bank_transfer") {
      if (!payload.vendorBankAccountName?.trim()) {
        return jsonResponse<null>(422, {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: "Vendor bank account name is required for bank transfer expenses."
          },
          meta: buildMeta()
        });
      }

      if (!payload.vendorBankAccountNumber?.trim()) {
        return jsonResponse<null>(422, {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: "Vendor bank account number is required for bank transfer expenses."
          },
          meta: buildMeta()
        });
      }
    }
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

  const mutationPayload: Record<string, unknown> = {
    id: expenseId,
    org_id: session.profile.org_id,
    employee_id: session.profile.id,
    expense_type: payload.expenseType,
    category: payload.category,
    custom_category: payload.category === "other" ? (payload.customCategory?.trim() || null) : null,
    description: payload.description.trim(),
    amount,
    currency: normalizeCurrency(payload.currency),
    receipt_file_path: filePath,
    expense_date: payload.expenseDate,
    status: "pending" as const,
    vendor_name: payload.expenseType === "work_expense" ? (payload.vendorName?.trim() || null) : null,
    vendor_payment_method: payload.expenseType === "work_expense" ? payload.vendorPaymentMethod : null,
    vendor_bank_account_name: payload.expenseType === "work_expense" ? (payload.vendorBankAccountName?.trim() || null) : null,
    vendor_bank_account_number: payload.expenseType === "work_expense" ? (payload.vendorBankAccountNumber?.trim() || null) : null,
    vendor_mobile_money_provider: payload.expenseType === "work_expense" ? (payload.vendorMobileMoneyProvider?.trim() || null) : null,
    vendor_mobile_money_number: payload.expenseType === "work_expense" ? (payload.vendorMobileMoneyNumber?.trim() || null) : null,
    vendor_crew_tag: payload.expenseType === "work_expense" ? (payload.vendorCrewTag?.trim() || null) : null,
    vendor_wire_bank_name: payload.expenseType === "work_expense" ? (payload.vendorWireBankName?.trim() || null) : null,
    vendor_wire_account_number: payload.expenseType === "work_expense" ? (payload.vendorWireAccountNumber?.trim() || null) : null,
    vendor_wire_swift_bic: payload.expenseType === "work_expense" ? (payload.vendorWireSwiftBic?.trim() || null) : null,
    vendor_wire_iban: payload.expenseType === "work_expense" ? (payload.vendorWireIban?.trim() || null) : null,
    vendor_wire_bank_country: payload.expenseType === "work_expense" ? (payload.vendorWireBankCountry?.trim() || null) : null,
    vendor_wire_currency: payload.expenseType === "work_expense" ? (payload.vendorWireCurrency?.trim() || null) : null
  };

  const { data: insertedExpense, error: insertExpenseError } = await supabase
    .from("expenses")
    .insert(mutationPayload)
    .select(expenseSelectColumns)
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

  if (
    payload.expenseType === "work_expense" &&
    payload.saveVendor === "true" &&
    payload.vendorName?.trim()
  ) {
    try {
      const vendorRow: Record<string, unknown> = {
        org_id: session.profile.org_id,
        employee_id: session.profile.id,
        vendor_name: payload.vendorName.trim(),
        payment_method: payload.vendorPaymentMethod,
        bank_account_name: payload.vendorBankAccountName?.trim() || null,
        bank_account_number: payload.vendorBankAccountNumber?.trim() || null,
        mobile_money_provider: payload.vendorMobileMoneyProvider?.trim() || null,
        mobile_money_number: payload.vendorMobileMoneyNumber?.trim() || null,
        crew_tag: payload.vendorCrewTag?.trim() || null,
        wire_bank_name: payload.vendorWireBankName?.trim() || null,
        wire_account_number: payload.vendorWireAccountNumber?.trim() || null,
        wire_swift_bic: payload.vendorWireSwiftBic?.trim() || null,
        wire_iban: payload.vendorWireIban?.trim() || null,
        wire_bank_country: payload.vendorWireBankCountry?.trim() || null,
        wire_currency: payload.vendorWireCurrency?.trim() || null
      };
      await supabase.from("vendor_beneficiaries").insert(vendorRow);
    } catch {
      // Non-critical — vendor save failure should not block expense creation
    }
  }

  const managerRecipientId = employeeProfile?.manager_id;

  if (managerRecipientId && managerRecipientId !== expense.employeeId) {
    await createBulkNotifications({
      orgId: session.profile.org_id,
      userIds: [managerRecipientId],
      type: "expense_submitted",
      title: `Expense submitted by ${expense.employeeName}`,
      body: `${expense.category} expense for ${expense.expenseDate} is pending approval.`,
      link: "/expenses/approvals",
      actions: [
        {
          label: "Approve",
          variant: "primary",
          action_type: "api",
          api_endpoint: `/api/v1/expenses/${expense.id}`,
          api_method: "PATCH",
          api_body: { action: "approve" }
        },
        {
          label: "View",
          variant: "outline",
          action_type: "navigate",
          navigate_url: "/expenses/approvals"
        }
      ]
    });
  }

  // Fire-and-forget email notification for expense submission
  if (employeeProfile?.manager_id) {
    const currency = expense.currency;
    const major = expense.amount / 100;
    let formattedAmount: string;
    try {
      formattedAmount = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(major);
    } catch {
      formattedAmount = `${currency} ${major.toFixed(2)}`;
    }

    sendExpenseSubmittedEmail({
      orgId: session.profile.org_id,
      userId: session.profile.id,
      managerId: employeeProfile.manager_id,
      amount: formattedAmount,
      description: expense.description
    }).catch(err => console.error('Email send failed:', err));
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
