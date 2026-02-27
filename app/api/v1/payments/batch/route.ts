import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { logAudit } from "../../../../../lib/audit";
import { decideIdempotencyAction } from "../../../../../lib/payments/idempotency";
import {
  processMockPayment,
  resolvePaymentProvider
} from "../../../../../lib/payments/provider";
import { addCurrencyTotal, normalizeCurrencyCode } from "../../../../../lib/payroll/runs";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { PAYMENT_METHODS } from "../../../../../types/payment-details";
import type {
  CreatePaymentBatchPayload,
  CreatePaymentBatchResponseData,
  PaymentBatchStatus,
  PaymentLedgerRecord
} from "../../../../../types/payments";
import {
  buildMeta,
  canManagePayments,
  jsonResponse,
  paymentBatchRowSchema,
  paymentLedgerRowSchema,
  toPaymentBatchRecord,
  toPaymentLedgerRecord
} from "../_helpers";

const bodySchema = z.object({
  payrollRunId: z.string().uuid()
});

const payrollRunSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  pay_period_end: z.string(),
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

const payrollItemSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  net_amount: z.union([z.number(), z.string()]),
  pay_currency: z.string().length(3),
  payment_status: z.enum(["pending", "processing", "paid", "failed", "cancelled"]),
  payment_id: z.string().uuid().nullable()
});

const paymentDetailsSchema = z.object({
  employee_id: z.string().uuid(),
  payment_method: z.enum(PAYMENT_METHODS),
  change_effective_at: z.string(),
  bank_account_last4: z.string().nullable(),
  mobile_money_last4: z.string().nullable(),
  wise_recipient_id: z.string().nullable()
});

type PaymentMethod = (typeof PAYMENT_METHODS)[number];

function parseAmount(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed)) {
    return 0;
  }

  return Math.trunc(parsed);
}

function payPeriodFromDate(payPeriodEnd: string): string {
  return payPeriodEnd.slice(0, 7);
}

