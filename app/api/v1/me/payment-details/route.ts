import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { logAudit } from "../../../../../lib/audit";
import { encryptSensitiveValue } from "../../../../../lib/crypto";
import {
  holdSecondsRemaining,
  maskFromLast4,
  maskWiseRecipientId,
  normalizeCurrencyCode,
  extractLast4Digits
} from "../../../../../lib/payment-details";
import { notifyHrPaymentDetailsChanged } from "../../../../../lib/notifications/payment-details";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import {
  PAYMENT_METHODS,
  type MePaymentDetailsMutationData,
  type MePaymentDetailsResponseData,
  type PaymentDetailMasked,
  type PaymentDetailsUpdatePayload
} from "../../../../../types/payment-details";

const paymentDetailRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  payment_method: z.enum(PAYMENT_METHODS),
  currency: z.string().length(3),
  bank_account_last4: z.string().nullable(),
  mobile_money_last4: z.string().nullable(),
  wise_recipient_id: z.string().nullable(),
  is_primary: z.boolean(),
  is_verified: z.boolean(),
  change_effective_at: z.string(),
  created_at: z.string(),
  updated_at: z.string()
});

const paymentDetailsUpdateSchema = z.discriminatedUnion("paymentMethod", [
  z.object({
    paymentMethod: z.literal("bank_transfer"),
    currency: z.string().trim().regex(/^[A-Za-z]{3}$/),
    bankName: z.string().trim().min(1).max(200),
    bankAccountName: z.string().trim().min(1).max(200),
    bankAccountNumber: z.string().trim().regex(/^[0-9]{4,34}$/),
    bankRoutingNumber: z.string().trim().max(100).optional().nullable()
  }),
  z.object({
    paymentMethod: z.literal("mobile_money"),
    currency: z.string().trim().regex(/^[A-Za-z]{3}$/),
    mobileMoneyProvider: z.string().trim().min(1).max(120),
    mobileMoneyNumber: z.string().trim().regex(/^\+?[0-9]{6,20}$/)
  }),
  z.object({
    paymentMethod: z.literal("wise"),
    currency: z.string().trim().regex(/^[A-Za-z]{3}$/),
    wiseRecipientId: z.string().trim().min(4).max(200)
  })
]);

function buildMeta() {
  return {
    timestamp: new Date().toISOString()
  };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function toMaskedPaymentDetail(
  row: z.infer<typeof paymentDetailRowSchema>
): PaymentDetailMasked {
  const last4 =
    row.payment_method === "bank_transfer"
      ? row.bank_account_last4
      : row.payment_method === "mobile_money"
        ? row.mobile_money_last4
        : null;

  const wiseRecipientIdMasked =
    row.payment_method === "wise"
      ? maskWiseRecipientId(row.wise_recipient_id)
      : null;

  const maskedDestination =
    row.payment_method === "wise"
      ? wiseRecipientIdMasked ?? "****"
      : maskFromLast4(last4);

  return {
    id: row.id,
    employeeId: row.employee_id,
    paymentMethod: row.payment_method,
    currency: row.currency,
    maskedDestination,
    last4,
    wiseRecipientIdMasked,
    isPrimary: row.is_primary,
    isVerified: row.is_verified,
    changeEffectiveAt: row.change_effective_at,
    holdSecondsRemaining: holdSecondsRemaining(row.change_effective_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function auditPayloadFromMasked(detail: PaymentDetailMasked) {
  return {
    paymentMethod: detail.paymentMethod,
    currency: detail.currency,
    maskedDestination: detail.maskedDestination,
    last4: detail.last4,
    wiseRecipientIdMasked: detail.wiseRecipientIdMasked,
    isPrimary: detail.isPrimary,
    isVerified: detail.isVerified,
    changeEffectiveAt: detail.changeEffectiveAt
  };
}

function holdResponseFromDetail(detail: PaymentDetailMasked | null) {
  const holdSeconds = detail?.holdSecondsRemaining ?? 0;

  return {
    holdActive: holdSeconds > 0,
    holdEndsAt: detail?.changeEffectiveAt ?? null,
    holdSecondsRemaining: holdSeconds
  };
}

async function fetchPrimaryPaymentDetail({
  supabase,
  orgId,
  employeeId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
  employeeId: string;
}) {
  const { data: row, error } = await supabase
    .from("employee_payment_details")
    .select(
      "id, employee_id, payment_method, currency, bank_account_last4, mobile_money_last4, wise_recipient_id, is_primary, is_verified, change_effective_at, created_at, updated_at"
    )
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .eq("is_primary", true)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const parsed = paymentDetailRowSchema.safeParse(row);

  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view payment details."
      },
      meta: buildMeta()
    });
  }

  try {
    const supabase = await createSupabaseServerClient();

    const row = await fetchPrimaryPaymentDetail({
      supabase,
      orgId: session.profile.org_id,
      employeeId: session.profile.id
    });

    const maskedDetail = row ? toMaskedPaymentDetail(row) : null;
    const holdState = holdResponseFromDetail(maskedDetail);

    return jsonResponse<MePaymentDetailsResponseData>(200, {
      data: {
        paymentDetail: maskedDetail,
        ...holdState
      },
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYMENT_DETAILS_FETCH_FAILED",
        message: error instanceof Error ? error.message : "Unable to load payment details."
      },
      meta: buildMeta()
    });
  }
}

