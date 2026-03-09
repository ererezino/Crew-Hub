import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { applySecurityHeaders } from "../security/csp";
import { validateCsrfRequest } from "../security/csrf";
import { evaluateRateLimit } from "../security/rate-limit";

function getSupabasePublicEnv() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return { supabaseUrl, supabaseAnonKey };
}

export async function applySupabaseAuthMiddleware(request: NextRequest) {
  // Generate a correlation ID for every request (used in logging and error tracking)
  const requestId =
    request.headers.get("x-request-id") ?? crypto.randomUUID();

  /** Apply security headers and attach request ID to every response */
  function secure(response: NextResponse): NextResponse {
    return applySecurityHeaders(response, { requestId });
  }

  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");
  const isMutationRequest = ["POST", "PUT", "PATCH", "DELETE"].includes(
    request.method.toUpperCase()
  );

  if (isApiRoute && isMutationRequest) {
    const csrfDecision = validateCsrfRequest(request);

    if (!csrfDecision.valid) {
      return secure(
        NextResponse.json(
          {
            data: null,
            error: {
              code: "CSRF_VALIDATION_FAILED",
              message:
                "Your request could not be processed. Please refresh the page and try again."
            },
            meta: {
              timestamp: new Date().toISOString()
            }
          },
          { status: 403 }
        )
      );
    }

    const rateLimitDecision = evaluateRateLimit(request);

    if (!rateLimitDecision.allowed) {
      const response = NextResponse.json(
        {
          data: null,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "You're making requests too quickly. Please wait a moment and try again."
          },
          meta: {
            timestamp: new Date().toISOString()
          }
        },
        { status: 429 }
      );

      if (rateLimitDecision.retryAfterSeconds !== null) {
        response.headers.set(
          "Retry-After",
          String(rateLimitDecision.retryAfterSeconds)
        );
      }

      if (rateLimitDecision.limit !== null) {
        response.headers.set("X-RateLimit-Limit", String(rateLimitDecision.limit));
      }

      if (rateLimitDecision.remaining !== null) {
        response.headers.set(
          "X-RateLimit-Remaining",
          String(rateLimitDecision.remaining)
        );
      }

      if (rateLimitDecision.bucket) {
        response.headers.set("X-RateLimit-Bucket", rateLimitDecision.bucket);
      }

      return secure(response);
    }
  }

  const env = getSupabasePublicEnv();

  if (!env) {
    return secure(NextResponse.next({ request }));
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      }
    }
  });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const isLoginRoute = pathname === "/login";
  const isMfaSetupRoute = pathname === "/mfa-setup";
  const isMfaApiRoute = pathname === "/api/v1/me/mfa";
  const isAuthSignInApiRoute = pathname === "/api/v1/auth/sign-in";
  const isAuthSignOutApiRoute = pathname === "/api/auth/sign-out";
  const isPublicLegalRoute = pathname === "/privacy" || pathname === "/terms";

  if (!user && !isLoginRoute && !isApiRoute && !isPublicLegalRoute) {
    const redirectUrl = new URL("/login", request.url);

    if (pathname !== "/") {
      redirectUrl.searchParams.set("redirectTo", `${pathname}${search}`);
    }

    return secure(NextResponse.redirect(redirectUrl));
  }

  if (user && isLoginRoute) {
    return secure(
      NextResponse.redirect(new URL("/dashboard", request.url))
    );
  }

  // MFA enforcement and account status checks for authenticated users.
  if (user && !isLoginRoute) {
    const { data: profileRow } = await supabase
      .from("profiles")
      .select("roles, status")
      .eq("id", user.id)
      .is("deleted_at", null)
      .maybeSingle();

    /* ── Inactive account check ── */
    if (profileRow?.status === "inactive") {
      await supabase.auth.signOut();

      if (isApiRoute) {
        return secure(
          NextResponse.json(
            {
              data: null,
              error: {
                code: "ACCOUNT_DISABLED",
                message: "Your account has been disabled. Contact your admin."
              },
              meta: { timestamp: new Date().toISOString() }
            },
            { status: 403 }
          )
        );
      }

      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "account_disabled");
      return secure(NextResponse.redirect(loginUrl));
    }

    /* ── MFA enforcement for ALL users ── */
    const { data: factorsData } =
      await supabase.auth.mfa.listFactors();

    const verifiedFactors = (factorsData?.totp ?? []).filter(
      (f) => f.status === "verified"
    );

    if (verifiedFactors.length === 0) {
      /* User has no verified TOTP — must complete MFA setup */
      const isMfaExemptApiRoute =
        isMfaApiRoute || isAuthSignInApiRoute || isAuthSignOutApiRoute;

      if (isApiRoute && !isMfaExemptApiRoute) {
        return secure(
          NextResponse.json(
            {
              data: null,
              error: {
                code: "MFA_REQUIRED",
                message:
                  "Authenticator setup is required. Complete setup to continue."
              },
              meta: {
                timestamp: new Date().toISOString()
              }
            },
            { status: 403 }
          )
        );
      }

      if (!isApiRoute && !isMfaSetupRoute) {
        return secure(
          NextResponse.redirect(new URL("/mfa-setup", request.url))
        );
      }
    }

    /* ── AAL2 enforcement (defense in depth) ── */
    if (verifiedFactors.length > 0) {
      const { data: aalData } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

      if (aalData?.currentLevel === "aal1") {
        /* Session is AAL1 but user has TOTP — force re-login */
        const isMfaExemptApiRoute =
          isMfaApiRoute || isAuthSignInApiRoute || isAuthSignOutApiRoute;

        if (isApiRoute && !isMfaExemptApiRoute) {
          return secure(
            NextResponse.json(
              {
                data: null,
                error: {
                  code: "MFA_VERIFICATION_REQUIRED",
                  message: "Please sign in again to verify your authenticator."
                },
                meta: { timestamp: new Date().toISOString() }
              },
              { status: 403 }
            )
          );
        }

        if (!isApiRoute && !isMfaSetupRoute) {
          await supabase.auth.signOut();
          return secure(
            NextResponse.redirect(new URL("/login", request.url))
          );
        }
      }
    }
  }

  return secure(response);
}
