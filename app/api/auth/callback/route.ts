import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "../../../../lib/supabase/server";

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

/**
 * Supabase Auth callback handler.
 *
 * Handles both PKCE (`code`) and OTP-hash (`token_hash` + `type`) callbacks.
 * Either path must set a session cookie server-side before redirecting to the
 * target route; otherwise middleware will bounce back to /login.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const otpType = parseOtpType(requestUrl.searchParams.get("type"));
  const next = normalizeNextPath(requestUrl.searchParams.get("next"));

  const supabase = await createSupabaseServerClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(next, requestUrl.origin));
    }
  }

  if (tokenHash && otpType) {
    const { error } = await supabase.auth.verifyOtp({
      type: otpType,
      token_hash: tokenHash
    });

    if (!error) {
      return NextResponse.redirect(new URL(next, requestUrl.origin));
    }
  }

  /* If code exchange fails, send to login with an error hint */
  const loginUrl = new URL("/login", requestUrl.origin);
  loginUrl.searchParams.set("error", "invite_expired");
  return NextResponse.redirect(loginUrl);
}
