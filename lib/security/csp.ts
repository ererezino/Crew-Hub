import type { NextResponse } from "next/server";

/**
 * CSP Configuration
 *
 * Constraints:
 * - Next.js requires 'unsafe-inline' for style-src (CSS-in-JS, Tailwind injection)
 * - 'unsafe-eval' is REMOVED for production security (no eval/Function())
 * - script-src uses 'self' + 'unsafe-inline' (Next.js inline scripts for hydration)
 *   Note: Next.js does not yet support strict nonce-based CSP without 'unsafe-inline'
 *   for scripts in all cases. This is the strictest practical configuration.
 * - connect-src allows Supabase and Sentry domains
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' https: wss:",
  "form-action 'self'",
  "upgrade-insecure-requests"
].join("; ");

export function applySecurityHeaders(
  response: NextResponse,
  options?: { requestId?: string }
): NextResponse {
  response.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload"
  );
  response.headers.set("X-DNS-Prefetch-Control", "off");
  response.headers.set("X-Permitted-Cross-Domain-Policies", "none");

  if (options?.requestId) {
    response.headers.set("X-Request-Id", options.requestId);
  }

  return response;
}

export function getContentSecurityPolicy(): string {
  return CONTENT_SECURITY_POLICY;
}