function toIdempotencyKey({
  runId,
  employeeId,
  payPeriod
}: {
  runId: string;
  employeeId: string;
  payPeriod: string;
}) {
  return `${runId}-${employeeId}-${payPeriod}`;
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

function isHoldActive(changeEffectiveAt: string): boolean {
  const effectiveTimestamp = Date.parse(changeEffectiveAt);

  if (Number.isNaN(effectiveTimestamp)) {
    return false;
  }

  return effectiveTimestamp > Date.now();
}

function resolveRecipientId({
  employeeId,
  method,
  paymentDetails
}: {
  employeeId: string;
  method: PaymentMethod;
  paymentDetails: z.infer<typeof paymentDetailsSchema> | null;
}): string {
  if (!paymentDetails) {
    return employeeId;
  }

  if (method === "wise") {
    return paymentDetails.wise_recipient_id ?? employeeId;
  }

  if (method === "mobile_money") {
    return paymentDetails.mobile_money_last4 ?? employeeId;
  }

  return paymentDetails.bank_account_last4 ?? employeeId;
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
    throw new Error(`Unable to update payroll item payment state: ${error.message}`);
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
  const { data: statusRows, error: statusError } = await supabase
    .from("payroll_items")
    .select("payment_status")
    .eq("org_id", orgId)
    .eq("payroll_run_id", payrollRunId)
    .is("deleted_at", null);

  if (statusError) {
    throw new Error(`Unable to load payroll item statuses: ${statusError.message}`);
  }

  const parsedRows = z
    .array(z.object({ payment_status: z.enum(["pending", "processing", "paid", "failed", "cancelled"]) }))
    .safeParse(statusRows ?? []);

  if (!parsedRows.success || parsedRows.data.length === 0) {
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

  const nextStatus = parsedRows.data.every((row) => row.payment_status === "paid")
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
}): Promise<PaymentBatchStatus> {
  const { data: ledgerRows, error: ledgerError } = await supabase
    .from("payment_ledger")
    .select("status")
    .eq("org_id", orgId)
    .eq("batch_id", batchId)
    .is("deleted_at", null);

  if (ledgerError) {
    throw new Error(`Unable to load batch payments: ${ledgerError.message}`);
  }

  const parsedRows = z
    .array(z.object({ status: z.enum(["processing", "completed", "failed", "cancelled"]) }))
    .safeParse(ledgerRows ?? []);

  if (!parsedRows.success || parsedRows.data.length === 0) {
    const { error: updateError } = await supabase
      .from("payment_batches")
      .update({ status: "cancelled" })
      .eq("org_id", orgId)
      .eq("id", batchId);

    if (updateError) {
      throw new Error(`Unable to update batch status: ${updateError.message}`);
    }

    return "cancelled";
  }

  const hasFailures = parsedRows.data.some((row) => row.status === "failed");
  const hasInFlight = parsedRows.data.some((row) => row.status === "processing");

  const nextStatus: PaymentBatchStatus = hasInFlight
    ? "processing"
    : hasFailures
      ? "failed"
      : "completed";

  const { error: updateError } = await supabase
    .from("payment_batches")
    .update({ status: nextStatus })
    .eq("org_id", orgId)
    .eq("id", batchId);

  if (updateError) {
    throw new Error(`Unable to update batch status: ${updateError.message}`);
  }

  return nextStatus;
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to process payroll payments."
      },
      meta: buildMeta()
    });
  }

  if (!canManagePayments(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Finance Admin and Super Admin can process payroll payments."
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

  const parsedBody = bodySchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid payment batch payload."
      },
      meta: buildMeta()
    });
  }

  const payload = parsedBody.data as CreatePaymentBatchPayload;

  try {
    const supabase = await createSupabaseServerClient();

    const { data: rawRun, error: runError } = await supabase
      .from("payroll_runs")
      .select("id, org_id, pay_period_end, status")
      .eq("org_id", session.profile.org_id)
      .eq("id", payload.payrollRunId)
      .is("deleted_at", null)
      .maybeSingle();

    if (runError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYMENT_BATCH_CREATE_FAILED",
          message: "Unable to load payroll run."
        },
        meta: buildMeta()
      });
    }

    const parsedRun = payrollRunSchema.safeParse(rawRun);

    if (!parsedRun.success) {
      return jsonResponse<null>(404, {
        data: null,
        error: {
          code: "NOT_FOUND",
          message: "Payroll run not found."
        },
        meta: buildMeta()
      });
    }

    if (
      parsedRun.data.status !== "approved" &&
      parsedRun.data.status !== "processing" &&
      parsedRun.data.status !== "completed"
    ) {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "INVALID_STATE",
          message: "Payments can be processed only after payroll approval."
        },
        meta: buildMeta()
      });
    }

    const { data: rawItems, error: itemsError } = await supabase
      .from("payroll_items")
      .select("id, org_id, employee_id, net_amount, pay_currency, payment_status, payment_id")
      .eq("org_id", session.profile.org_id)
      .eq("payroll_run_id", payload.payrollRunId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    if (itemsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYMENT_BATCH_CREATE_FAILED",
          message: "Unable to load payroll items."
        },
        meta: buildMeta()
      });
    }

    const parsedItems = z.array(payrollItemSchema).safeParse(rawItems ?? []);

    if (!parsedItems.success || parsedItems.data.length === 0) {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "INVALID_STATE",
          message: "No payroll items available to process."
        },
        meta: buildMeta()
      });
    }

    const payPeriod = payPeriodFromDate(parsedRun.data.pay_period_end);
    const idempotencyKeys = parsedItems.data.map((item) =>
      toIdempotencyKey({
        runId: parsedRun.data.id,
        employeeId: item.employee_id,
        payPeriod
      })
    );

    const [{ data: rawExistingLedger, error: existingLedgerError }, { data: rawPaymentDetails, error: paymentDetailsError }] =
      await Promise.all([
        supabase
          .from("payment_ledger")
          .select(
            "id, org_id, payroll_item_id, employee_id, batch_id, amount, currency, payment_method, provider, provider_reference, idempotency_key, status, failure_reason, metadata, created_at, updated_at"
          )
          .eq("org_id", session.profile.org_id)
          .is("deleted_at", null)
          .in("idempotency_key", idempotencyKeys),
        supabase
          .from("employee_payment_details")
          .select(
            "employee_id, payment_method, change_effective_at, bank_account_last4, mobile_money_last4, wise_recipient_id"
          )
          .eq("org_id", session.profile.org_id)
          .eq("is_primary", true)
          .is("deleted_at", null)
          .in(
            "employee_id",
            parsedItems.data.map((item) => item.employee_id)
          )
      ]);

    if (existingLedgerError || paymentDetailsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYMENT_BATCH_CREATE_FAILED",
          message:
            existingLedgerError?.message ??
            paymentDetailsError?.message ??
            "Unable to load payment processing inputs."
        },
        meta: buildMeta()
      });
    }

    const parsedExistingLedger = z.array(paymentLedgerRowSchema).safeParse(rawExistingLedger ?? []);
    const parsedPaymentDetails = z.array(paymentDetailsSchema).safeParse(rawPaymentDetails ?? []);

    if (!parsedExistingLedger.success || !parsedPaymentDetails.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYMENT_BATCH_CREATE_FAILED",
          message: "Payment processing inputs are not in the expected format."
        },
        meta: buildMeta()
      });
    }

    const existingLedgerByKey = new Map(
      parsedExistingLedger.data.map((row) => [row.idempotency_key, row])
    );
    const paymentDetailsByEmployeeId = new Map(
      parsedPaymentDetails.data.map((row) => [row.employee_id, row])
    );

    const itemsNeedingProcessing = parsedItems.data.filter((item) => {
      const idempotencyKey = toIdempotencyKey({
        runId: parsedRun.data.id,
        employeeId: item.employee_id,
        payPeriod
      });
      const existing = existingLedgerByKey.get(idempotencyKey);
      return decideIdempotencyAction(existing?.status) !== "reject_duplicate";
    });
    const duplicateItems = parsedItems.data.filter((item) => {
      const idempotencyKey = toIdempotencyKey({
        runId: parsedRun.data.id,
        employeeId: item.employee_id,
        payPeriod
      });
      const existing = existingLedgerByKey.get(idempotencyKey);
      return decideIdempotencyAction(existing?.status) === "reject_duplicate";
    });

    if (itemsNeedingProcessing.length === 0 && duplicateItems.length > 0) {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "DUPLICATE_IDEMPOTENCY_KEY",
          message:
            "Duplicate payment idempotency keys were rejected. Failed payments can be retried."
        },
        meta: buildMeta()
      });
    }

    let batchId: string | null = null;

    if (itemsNeedingProcessing.length > 0) {
      let totalAmount: Record<string, number> = {};

      for (const item of itemsNeedingProcessing) {
        totalAmount = addCurrencyTotal(totalAmount, item.pay_currency, parseAmount(item.net_amount));
      }

      const { data: rawBatch, error: createBatchError } = await supabase
        .from("payment_batches")
        .insert({
          org_id: session.profile.org_id,
          payroll_run_id: parsedRun.data.id,
          total_amount: totalAmount,
          payment_count: itemsNeedingProcessing.length,
          status: "processing",
          created_by: session.profile.id
        })
        .select(
          "id, org_id, payroll_run_id, total_amount, payment_count, status, created_by, created_at, updated_at"
        )
        .single();

      if (createBatchError || !rawBatch) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "PAYMENT_BATCH_CREATE_FAILED",
            message: "Unable to create payment batch."
          },
          meta: buildMeta()
        });
      }

      const parsedBatch = paymentBatchRowSchema.safeParse(rawBatch);

      if (!parsedBatch.success) {
        return jsonResponse<null>(500, {
          data: null,
          error: {
            code: "PAYMENT_BATCH_CREATE_FAILED",
            message: "Payment batch data is invalid."
          },
          meta: buildMeta()
        });
      }

      batchId = parsedBatch.data.id;
    } else {
      const firstExisting = parsedExistingLedger.data[0];
      batchId = firstExisting?.batch_id ?? null;
    }

    if (!batchId) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYMENT_BATCH_CREATE_FAILED",
          message: "Unable to resolve payment batch context."
        },
        meta: buildMeta()
      });
    }

    if (itemsNeedingProcessing.length > 0) {
      const { error: setProcessingError } = await supabase
        .from("payroll_runs")
        .update({ status: "processing" })
        .eq("org_id", session.profile.org_id)
        .eq("id", parsedRun.data.id);

      if (setProcessingError) {
        throw new Error(`Unable to set payroll run to processing: ${setProcessingError.message}`);
      }
    }

    let createdCount = 0;
    let rejectedCount = 0;
    let retriedCount = 0;

    for (const item of parsedItems.data) {
      const amount = parseAmount(item.net_amount);
      const currency = normalizeCurrencyCode(item.pay_currency);
      const idempotencyKey = toIdempotencyKey({
        runId: parsedRun.data.id,
        employeeId: item.employee_id,
        payPeriod
      });
      const existingLedger = existingLedgerByKey.get(idempotencyKey) ?? null;
      const details = paymentDetailsByEmployeeId.get(item.employee_id) ?? null;

      let paymentMethod: PaymentMethod = details?.payment_method ?? "bank_transfer";
      if (existingLedger) {
        paymentMethod = existingLedger.payment_method;
      }

      let paymentLedgerId = existingLedger?.id ?? null;
      const providerRoute = resolvePaymentProvider(currency);
      const recipientId = resolveRecipientId({
        employeeId: item.employee_id,
        method: paymentMethod,
        paymentDetails: details
      });

      if (
        existingLedger &&
        decideIdempotencyAction(existingLedger.status) === "reject_duplicate"
      ) {
        rejectedCount += 1;

        await updatePayrollItemPaymentState({
          supabase,
          orgId: session.profile.org_id,
          payrollItemId: item.id,
          paymentId: existingLedger.id,
          status: mapLedgerStatusToPayrollStatus(existingLedger.status),
          paymentReference: existingLedger.provider_reference
        });

        continue;
      }

      if (existingLedger && existingLedger.status === "failed") {
        retriedCount += 1;
        paymentLedgerId = existingLedger.id;

        const { error: resetError } = await supabase
          .from("payment_ledger")
          .update({
            batch_id: batchId,
            amount,
            currency,
            payment_method: paymentMethod,
            provider: "mock",
            provider_reference: null,
            status: "processing",
            failure_reason: null,
            metadata: mergeMetadata(existingLedger.metadata, {
              retriedAt: new Date().toISOString(),
              futureProvider: providerRoute.futureProvider,
              providerRoutedTo: providerRoute.provider
            })
          })
          .eq("org_id", session.profile.org_id)
          .eq("id", existingLedger.id);

        if (resetError) {
          throw new Error(`Unable to reset failed payment for retry: ${resetError.message}`);
        }
      }

      if (!existingLedger) {
        createdCount += 1;

        const { data: insertedLedger, error: insertLedgerError } = await supabase
          .from("payment_ledger")
          .insert({
            org_id: session.profile.org_id,
            payroll_item_id: item.id,
            employee_id: item.employee_id,
            batch_id: batchId,
            amount,
            currency,
            payment_method: paymentMethod,
            provider: "mock",
            provider_reference: null,
            idempotency_key: idempotencyKey,
            status: "processing",
            failure_reason: null,
            metadata: {
              createdAt: new Date().toISOString(),
              futureProvider: providerRoute.futureProvider,
              providerRoutedTo: providerRoute.provider
            }
          })
          .select(
            "id, org_id, payroll_item_id, employee_id, batch_id, amount, currency, payment_method, provider, provider_reference, idempotency_key, status, failure_reason, metadata, created_at, updated_at"
          )
          .single();

        if (insertLedgerError || !insertedLedger) {
          throw new Error(`Unable to create payment ledger row: ${insertLedgerError?.message ?? "unknown error"}`);
        }

        const parsedInsertedLedger = paymentLedgerRowSchema.safeParse(insertedLedger);

        if (!parsedInsertedLedger.success) {
          throw new Error("Inserted payment ledger row is invalid.");
        }

        paymentLedgerId = parsedInsertedLedger.data.id;
        existingLedgerByKey.set(idempotencyKey, parsedInsertedLedger.data);
      }

      if (!paymentLedgerId) {
        throw new Error("Payment ledger id is missing for processing.");
      }

      await updatePayrollItemPaymentState({
        supabase,
        orgId: session.profile.org_id,
        payrollItemId: item.id,
        paymentId: paymentLedgerId,
        status: "processing",
        paymentReference: null
      });

      const holdActive = details ? isHoldActive(details.change_effective_at) : false;

      if (!details || holdActive || amount <= 0) {
        const failureReason = !details
          ? "Missing payment details."
          : holdActive
            ? "Payment details are in the 48-hour hold window."
            : "Payment amount must be greater than zero.";

        const { error: failLedgerError } = await supabase
          .from("payment_ledger")
          .update({
            status: "failed",
            failure_reason: failureReason,
            provider_reference: null,
            metadata: {
              futureProvider: providerRoute.futureProvider,
              providerRoutedTo: providerRoute.provider,
              failedAt: new Date().toISOString(),
              recipientId
            }
          })
          .eq("org_id", session.profile.org_id)
          .eq("id", paymentLedgerId);

        if (failLedgerError) {
          throw new Error(`Unable to mark payment as failed: ${failLedgerError.message}`);
        }

        await updatePayrollItemPaymentState({
          supabase,
          orgId: session.profile.org_id,
          payrollItemId: item.id,
          paymentId: paymentLedgerId,
          status: "failed",
          paymentReference: null
        });

        continue;
      }

      let providerResult: Awaited<ReturnType<typeof processMockPayment>>;

      try {
        providerResult = await processMockPayment({
          amount,
          currency,
          idempotencyKey,
          paymentMethod,
          recipientId
        });
      } catch (error) {
        providerResult = {
          status: "failed",
          providerReference: "",
          failureReason:
            error instanceof Error ? error.message : "Mock provider request failed.",
          processingDelayMs: 0
        };
      }

      const finalLedgerStatus = providerResult.status;
      const finalReference = providerResult.providerReference || null;
      const finalFailureReason =
        providerResult.status === "failed"
          ? providerResult.failureReason ?? "Mock provider failed."
          : null;

      const { error: finalizeLedgerError } = await supabase
        .from("payment_ledger")
        .update({
          status: finalLedgerStatus,
          provider_reference: finalReference,
          failure_reason: finalFailureReason,
          metadata: {
            futureProvider: providerRoute.futureProvider,
            providerRoutedTo: providerRoute.provider,
            delayMs: providerResult.processingDelayMs,
            recipientId,
            completedAt: new Date().toISOString()
          }
        })
        .eq("org_id", session.profile.org_id)
        .eq("id", paymentLedgerId);

      if (finalizeLedgerError) {
        throw new Error(`Unable to finalize payment ledger row: ${finalizeLedgerError.message}`);
      }

      await updatePayrollItemPaymentState({
        supabase,
        orgId: session.profile.org_id,
        payrollItemId: item.id,
        paymentId: paymentLedgerId,
        status: mapLedgerStatusToPayrollStatus(finalLedgerStatus),
        paymentReference: finalReference
      });
    }

    const { data: rawBatch, error: batchError } = await supabase
      .from("payment_batches")
      .select(
        "id, org_id, payroll_run_id, total_amount, payment_count, status, created_by, created_at, updated_at"
      )
      .eq("org_id", session.profile.org_id)
      .eq("id", batchId)
      .is("deleted_at", null)
      .single();

    if (batchError) {
      throw new Error(`Unable to reload payment batch: ${batchError.message}`);
    }

    const parsedBatch = paymentBatchRowSchema.safeParse(rawBatch);

    if (!parsedBatch.success) {
      throw new Error("Payment batch data is invalid.");
    }

    const batchStatus = await refreshBatchStatus({
      supabase,
      orgId: session.profile.org_id,
      batchId: parsedBatch.data.id
    });

    const runStatus = await refreshRunStatus({
      supabase,
      orgId: session.profile.org_id,
      payrollRunId: parsedRun.data.id
    });

    const { data: rawPaymentRows, error: paymentRowsError } = await supabase
      .from("payment_ledger")
      .select(
        "id, org_id, payroll_item_id, employee_id, batch_id, amount, currency, payment_method, provider, provider_reference, idempotency_key, status, failure_reason, metadata, created_at, updated_at"
      )
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .in("idempotency_key", idempotencyKeys)
      .order("created_at", { ascending: true });

    if (paymentRowsError) {
      throw new Error(`Unable to reload payment ledger rows: ${paymentRowsError.message}`);
    }

    const parsedPaymentRows = z.array(paymentLedgerRowSchema).safeParse(rawPaymentRows ?? []);

    if (!parsedPaymentRows.success) {
      throw new Error("Payment ledger rows are invalid.");
    }

    const payments: PaymentLedgerRecord[] = parsedPaymentRows.data.map((row) =>
      toPaymentLedgerRecord(row)
    );

    const completedCount = payments.filter((payment) => payment.status === "completed").length;
    const failedCount = payments.filter((payment) => payment.status === "failed").length;

    await logAudit({
      action: "created",
      tableName: "payment_batches",
      recordId: parsedBatch.data.id,
      newValue: {
        payrollRunId: parsedRun.data.id,
        batchStatus,
        runStatus,
        processedPayments: payments.length,
        completedCount,
        failedCount,
        createdCount,
        rejectedCount,
        retriedCount
      }
    });

    const responseData: CreatePaymentBatchResponseData = {
      batch: {
        ...toPaymentBatchRecord({
          ...parsedBatch.data,
          status: batchStatus
        }),
        status: batchStatus
      },
      payments,
      summary: {
        createdCount,
        rejectedCount,
        retriedCount,
        completedCount,
        failedCount
      }
    };

    return jsonResponse<CreatePaymentBatchResponseData>(200, {
      data: responseData,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYMENT_BATCH_CREATE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Unable to process payment batch."
      },
      meta: buildMeta()
    });
  }
}
