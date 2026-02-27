import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { DOCUMENT_BUCKET_NAME } from "../../../../../../../lib/documents";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../../../types/auth";
import type { PaymentStatementSignedUrlResponseData } from "../../../../../../../types/payslips";

const paramsSchema = z.object({
  payslipId: z.string().uuid()
});

const querySchema = z.object({
  expiresIn: z.coerce.number().int().min(30).max(900).default(180),
  usage: z.enum(["view", "download"]).default("view")
});

function buildMeta() {
  return {
    timestamp: new Date().toISOString()
  };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

type RouteContext = {
  params: Promise<{ payslipId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to access payment statements."
      },
      meta: buildMeta()
    });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Payslip id must be a valid UUID."
      },
      meta: buildMeta()
    });
  }

  const requestUrl = new URL(request.url);
  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(requestUrl.searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message:
          parsedQuery.error.issues[0]?.message ?? "Invalid payment statement query parameters."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const payslipId = parsedParams.data.payslipId;

  const { data: payslipRow, error: payslipError } = await supabase
    .from("payslips")
    .select("id, pay_period, file_path")
    .eq("id", payslipId)
    .eq("org_id", session.profile.org_id)
    .eq("employee_id", session.profile.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (payslipError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PAYMENT_STATEMENT_FETCH_FAILED",
        message: "Unable to load payment statement metadata."
      },
      meta: buildMeta()
    });
  }

  if (!payslipRow?.file_path || !payslipRow.pay_period) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Payment statement not found."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;
  const downloadName = `payment-statement-${payslipRow.pay_period}.pdf`;
  const signedUrlOptions =
    query.usage === "download"
      ? {
          download: downloadName
        }
      : undefined;

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from(DOCUMENT_BUCKET_NAME)
    .createSignedUrl(payslipRow.file_path, query.expiresIn, signedUrlOptions);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SIGNED_URL_FAILED",
        message: "Unable to generate payment statement URL."
      },
      meta: buildMeta()
    });
  }

  if (query.usage === "view") {
    const viewedAt = new Date().toISOString();
    const { error: viewedAtError } = await supabase
      .from("payslips")
      .update({
        viewed_at: viewedAt
      })
      .eq("id", payslipId)
      .eq("org_id", session.profile.org_id)
      .eq("employee_id", session.profile.id);

    if (viewedAtError) {
      console.error("Unable to update payment statement viewed_at.", {
        payslipId,
        message: viewedAtError.message
      });
    }
  }

  const responseData: PaymentStatementSignedUrlResponseData = {
    url: signedUrlData.signedUrl,
    expiresInSeconds: query.expiresIn
  };

  return jsonResponse<PaymentStatementSignedUrlResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
