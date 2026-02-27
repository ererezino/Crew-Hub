import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import {
  processMockPayment,
  resolvePaymentProvider
} from "../../../../../../lib/payments/provider";
import { normalizeCurrencyCode } from "../../../../../../lib/payroll/runs";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { PAYMENT_METHODS } from "../../../../../../types/payment-details";
import type { RetryPaymentResponseData } from "../../../../../../types/payments";
import {
  buildMeta,
  canManagePayments,
  jsonResponse,
  paymentLedgerRowSchema,
  toPaymentLedgerRecord
} from "../../_helpers";

const paramsSchema = z.object({
  id: z.string().uuid()
});

const payrollItemSchema = z.object({
  id: z.string().uuid(),
  payroll_run_id: z.string().uuid(),
  net_amount: z.union([z.number(), z.string()]),
  pay_currency: z.string().length(3)
});

const payrollRunSchema = z.object({
  id: z.string().uuid(),
  status: z.enum([
    "draft",
    "calculated",
    "pending_first_approval",
    "pending_final_approval",
    "approved",
    "processing",
    "completed",
    "cancelled"
  ])
});

const paymentDetailsSchema = z.object({
  payment_method: z.enum(PAYMENT_METHODS),
  change_effective_at: z.string(),
  bank_account_last4: z.string().nullable(),
  mobile_money_last4: z.string().nullable(),
  wise_recipient_id: z.string().nullable()
});

type PaymentMethod = (typeof PAYMENT_METHODS)[number];

type RouteContext = {
  params: Promise<{ id: string }>;
};

function parseAmount(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed)) {
    return 0;
  }

  return Math.trunc(parsed);
}

function isHoldActive(changeEffectiveAt: string): boolean {
  const effectiveTimestamp = Date.parse(changeEffectiveAt);

  if (Number.isNaN(effectiveTimestamp)) {
    return false;
  }

  return effectiveTimestamp > Date.now();
}

function mapLedgerStatusToPayrollStatus(
  status: "processing" | "completed" | "failed" | "cancelled"
): "processing" | "paid" | "failed" | "cancelled" {
  switch (status) {
    case "completed":
      return "paid";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "processing";
  }
}

function resolveRecipientId({
  employeeId,
  method,
  details
}: {
  employeeId: string;
  method: PaymentMethod;
  details: z.infer<typeof paymentDetailsSchema> | null;
}): string {
  if (!details) {
    return employeeId;
  }

  if (method === "wise") {
    return details.wise_recipient_id ?? employeeId;
  }

  if (method === "mobile_money") {
    return details.mobile_money_last4 ?? employeeId;
  }

  return details.bank_account_last4 ?? employeeId;
}

function mergeMetadata(
  current: unknown,
  next: Record<string, unknown>
): Record<string, unknown> {
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    return next;
  }

  return {
    ...(current as Record<string, unknown>),
    ...next
  };
}

async function updatePayrollItemPaymentState({
  supabase,
  orgId,
  payrollItemId,
  paymentId,
  status,
  paymentReference
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
  payrollItemId: string;
  paymentId: string;
  status: "processing" | "paid" | "failed" | "cancelled";
  paymentReference: string | null;
}) {
  const { error } = await supabase
    .from("payroll_items")
    .update({
      payment_status: status,
      payment_id: paymentId,
      payment_reference: paymentReference
    })
    .eq("org_id", orgId)
    .eq("id", payrollItemId);

  if (error) {
    throw new Error(`Unable to update payroll item payment status: ${error.message}`);
  }
}

