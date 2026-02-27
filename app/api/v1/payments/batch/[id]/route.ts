import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type { GetPaymentBatchResponseData } from "../../../../../../types/payments";
import {
  buildMeta,
  canViewPayments,
  jsonResponse,
  paymentBatchRowSchema,
  paymentLedgerRowSchema,
  toPaymentBatchRecord,
  toPaymentLedgerRecord
} from "../../_helpers";

const paramsSchema = z.object({
  id: z.string().uuid()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  _request: Request,
  { params }: RouteContext
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view payment batches."
      },
      meta: buildMeta()
    });
  }

  if (!canViewPayments(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to view payment batches."
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
        message: "Batch id must be a valid UUID."
      },
      meta: buildMeta()
    });
  }

  try {
    const supabase = await createSupabaseServerClient();

    const [{ data: rawBatch, error: batchError }, { data: rawLedgerRows, error: ledgerError }] =
      await Promise.all([
        supabase
          .from("payment_batches")
          .select(
            "id, org_id, payroll_run_id, total_amount, payment_count, status, created_by, created_at, updated_at"
          )
          .eq("org_id", session.profile.org_id)
          .eq("id", parsedParams.data.id)
          .is("deleted_at", null)
          .maybeSingle(),
        supabase
          .from("payment_ledger")
          .select(
            "id, org_id, payroll_item_id, employee_id, batch_id, amount, currency, payment_method, provider, provider_reference, idempotency_key, status, failure_reason, metadata, created_at, updated_at"
          )
          .eq("org_id", session.profile.org_id)
          .eq("batch_id", parsedParams.data.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: true })
      ]);

    if (batchError || ledgerError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYMENT_BATCH_FETCH_FAILED",
          message: "Unable to load payment batch."
        },
        meta: buildMeta()
      });
    }

    const parsedBatch = paymentBatchRowSchema.safeParse(rawBatch);
    const parsedLedger = z.array(paymentLedgerRowSchema).safeParse(rawLedgerRows ?? []);

    if (!parsedBatch.success) {
      return jsonResponse<null>(404, {
        data: null,
        error: {
          code: "NOT_FOUND",
          message: "Payment batch not found."
        },
        meta: buildMeta()
      });
    }

    if (!parsedLedger.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYMENT_BATCH_FETCH_FAILED",
          message: "Payment ledger rows are invalid."
        },
        meta: buildMeta()
      });
    }

    const responseData: GetPaymentBatchResponseData = {
      batch: toPaymentBatchRecord(parsedBatch.data),
      payments: parsedLedger.data.map((row) => toPaymentLedgerRecord(row))
    };

    return jsonResponse<GetPaymentBatchResponseData>(200, {
      data: responseData,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYMENT_BATCH_FETCH_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Unable to load payment batch."
      },
      meta: buildMeta()
    });
  }
}
