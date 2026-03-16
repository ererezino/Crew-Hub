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

  /* API routes enforce auth/role checks in route handlers.
     Skip expensive middleware auth lookups to reduce API latency. */
  if (isApiRoute) {
    return secure(NextResponse.next({ request }));
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
  const isAuthContinueRoute = pathname === "/auth/continue";
  const isPublicLegalRoute = pathname === "/privacy" || pathname === "/terms";

  if (!user && !isApiRoute && !isLoginRoute && !isPublicLegalRoute && !isAuthContinueRoute) {
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

  /* Profile status, MFA enrollment, and AAL2 enforcement are handled by
     getAuthenticatedSession() in the session layer + shell layout redirects.
     Middleware only needs getUser() to gate login/logout redirects. */

  return secure(response);
}
