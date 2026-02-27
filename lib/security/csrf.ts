import type { NextRequest } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type CsrfValidationResult = {
  valid: boolean;
  reason: string | null;
};

function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

function isExemptPath(pathname: string): boolean {
  return pathname === "/api/v1/payments/webhook";
}

function sameOrigin(targetOrigin: string, candidate: string): boolean {
  try {
    const normalized = new URL(candidate).origin;
    return normalized === targetOrigin;
  } catch {
    return false;
  }
}

export function validateCsrfRequest(request: NextRequest): CsrfValidationResult {
  if (isSafeMethod(request.method) || isExemptPath(request.nextUrl.pathname)) {
    return { valid: true, reason: null };
  }

  const targetOrigin = request.nextUrl.origin;
  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");

  if (!originHeader && !refererHeader) {
    // Non-browser requests may omit both headers.
    return { valid: true, reason: null };
  }

  if (originHeader && !sameOrigin(targetOrigin, originHeader)) {
    return {
      valid: false,
      reason: "Cross-site mutation blocked by CSRF protection (origin mismatch)."
    };
  }

  if (refererHeader && !sameOrigin(targetOrigin, refererHeader)) {
    return {
      valid: false,
      reason: "Cross-site mutation blocked by CSRF protection (referer mismatch)."
    };
  }

  return { valid: true, reason: null };
}