async function refreshRunStatus({
  supabase,
  orgId,
  payrollRunId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
  payrollRunId: string;
}): Promise<"processing" | "completed"> {
  const { data: statusRows, error } = await supabase
    .from("payroll_items")
    .select("payment_status")
    .eq("org_id", orgId)
    .eq("payroll_run_id", payrollRunId)
    .is("deleted_at", null);

  if (error) {
    throw new Error(`Unable to load payroll item statuses: ${error.message}`);
  }

  const parsed = z
    .array(z.object({ payment_status: z.enum(["pending", "processing", "paid", "failed", "cancelled"]) }))
    .safeParse(statusRows ?? []);

  if (!parsed.success || parsed.data.length === 0) {
    const { error: updateError } = await supabase
      .from("payroll_runs")
      .update({ status: "processing" })
      .eq("org_id", orgId)
      .eq("id", payrollRunId);

    if (updateError) {
      throw new Error(`Unable to update payroll run status: ${updateError.message}`);
    }

    return "processing";
  }

  const nextStatus = parsed.data.every((row) => row.payment_status === "paid")
    ? "completed"
    : "processing";

  const { error: updateError } = await supabase
    .from("payroll_runs")
    .update({ status: nextStatus })
    .eq("org_id", orgId)
    .eq("id", payrollRunId);

  if (updateError) {
    throw new Error(`Unable to update payroll run status: ${updateError.message}`);
  }

  return nextStatus;
}

async function refreshBatchStatus({
  supabase,
  orgId,
  batchId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
  batchId: string;
}): Promise<"processing" | "completed" | "failed" | "cancelled"> {
  const { data: rows, error } = await supabase
    .from("payment_ledger")
    .select("status")
    .eq("org_id", orgId)
    .eq("batch_id", batchId)
    .is("deleted_at", null);

  if (error) {
    throw new Error(`Unable to load batch payment statuses: ${error.message}`);
  }

  const parsedRows = z
    .array(z.object({ status: z.enum(["processing", "completed", "failed", "cancelled"]) }))
    .safeParse(rows ?? []);

  if (!parsedRows.success || parsedRows.data.length === 0) {
    const { error: updateError } = await supabase
      .from("payment_batches")
      .update({ status: "cancelled" })
      .eq("org_id", orgId)
      .eq("id", batchId);

    if (updateError) {
      throw new Error(`Unable to update payment batch status: ${updateError.message}`);
    }

    return "cancelled";
  }

  const hasProcessing = parsedRows.data.some((row) => row.status === "processing");
  const hasFailed = parsedRows.data.some((row) => row.status === "failed");
  const nextStatus = hasProcessing
    ? "processing"
    : hasFailed
      ? "failed"
      : "completed";

  const { error: updateError } = await supabase
    .from("payment_batches")
    .update({ status: nextStatus })
    .eq("org_id", orgId)
    .eq("id", batchId);

  if (updateError) {
    throw new Error(`Unable to update payment batch status: ${updateError.message}`);
  }

  return nextStatus;
}

