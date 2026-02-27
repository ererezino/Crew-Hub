import type { NextRequest } from "next/server";

type RateLimitBucketName = "auth" | "payments" | "approvals";

type RateLimitRule = {
  bucket: RateLimitBucketName;
  limit: number;
  windowMs: number;
  matches: (request: NextRequest) => boolean;
};

type RateLimitState = {
  count: number;
  resetAt: number;
};

type RateLimitStore = Map<string, RateLimitState>;

declare global {
  var __crewHubRateLimitStore: RateLimitStore | undefined;
}

export type RateLimitDecision = {
  allowed: boolean;
  bucket: RateLimitBucketName | null;
  limit: number | null;
  remaining: number | null;
  retryAfterSeconds: number | null;
};

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isMutationMethod(request: NextRequest): boolean {
  return MUTATION_METHODS.has(request.method.toUpperCase());
}

function extractClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    const candidate = forwardedFor
      .split(",")
      .map((value) => value.trim())
      .find((value) => value.length > 0);

    if (candidate) {
      return candidate;
    }
  }

  const realIp = request.headers.get("x-real-ip");

  if (realIp && realIp.trim().length > 0) {
    return realIp.trim();
  }

  return "unknown";
}

function approvalPathMatch(pathname: string): boolean {
  if (pathname === "/api/v1/expenses/approvals") {
    return true;
  }

  if (pathname.startsWith("/api/v1/time-off/requests/")) {
    return true;
  }

  if (pathname.startsWith("/api/v1/expenses/") && pathname !== "/api/v1/expenses/reports") {
    return true;
  }

  return /^\/api\/v1\/payroll\/runs\/[^/]+\/actions$/.test(pathname);
}

const RATE_LIMIT_RULES: readonly RateLimitRule[] = [
  {
    bucket: "auth",
    limit: 10,
    windowMs: 60_000,
    matches: (request) => {
      if (!isMutationMethod(request)) {
        return false;
      }

      const { pathname } = request.nextUrl;
      return pathname === "/api/v1/audit/login" || pathname.startsWith("/api/v1/auth");
    }
  },
  {
    bucket: "payments",
    limit: 5,
    windowMs: 60_000,
    matches: (request) => {
      if (!isMutationMethod(request)) {
        return false;
      }

      const { pathname } = request.nextUrl;

      if (pathname === "/api/v1/payments/webhook") {
        return false;
      }

      return pathname.startsWith("/api/v1/payments");
    }
  },
  {
    bucket: "approvals",
    limit: 3,
    windowMs: 60_000,
    matches: (request) => {
      if (!isMutationMethod(request)) {
        return false;
      }

      return approvalPathMatch(request.nextUrl.pathname);
    }
  }
];

function getStore(): RateLimitStore {
  if (!globalThis.__crewHubRateLimitStore) {
    globalThis.__crewHubRateLimitStore = new Map<string, RateLimitState>();
  }

  return globalThis.__crewHubRateLimitStore;
}

function consumeRateLimit({
  key,
  limit,
  windowMs,
  now
}: {
  key: string;
  limit: number;
  windowMs: number;
  now: number;
}): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const store = getStore();
  const current = store.get(key);

  if (!current || current.resetAt <= now) {
    const resetAt = now + windowMs;
    store.set(key, {
      count: 1,
      resetAt
    });

    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000))
    };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
    };
  }

  const nextCount = current.count + 1;
  store.set(key, {
    count: nextCount,
    resetAt: current.resetAt
  });

  return {
    allowed: true,
    remaining: Math.max(0, limit - nextCount),
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
  };
}

export function evaluateRateLimit(request: NextRequest): RateLimitDecision {
  const rule = RATE_LIMIT_RULES.find((candidate) => candidate.matches(request));

  if (!rule) {
    return {
      allowed: true,
      bucket: null,
      limit: null,
      remaining: null,
      retryAfterSeconds: null
    };
  }

  const now = Date.now();
  const ip = extractClientIp(request);
  const key = `${rule.bucket}:${ip}`;
  const decision = consumeRateLimit({
    key,
    limit: rule.limit,
    windowMs: rule.windowMs,
    now
  });

  return {
    allowed: decision.allowed,
    bucket: rule.bucket,
    limit: rule.limit,
    remaining: decision.remaining,
    retryAfterSeconds: decision.retryAfterSeconds
  };
}
