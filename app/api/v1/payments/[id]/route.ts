import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { GetPaymentResponseData } from "../../../../../types/payments";
import {
  buildMeta,
  canViewPayments,
  jsonResponse,
  paymentLedgerRowSchema,
  toPaymentLedgerRecord
} from "../_helpers";

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
        message: "You must be logged in to view payment records."
      },
      meta: buildMeta()
    });
  }

  if (!canViewPayments(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You are not allowed to view payment records."
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

    const { data: rawPayment, error: paymentError } = await supabase
      .from("payment_ledger")
      .select(
        "id, org_id, payroll_item_id, employee_id, batch_id, amount, currency, payment_method, provider, provider_reference, idempotency_key, status, failure_reason, metadata, created_at, updated_at"
      )
      .eq("org_id", session.profile.org_id)
      .eq("id", parsedParams.data.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (paymentError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYMENT_FETCH_FAILED",
          message: "Unable to load payment record."
        },
        meta: buildMeta()
      });
    }

    const parsedPayment = paymentLedgerRowSchema.safeParse(rawPayment);

    if (!parsedPayment.success) {
      return jsonResponse<null>(404, {
        data: null,
        error: {
          code: "NOT_FOUND",
          message: "Payment record not found."
        },
        meta: buildMeta()
      });
    }

    const responseData: GetPaymentResponseData = {
      payment: toPaymentLedgerRecord(parsedPayment.data)
    };

    return jsonResponse<GetPaymentResponseData>(200, {
      data: responseData,
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYMENT_FETCH_FAILED",
        message:
          error instanceof Error ? error.message : "Unable to load payment record."
      },
      meta: buildMeta()
    });
  }
}