export async function POST(
  _request: Request,
  { params }: RouteContext
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to retry failed payments."
      },
      meta: buildMeta()
    });
  }

  if (!canManagePayments(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Finance Admin and Super Admin can retry payments."
      },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Payment id must be a valid UUID."
      },
      meta: buildMeta()
    });
  }

  try {
    const supabase = await createSupabaseServerClient();

    const { data: rawLedger, error: ledgerError } = await supabase
      .from("payment_ledger")
      .select(
        "id, org_id, payroll_item_id, employee_id, batch_id, amount, currency, payment_method, provider, provider_reference, idempotency_key, status, failure_reason, metadata, created_at, updated_at"
      )
      .eq("org_id", session.profile.org_id)
      .eq("id", parsedParams.data.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (ledgerError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYMENT_RETRY_FAILED",
          message: "Unable to load payment record."
        },
        meta: buildMeta()
      });
    }

    const parsedLedger = paymentLedgerRowSchema.safeParse(rawLedger);

    if (!parsedLedger.success) {
      return jsonResponse<null>(404, {
        data: null,
        error: {
          code: "NOT_FOUND",
          message: "Payment record not found."
        },
        meta: buildMeta()
      });
    }

    if (parsedLedger.data.status !== "failed") {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "INVALID_STATE",
          message: "Only failed payments can be retried."
        },
        meta: buildMeta()
      });
    }

    const [{ data: rawPayrollItem, error: payrollItemError }, { data: rawDetails, error: detailsError }] =
      await Promise.all([
        supabase
          .from("payroll_items")
          .select("id, payroll_run_id, net_amount, pay_currency")
          .eq("org_id", session.profile.org_id)
          .eq("id", parsedLedger.data.payroll_item_id)
          .is("deleted_at", null)
          .maybeSingle(),
        supabase
          .from("employee_payment_details")
          .select(
            "payment_method, change_effective_at, bank_account_last4, mobile_money_last4, wise_recipient_id"
          )
          .eq("org_id", session.profile.org_id)
          .eq("employee_id", parsedLedger.data.employee_id)
          .eq("is_primary", true)
          .is("deleted_at", null)
          .maybeSingle()
      ]);

    if (payrollItemError || detailsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYMENT_RETRY_FAILED",
          message:
            payrollItemError?.message ??
            detailsError?.message ??
            "Unable to load retry inputs."
        },
        meta: buildMeta()
      });
    }

    const parsedPayrollItem = payrollItemSchema.safeParse(rawPayrollItem);

    if (!parsedPayrollItem.success) {
      return jsonResponse<null>(404, {
        data: null,
        error: {
          code: "NOT_FOUND",
          message: "Payroll item for this payment was not found."
        },
        meta: buildMeta()
      });
    }

    const { data: runRow, error: actualRunError } = await supabase
      .from("payroll_runs")
      .select("id, status")
      .eq("org_id", session.profile.org_id)
      .eq("id", parsedPayrollItem.data.payroll_run_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (actualRunError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYMENT_RETRY_FAILED",
          message: "Unable to load payroll run."
        },
        meta: buildMeta()
      });
    }

    const parsedRun = payrollRunSchema.safeParse(runRow);

    if (!parsedRun.success) {
      return jsonResponse<null>(404, {
        data: null,
        error: {
          code: "NOT_FOUND",
          message: "Payroll run for this payment was not found."
        },
        meta: buildMeta()
      });
    }

    if (parsedRun.data.status === "cancelled") {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "INVALID_STATE",
          message: "Cannot retry payments for a cancelled payroll run."
        },
        meta: buildMeta()
      });
    }

    const { error: setProcessingError } = await supabase
      .from("payroll_runs")
      .update({ status: "processing" })
      .eq("org_id", session.profile.org_id)
      .eq("id", parsedRun.data.id);

    if (setProcessingError) {
      throw new Error(`Unable to set payroll run to processing: ${setProcessingError.message}`);
    }

    const parsedDetails = paymentDetailsSchema.safeParse(rawDetails);
    const details = parsedDetails.success ? parsedDetails.data : null;
    const amount = parseAmount(parsedPayrollItem.data.net_amount);
    const currency = normalizeCurrencyCode(parsedPayrollItem.data.pay_currency);
    const providerRoute = resolvePaymentProvider(currency);
    const paymentMethod = details?.payment_method ?? parsedLedger.data.payment_method;
    const recipientId = resolveRecipientId({
      employeeId: parsedLedger.data.employee_id,
      method: paymentMethod,
      details
    });

    const { error: resetLedgerError } = await supabase
      .from("payment_ledger")
      .update({
        amount,
        currency,
        payment_method: paymentMethod,
        provider: "mock",
        provider_reference: null,
        status: "processing",
        failure_reason: null,
        metadata: mergeMetadata(parsedLedger.data.metadata, {
          retriedAt: new Date().toISOString(),
          futureProvider: providerRoute.futureProvider,
          providerRoutedTo: providerRoute.provider
        })
      })
      .eq("org_id", session.profile.org_id)
      .eq("id", parsedLedger.data.id);

    if (resetLedgerError) {
      throw new Error(`Unable to reset payment for retry: ${resetLedgerError.message}`);
    }

    await updatePayrollItemPaymentState({
      supabase,
      orgId: session.profile.org_id,
      payrollItemId: parsedPayrollItem.data.id,
      paymentId: parsedLedger.data.id,
      status: "processing",
      paymentReference: null
    });

    const holdActive = details ? isHoldActive(details.change_effective_at) : false;

    let finalStatus: "completed" | "failed" = "failed";
    let providerReference: string | null = null;
    let failureReason: string | null = null;
    let delayMs = 0;

    if (!details || holdActive || amount <= 0) {
      finalStatus = "failed";
      failureReason = !details
        ? "Missing payment details."
        : holdActive
          ? "Payment details are in the 48-hour hold window."
          : "Payment amount must be greater than zero.";
    } else {
      const providerResult = await processMockPayment({
        amount,
        currency,
        idempotencyKey: parsedLedger.data.idempotency_key,
        paymentMethod,
        recipientId
      });

      finalStatus = providerResult.status;
      providerReference = providerResult.providerReference || null;
      failureReason =
        providerResult.status === "failed"
          ? providerResult.failureReason ?? "Mock provider failed."
          : null;
      delayMs = providerResult.processingDelayMs;
    }

    const { error: finalizeLedgerError } = await supabase
      .from("payment_ledger")
      .update({
        status: finalStatus,
        provider_reference: providerReference,
        failure_reason: failureReason,
        metadata: mergeMetadata(parsedLedger.data.metadata, {
          retriedAt: new Date().toISOString(),
          futureProvider: providerRoute.futureProvider,
          providerRoutedTo: providerRoute.provider,
          recipientId,
          delayMs
        })
      })
      .eq("org_id", session.profile.org_id)
      .eq("id", parsedLedger.data.id);

    if (finalizeLedgerError) {
      throw new Error(`Unable to finalize retried payment: ${finalizeLedgerError.message}`);
    }

    await updatePayrollItemPaymentState({
      supabase,
      orgId: session.profile.org_id,
      payrollItemId: parsedPayrollItem.data.id,
      paymentId: parsedLedger.data.id,
      status: mapLedgerStatusToPayrollStatus(finalStatus),
      paymentReference: providerReference
    });

    const batchStatus = await refreshBatchStatus({
      supabase,
      orgId: session.profile.org_id,
      batchId: parsedLedger.data.batch_id
    });

    const runStatus = await refreshRunStatus({
      supabase,
      orgId: session.profile.org_id,
      payrollRunId: parsedPayrollItem.data.payroll_run_id
    });

    await logAudit({
      action: "updated",
      tableName: "payment_ledger",
      recordId: parsedLedger.data.id,
      oldValue: {
        status: parsedLedger.data.status,
        failureReason: parsedLedger.data.failure_reason
      },
      newValue: {
        status: finalStatus,
        failureReason,
        providerReference,
        batchStatus,
        runStatus
      }
    });

    const { data: refreshedLedger, error: refreshedLedgerError } = await supabase
      .from("payment_ledger")
      .select(
        "id, org_id, payroll_item_id, employee_id, batch_id, amount, currency, payment_method, provider, provider_reference, idempotency_key, status, failure_reason, metadata, created_at, updated_at"
      )
      .eq("org_id", session.profile.org_id)
      .eq("id", parsedLedger.data.id)
      .is("deleted_at", null)
      .single();

    if (refreshedLedgerError) {
      throw new Error(`Unable to reload payment record: ${refreshedLedgerError.message}`);
    }

    const parsedRefreshedLedger = paymentLedgerRowSchema.safeParse(refreshedLedger);

    if (!parsedRefreshedLedger.success) {
      throw new Error("Retried payment record is invalid.");
    }

    const responseData: RetryPaymentResponseData = {
      payment: toPaymentLedgerRecord(parsedRefreshedLedger.data),
      batchStatus
    };

    return jsonResponse<RetryPaymentResponseData>(200, {
      data: responseData,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYMENT_RETRY_FAILED",
        message:
          error instanceof Error ? error.message : "Unable to retry payment."
      },
      meta: buildMeta()
    });
  }
}
