import { z } from "zod";

import { logAudit } from "../../../../lib/audit";
import { formatCurrency } from "../../../../lib/format-currency";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { fetchExpensesData } from "../../../../lib/expenses/fetch-expenses-data";
import { loadExpenseAttachments } from "../../../../lib/expenses/fetch-expense-attachments";
import { sendExpenseSubmittedEmail } from "../../../../lib/notifications/email";
import { createBulkNotifications } from "../../../../lib/notifications/service";
import {
  isIsoMonth,
  normalizeCurrency,
  sanitizeFileName,
  RECEIPTS_BUCKET_NAME
} from "../../../../lib/expenses";
import { collectAndValidateReceiptFiles } from "../../../../lib/expenses/receipt-upload";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { resolveExpenseRoute } from "../../../../lib/expense-routing";
import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import type { ExpenseMutationResponseData, ExpensesListResponseData } from "../../../../types/expenses";
import {
  buildMeta,
  expenseCategorySchema,
  expenseRowSchema,
  expenseSelectColumns,
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

async function cleanupUploadedFiles(filePaths: string[]): Promise<void> {
  if (filePaths.length === 0) {
    return;
  }

  try {
    const supabase = await createSupabaseServerClient();
    await supabase.storage.from(RECEIPTS_BUCKET_NAME).remove(filePaths);
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

  try {
    const data = await fetchExpensesData(session.profile, {
      status: parsedQuery.data.status,
      month: parsedQuery.data.month
    });

    return jsonResponse<ExpensesListResponseData>(200, {
      data,
      error: null,
      meta: buildMeta()
    }, {
      "Cache-Control": "private, max-age=60, stale-while-revalidate=120",
      "Vary": "Cookie"
    });
  } catch {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSES_FETCH_FAILED",
        message: "Unable to load expenses."
      },
      meta: buildMeta()
    });
  }
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

  const receiptCollection = await collectAndValidateReceiptFiles(formData);

  if ("error" in receiptCollection) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: receiptCollection.error
      },
      meta: buildMeta()
    });
  }

  const receiptFiles = receiptCollection.files;

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
  const expenseId = crypto.randomUUID();

  const uploadedAttachments: Array<{
    filePath: string;
    fileName: string;
    fileSizeBytes: number;
    mimeType: string;
  }> = [];

  for (const [index, file] of receiptFiles.entries()) {
    const safeFileName = sanitizeFileName(file.name);
    const storagePath = `${session.profile.org_id}/${session.profile.id}/${expenseId}/${Date.now()}-${index}-${safeFileName}`;
    const contentType = file.type || "application/octet-stream";

    const { error: uploadError } = await supabase.storage
      .from(RECEIPTS_BUCKET_NAME)
      .upload(storagePath, file, {
        upsert: false,
        contentType
      });

    if (uploadError) {
      await cleanupUploadedFiles(uploadedAttachments.map((attachment) => attachment.filePath));

      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "RECEIPT_UPLOAD_FAILED",
          message: "Unable to upload receipt file."
        },
        meta: buildMeta()
      });
    }

    uploadedAttachments.push({
      filePath: storagePath,
      fileName: safeFileName,
      fileSizeBytes: file.size,
      mimeType: contentType
    });
  }

  /* The first uploaded file is the "primary" receipt kept on the expense row
   * for backward compatibility; all files are recorded in expense_attachments. */
  const filePath = uploadedAttachments[0]!.filePath;

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
    await cleanupUploadedFiles(uploadedAttachments.map((attachment) => attachment.filePath));

    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "EXPENSE_CREATE_FAILED",
        message: "Unable to create expense record."
      },
      meta: buildMeta()
    });
  }

  /* Record every uploaded document. The expense already carries the primary
   * receipt in receipt_file_path, so a failure here degrades to single-receipt
   * display rather than failing the whole submission. */
  const { error: attachmentsInsertError } = await supabase
    .from("expense_attachments")
    .insert(
      uploadedAttachments.map((attachment, index) => ({
        org_id: session.profile!.org_id,
        expense_id: expenseId,
        file_name: attachment.fileName,
        file_path: attachment.filePath,
        file_size_bytes: attachment.fileSizeBytes,
        mime_type: attachment.mimeType,
        sort_order: index
      }))
    );

  if (attachmentsInsertError) {
    console.error("expense_attachments insert failed", attachmentsInsertError);
  }

  // Evaluate routing rules to determine if additional approval is needed
  const svcClient = createSupabaseServiceRoleClient();
  const employeeDept = await (async () => {
    const { data: emp } = await svcClient
      .from("profiles")
      .select("department")
      .eq("id", session.profile!.id)
      .maybeSingle();
    return emp?.department as string | null;
  })();

  const route = await resolveExpenseRoute({
    supabase: svcClient,
    orgId: session.profile!.org_id,
    employeeId: session.profile!.id,
    department: employeeDept,
    amount,
    category: payload.category
  });

  if (route.requiresAdditionalApproval || route.matchedRuleId) {
    await svcClient
      .from("expenses")
      .update({
        requires_additional_approval: route.requiresAdditionalApproval,
        additional_approver_id: route.additionalApproverId,
        matched_rule_id: route.matchedRuleId
      })
      .eq("id", expenseId);
  }

  // Re-fetch the expense with routing fields populated
  const { data: routedExpense } = await svcClient
    .from("expenses")
    .select(expenseSelectColumns)
    .eq("id", expenseId)
    .single();

  const parsedExpense = expenseRowSchema.safeParse(routedExpense ?? insertedExpense);

  if (!parsedExpense.success) {
    await cleanupUploadedFiles(uploadedAttachments.map((attachment) => attachment.filePath));

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
  const attachmentsByExpenseId = await loadExpenseAttachments({
    supabase,
    orgId: session.profile.org_id,
    expenseIds: [expenseId]
  });
  const expense = toExpenseRecord(parsedExpense.data, profileById, attachmentsByExpenseId);
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
    const formattedAmount = formatCurrency(expense.amount / 100, currency);

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
