import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";

const supportedEmailOtpTypes = [
  "recovery",
  "invite",
  "magiclink",
  "signup",
  "email_change",
  "email"
] as const;

const callbackVerifySchema = z
  .object({
    code: z.string().trim().min(1).optional(),
    tokenHash: z.string().trim().min(1).optional(),
    otpType: z.enum(supportedEmailOtpTypes).optional(),
    next: z.string().optional()
  })
  .superRefine((value, ctx) => {
    const hasCode = Boolean(value.code);
    const hasOtpPayload = Boolean(value.tokenHash && value.otpType);

    if (!hasCode && !hasOtpPayload) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tokenHash"],
        message: "Invalid setup link."
      });
    }
  });

type CallbackVerifyResponseData = {
  redirectTo: string;
  verified: true;
};

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function normalizeNextPath(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/mfa-setup";
  }

  return next;
}

export async function POST(request: Request) {
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

  const parsed = callbackVerifySchema.safeParse(body);

  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid callback verification payload."
      },
      meta: buildMeta()
    });
  }

  const { code, tokenHash, otpType, next } = parsed.data;
  const redirectTo = normalizeNextPath(next);

  const supabase = await createSupabaseServerClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return jsonResponse<null>(401, {
        data: null,
        error: {
          code: "INVALID_OR_EXPIRED_LINK",
          message: "This setup link has expired or is invalid. Ask your admin for a new invite."
        },
        meta: buildMeta()
      });
    }

    return jsonResponse<CallbackVerifyResponseData>(200, {
      data: {
        redirectTo,
        verified: true
      },
      error: null,
      meta: buildMeta()
    });
  }

  const { error } = await supabase.auth.verifyOtp({
    type: otpType!,
    token_hash: tokenHash!
  });

  if (error) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "INVALID_OR_EXPIRED_LINK",
        message: "This setup link has expired or is invalid. Ask your admin for a new invite."
      },
      meta: buildMeta()
    });
  }

  return jsonResponse<CallbackVerifyResponseData>(200, {
    data: {
      redirectTo,
      verified: true
    },
    error: null,
    meta: buildMeta()
  });
}
