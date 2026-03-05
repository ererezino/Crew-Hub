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
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");
  const isMutationRequest = ["POST", "PUT", "PATCH", "DELETE"].includes(
    request.method.toUpperCase()
  );

  if (isApiRoute && isMutationRequest) {
    const csrfDecision = validateCsrfRequest(request);

    if (!csrfDecision.valid) {
      return applySecurityHeaders(
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

      return applySecurityHeaders(response);
    }
  }

  const env = getSupabasePublicEnv();

  if (!env) {
    return applySecurityHeaders(NextResponse.next({ request }));
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

  if (!user && !isLoginRoute && !isApiRoute) {
    const redirectUrl = new URL("/login", request.url);

    if (pathname !== "/") {
      redirectUrl.searchParams.set("redirectTo", `${pathname}${search}`);
    }

    return applySecurityHeaders(NextResponse.redirect(redirectUrl));
  }

  if (user && isLoginRoute) {
    return applySecurityHeaders(
      NextResponse.redirect(new URL("/dashboard", request.url))
    );
  }

  return applySecurityHeaders(response);
}
