import { NextResponse } from "next/server";

const supportedEmailOtpTypes = ["recovery", "invite", "magiclink", "signup", "email_change", "email"] as const;
type SupportedEmailOtpType = (typeof supportedEmailOtpTypes)[number];

function normalizeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/mfa-setup";
  }
  return next;
}

function parseOtpType(value: string | null): SupportedEmailOtpType | null {
  if (!value) return null;
  return (supportedEmailOtpTypes as readonly string[]).includes(value)
    ? (value as SupportedEmailOtpType)
    : null;
}

function buildContinueUrl(
  requestUrl: URL,
  params: {
    code?: string | null;
    tokenHash?: string | null;
    otpType?: SupportedEmailOtpType | null;
    next: string;
  }
) {
  const continueUrl = new URL("/auth/continue", requestUrl.origin);
  continueUrl.searchParams.set("next", params.next);

  if (params.code) {
    continueUrl.searchParams.set("code", params.code);
  }

  if (params.tokenHash && params.otpType) {
    continueUrl.searchParams.set("token_hash", params.tokenHash);
    continueUrl.searchParams.set("type", params.otpType);
  }

  return continueUrl;
}

/**
 * Supabase Auth callback handler.
 *
 * Handles both PKCE (`code`) and OTP-hash (`token_hash` + `type`) callbacks.
 * This route intentionally does not verify callback tokens directly on GET.
 * It redirects to an interstitial page where a real user explicitly confirms
 * continuation. This prevents link-preview bots from consuming one-time tokens.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const otpType = parseOtpType(requestUrl.searchParams.get("type"));
  const next = normalizeNextPath(requestUrl.searchParams.get("next"));

  if (code) {
    return NextResponse.redirect(
      buildContinueUrl(requestUrl, { code, next })
    );
  }

  if (tokenHash && otpType) {
    return NextResponse.redirect(
      buildContinueUrl(requestUrl, {
        tokenHash,
        otpType,
        next
      })
    );
  }

  /* Invalid callback payload — send to login with an error hint */
  const loginUrl = new URL("/login", requestUrl.origin);
  loginUrl.searchParams.set("error", "invite_expired");
  return NextResponse.redirect(loginUrl);
}