export async function PUT(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to update payment details."
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

  const parsedBody = paymentDetailsUpdateSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid payment details payload."
      },
      meta: buildMeta()
    });
  }

  const payload = parsedBody.data as PaymentDetailsUpdatePayload;

  try {
    const supabase = await createSupabaseServerClient();

    const existingRow = await fetchPrimaryPaymentDetail({
      supabase,
      orgId: session.profile.org_id,
      employeeId: session.profile.id
    });

    const holdEffectiveAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    const writePayload: Record<string, string | boolean | null> = {
      payment_method: payload.paymentMethod,
      currency: normalizeCurrencyCode(payload.currency),
      bank_name_encrypted: null,
      bank_account_name_encrypted: null,
      bank_account_number_encrypted: null,
      bank_routing_number_encrypted: null,
      mobile_money_provider_encrypted: null,
      mobile_money_number_encrypted: null,
      wise_recipient_id: null,
      bank_account_last4: null,
      mobile_money_last4: null,
      is_primary: true,
      is_verified: false,
      change_effective_at: holdEffectiveAt,
      deleted_at: null
    };

    if (payload.paymentMethod === "bank_transfer") {
      writePayload.bank_name_encrypted = encryptSensitiveValue(payload.bankName.trim());
      writePayload.bank_account_name_encrypted = encryptSensitiveValue(
        payload.bankAccountName.trim()
      );
      writePayload.bank_account_number_encrypted = encryptSensitiveValue(
        payload.bankAccountNumber.trim()
      );
      writePayload.bank_routing_number_encrypted = payload.bankRoutingNumber?.trim()
        ? encryptSensitiveValue(payload.bankRoutingNumber.trim())
        : null;
      writePayload.bank_account_last4 = extractLast4Digits(payload.bankAccountNumber.trim());
    }

    if (payload.paymentMethod === "mobile_money") {
      writePayload.mobile_money_provider_encrypted = encryptSensitiveValue(
        payload.mobileMoneyProvider.trim()
      );
      writePayload.mobile_money_number_encrypted = encryptSensitiveValue(
        payload.mobileMoneyNumber.trim()
      );
      writePayload.mobile_money_last4 = extractLast4Digits(payload.mobileMoneyNumber.trim());
    }

    if (payload.paymentMethod === "wise") {
      writePayload.wise_recipient_id = payload.wiseRecipientId.trim();
    }

    const query = existingRow
      ? supabase
          .from("employee_payment_details")
          .update(writePayload)
          .eq("id", existingRow.id)
          .eq("org_id", session.profile.org_id)
          .eq("employee_id", session.profile.id)
      : supabase.from("employee_payment_details").insert({
          employee_id: session.profile.id,
          org_id: session.profile.org_id,
          ...writePayload
        });

    const { data: mutatedRow, error: mutationError } = await query
      .select(
        "id, employee_id, payment_method, currency, bank_account_last4, mobile_money_last4, wise_recipient_id, is_primary, is_verified, change_effective_at, created_at, updated_at"
      )
      .single();

    if (mutationError || !mutatedRow) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYMENT_DETAILS_UPDATE_FAILED",
          message: "Unable to update payment details."
        },
        meta: buildMeta()
      });
    }

    const parsedRow = paymentDetailRowSchema.safeParse(mutatedRow);

    if (!parsedRow.success) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "PAYMENT_DETAILS_PARSE_FAILED",
          message: "Updated payment details are not in the expected shape."
        },
        meta: buildMeta()
      });
    }

    const maskedDetail = toMaskedPaymentDetail(parsedRow.data);

    await logAudit({
      action: existingRow ? "updated" : "created",
      tableName: "employee_payment_details",
      recordId: maskedDetail.id,
      oldValue: existingRow ? auditPayloadFromMasked(toMaskedPaymentDetail(existingRow)) : null,
      newValue: auditPayloadFromMasked(maskedDetail)
    });

    await notifyHrPaymentDetailsChanged({
      orgId: session.profile.org_id,
      employeeName: session.profile.full_name,
      employeeEmail: session.profile.email,
      paymentMethod: maskedDetail.paymentMethod,
      changeEffectiveAt: maskedDetail.changeEffectiveAt
    });

    return jsonResponse<MePaymentDetailsMutationData>(200, {
      data: {
        paymentDetail: maskedDetail,
        holdActive: maskedDetail.holdSecondsRemaining > 0,
        holdEndsAt: maskedDetail.changeEffectiveAt,
        holdSecondsRemaining: maskedDetail.holdSecondsRemaining
      },
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYMENT_DETAILS_UPDATE_FAILED",
        message: error instanceof Error ? error.message : "Unable to update payment details."
      },
      meta: buildMeta()
    });
  }
}
