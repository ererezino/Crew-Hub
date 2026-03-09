import "server-only";

import { logger } from "../logger";
import { createSupabaseServiceRoleClient } from "../supabase/service-role";

/**
 * Durable rate limiter backed by Supabase.
 *
 * This supplements the in-memory edge middleware rate limiter
 * with persistent, cross-instance rate limiting for critical paths.
 * Use this in route handlers (not edge middleware) where DB access is available.
 *
 * The `rate_limit_entries` table has an auto-cleanup trigger that removes
 * entries older than 5 minutes on insert.
 */

type DurableRateLimitConfig = {
  bucket: string;
  key: string;
  limit: number;
  windowSeconds: number;
};

type DurableRateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

type MemoryRateLimitWindow = {
  attempts: number[];
};

type MemoryRateLimitStore = Map<string, MemoryRateLimitWindow>;

declare global {
  var __crewHubDurableRateLimitFallback: MemoryRateLimitStore | undefined;
}

function getMemoryStore(): MemoryRateLimitStore {
  if (!globalThis.__crewHubDurableRateLimitFallback) {
    globalThis.__crewHubDurableRateLimitFallback = new Map<string, MemoryRateLimitWindow>();
  }

  return globalThis.__crewHubDurableRateLimitFallback;
}

function consumeMemoryRateLimit({
  bucket,
  key,
  limit,
  windowSeconds
}: DurableRateLimitConfig): DurableRateLimitResult {
  const nowMs = Date.now();
  const windowStartMs = nowMs - windowSeconds * 1000;
  const storeKey = `${bucket}:${key}`;
  const store = getMemoryStore();
  const current = store.get(storeKey) ?? { attempts: [] };
  const attemptsInWindow = current.attempts.filter((entryMs) => entryMs >= windowStartMs);

  if (attemptsInWindow.length >= limit) {
    const oldestAttemptMs = attemptsInWindow[0] ?? nowMs;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldestAttemptMs + windowSeconds * 1000 - nowMs) / 1000)
    );

    store.set(storeKey, { attempts: attemptsInWindow });
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds
    };
  }

  const nextAttempts = [...attemptsInWindow, nowMs];
  store.set(storeKey, { attempts: nextAttempts });

  return {
    allowed: true,
    remaining: Math.max(0, limit - nextAttempts.length),
    retryAfterSeconds: 0
  };
}

export async function checkDurableRateLimit({
  bucket,
  key,
  limit,
  windowSeconds
}: DurableRateLimitConfig): Promise<DurableRateLimitResult> {
  const supabase = createSupabaseServiceRoleClient();
  const windowStart = new Date(
    Date.now() - windowSeconds * 1000
  ).toISOString();

  // Count recent entries for this bucket/key
  const { count, error: countError } = await supabase
    .from("rate_limit_entries")
    .select("id", { count: "exact", head: true })
    .eq("bucket", bucket)
    .eq("key", key)
    .gte("attempted_at", windowStart);

  if (countError || typeof count !== "number") {
    logger.warn("Durable rate-limit count failed. Falling back to in-memory limiter.", {
      bucket,
      key,
      message: countError?.message ?? "count was null"
    });
    return consumeMemoryRateLimit({
      bucket,
      key,
      limit,
      windowSeconds
    });
  }

  const currentCount = count;
  const remaining = Math.max(0, limit - currentCount);

  if (currentCount >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: windowSeconds
    };
  }

  // Record this attempt
  const { error: insertError } = await supabase.from("rate_limit_entries").insert({
    bucket,
    key,
    attempted_at: new Date().toISOString()
  });

  if (insertError) {
    logger.warn("Durable rate-limit insert failed. Falling back to in-memory limiter.", {
      bucket,
      key,
      message: insertError.message
    });
    return consumeMemoryRateLimit({
      bucket,
      key,
      limit,
      windowSeconds
    });
  }

  return {
    allowed: true,
    remaining: Math.max(0, remaining - 1),
    retryAfterSeconds: 0
  };
}
