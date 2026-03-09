import { NextResponse } from "next/server";
import { z } from "zod";

import { deriveSystemPassword } from "../../../../../lib/auth/system-password";
import { logger } from "../../../../../lib/logger";
import {
  clearFailedLogins,
  recordFailedLogin
} from "../../../../../lib/security/login-protection";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../types/auth";

const signInSchema = z.object({
  email: z.string().trim().email("Valid email is required."),
  totpCode: z.string().length(6, "A 6-digit authenticator code is required.").optional()
});

type SignInResponseData = {
  signedIn?: boolean;
  emailAccepted?: boolean;
};

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function extractIpAddress(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Request body must be valid JSON." },
      meta: buildMeta()
    });
  }

  const parsed = signInSchema.safeParse(body);

  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid sign-in payload."
      },
      meta: buildMeta()
    });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const totpCode = parsed.data.totpCode;

  /* ── Email-only check (step 1 of two-step login) ── */
  /* Runs BEFORE rate limiting — single fast DB query, no auth attempt */

  if (!totpCode) {
    try {
      const serviceClient = createSupabaseServiceRoleClient();
      const { data: row } = await serviceClient
        .from("profiles")
        .select("id, status")
        .eq("email", email)
        .is("deleted_at", null)
        .maybeSingle();

      if (row && row.status !== "inactive") {
        return jsonResponse<SignInResponseData>(200, {
          data: { emailAccepted: true },
          error: null,
          meta: buildMeta()
        });
      }

      return jsonResponse<null>(401, {
        data: null,
        error: { code: "INVALID_CREDENTIALS", message: "Invalid login credentials." },
        meta: buildMeta()
      });
    } catch {
      return jsonResponse<null>(401, {
        data: null,
        error: { code: "INVALID_CREDENTIALS", message: "Invalid login credentials." },
        meta: buildMeta()
      });
    }
  }

  /* ── Full sign-in with TOTP code (step 2) ── */

  const ipAddress = extractIpAddress(request);

  try {
    const serviceClient = createSupabaseServiceRoleClient();
    const now = new Date();
    const nowIso = now.toISOString();
    const rateWindow60 = new Date(now.getTime() - 60_000).toISOString();
    const rateWindow300 = new Date(now.getTime() - 300_000).toISOString();
    const loginWindow = new Date(now.getTime() - 15 * 60_000).toISOString();

    /* ── ONE parallel batch: rate limits + lockout + failed count + profile + cookie client ── */

    const [
      ipRateResult,
      emailRateResult,
      lockoutResult,
      failedCountResult,
      profileResult,
      supabase
    ] = await Promise.all([
      serviceClient
        .from("rate_limit_entries")
        .select("id", { count: "exact", head: true })
        .eq("bucket", "auth_signin_ip")
        .eq("key", ipAddress)
        .gte("attempted_at", rateWindow60),
      serviceClient
        .from("rate_limit_entries")
        .select("id", { count: "exact", head: true })
        .eq("bucket", "auth_signin_email")
        .eq("key", email)
        .gte("attempted_at", rateWindow300),
      serviceClient
        .from("account_lockouts")
        .select("locked_until")
        .eq("email", email)
        .gt("locked_until", nowIso)
        .maybeSingle(),
      serviceClient
        .from("failed_login_attempts")
        .select("id", { count: "exact", head: true })
        .eq("email", email)
        .gte("attempted_at", loginWindow),
      serviceClient
        .from("profiles")
        .select("id, status")
        .eq("email", email)
        .is("deleted_at", null)
        .maybeSingle(),
      createSupabaseServerClient()
    ]);

    /* Evaluate rate limits */

    const ipCount = typeof ipRateResult.count === "number" ? ipRateResult.count : 0;
    const emailCount = typeof emailRateResult.count === "number" ? emailRateResult.count : 0;

    if (ipCount >= 20 || emailCount >= 40) {
      return jsonResponse<null>(429, {
        data: null,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many sign-in attempts. Please wait and try again."
        },
        meta: buildMeta()
      });
    }

    /* Record rate limit entries (fire-and-forget — don't block the response) */
    serviceClient
      .from("rate_limit_entries")
      .insert([
        { bucket: "auth_signin_ip", key: ipAddress, attempted_at: nowIso },
        { bucket: "auth_signin_email", key: email, attempted_at: nowIso }
      ])
      .then(() => {}, () => {});

    /* Check lockout */

    if (lockoutResult.data?.locked_until) {
      return jsonResponse<null>(429, {
        data: null,
        error: {
          code: "ACCOUNT_LOCKED",
          message:
            "Account is temporarily locked due to too many failed login attempts."
        },
        meta: buildMeta()
      });
    }

    /* Check failed login threshold */

    const failedCount = typeof failedCountResult.count === "number" ? failedCountResult.count : 0;

    if (failedCount >= 5) {
      const lockedUntil = new Date(now.getTime() + 15 * 60_000).toISOString();
      serviceClient
        .from("account_lockouts")
        .upsert(
          { email, locked_until: lockedUntil, reason: "excessive_failed_logins" },
          { onConflict: "email" }
        )
        .then(() => {}, () => {});

      return jsonResponse<null>(429, {
        data: null,
        error: {
          code: "ACCOUNT_LOCKED",
          message:
            "Account is temporarily locked due to too many failed login attempts."
        },
        meta: buildMeta()
      });
    }

    /* Check profile */

    if (profileResult.error || !profileResult.data) {
      recordFailedLogin(email, ipAddress).catch(() => undefined);

      return jsonResponse<null>(401, {
        data: null,
        error: { code: "INVALID_CREDENTIALS", message: "Invalid login credentials." },
        meta: buildMeta()
      });
    }

    const profileRow = profileResult.data;

    if (profileRow.status === "inactive") {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "ACCOUNT_DISABLED",
          message: "Your account has been disabled. Contact your admin."
        },
        meta: buildMeta()
      });
    }

    /* ── Sign in with system-derived password (AAL1) ── */

    const userId = profileRow.id as string;
    const systemPassword = deriveSystemPassword(userId);

    const { data: signInData, error: signInError } =
      await supabase.auth.signInWithPassword({ email, password: systemPassword });

    if (signInError || !signInData?.user) {
      recordFailedLogin(email, ipAddress).catch(() => undefined);

      logger.error("System password sign-in failed.", {
        email,
        ipAddress,
        message: signInError?.message ?? "No user data returned."
      });

      return jsonResponse<null>(401, {
        data: null,
        error: { code: "INVALID_CREDENTIALS", message: "Invalid login credentials." },
        meta: buildMeta()
      });
    }

    /* ── Get TOTP factor (from sign-in response to skip listFactors call) ── */

    let factorId: string | undefined;

    const factors = signInData.user.factors ?? [];
    const verifiedFromSignIn = factors.filter(
      (f) => f.factor_type === "totp" && f.status === "verified"
    );

    if (verifiedFromSignIn.length > 0) {
      factorId = verifiedFromSignIn[0].id;
    } else {
      /* Fallback: listFactors if not in sign-in response */
      const { data: factorsData } = await supabase.auth.mfa.listFactors();
      const verifiedFactors = (factorsData?.totp ?? []).filter(
        (f) => f.status === "verified"
      );

      if (verifiedFactors.length > 0) {
        factorId = verifiedFactors[0].id;
      }
    }

    if (!factorId) {
      supabase.auth.signOut().catch(() => undefined);

      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "MFA_NOT_ENROLLED",
          message:
            "Your authenticator has not been set up yet. Contact your admin to receive a setup link."
        },
        meta: buildMeta()
      });
    }

    /* ── MFA challenge + verify ── */

    const { data: challengeData, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId });

    if (challengeError || !challengeData) {
      supabase.auth.signOut().catch(() => undefined);

      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "MFA_CHALLENGE_FAILED",
          message: "Unable to verify authenticator. Please try again."
        },
        meta: buildMeta()
      });
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challengeData.id,
      code: totpCode
    });

    if (verifyError) {
      supabase.auth.signOut().catch(() => undefined);
      recordFailedLogin(email, ipAddress).catch(() => undefined);

      return jsonResponse<null>(401, {
        data: null,
        error: {
          code: "INVALID_TOTP",
          message: "Invalid authenticator code. Please try again."
        },
        meta: buildMeta()
      });
    }

    /* ── Success — session is now AAL2 ── */

    clearFailedLogins(email).catch(() => undefined);

    return jsonResponse<SignInResponseData>(200, {
      data: { signedIn: true },
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    logger.error("Unexpected sign-in failure.", {
      email,
      ipAddress,
      message: error instanceof Error ? error.message : String(error)
    });

    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SIGN_IN_FAILED",
        message: "Unable to sign in. Please try again."
      },
      meta: buildMeta()
    });
  }
}
