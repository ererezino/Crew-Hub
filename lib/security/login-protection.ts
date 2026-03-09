import "server-only";

import { logger } from "../logger";
import { createSupabaseServiceRoleClient } from "../supabase/service-role";

/**
 * Durable failed-login tracking using Supabase.
 *
 * Stores failed attempts in a `failed_login_attempts` table.
 * After MAX_ATTEMPTS within WINDOW_MINUTES, the account is locked
 * for LOCKOUT_MINUTES.
 *
 * This is durable across Vercel cold starts, unlike in-memory rate limiting.
 */

const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;
const LOCKOUT_MINUTES = 15;

type LoginProtectionMemoryState = {
  attemptedAtMs: number[];
  lockedUntilMs: number | null;
};

type LoginProtectionStore = Map<string, LoginProtectionMemoryState>;

declare global {
  var __crewHubLoginProtectionStore: LoginProtectionStore | undefined;
}

export type LoginProtectionResult = {
  allowed: boolean;
  remainingAttempts: number;
  lockedUntil: string | null;
  message: string | null;
};

function getStore(): LoginProtectionStore {
  if (!globalThis.__crewHubLoginProtectionStore) {
    globalThis.__crewHubLoginProtectionStore = new Map<string, LoginProtectionMemoryState>();
  }

  return globalThis.__crewHubLoginProtectionStore;
}

function pruneAttempts(attemptedAtMs: number[], nowMs: number): number[] {
  const windowStartMs = nowMs - WINDOW_MINUTES * 60 * 1000;
  return attemptedAtMs.filter((attemptMs) => attemptMs >= windowStartMs);
}

function checkMemoryFallback(normalizedEmail: string): LoginProtectionResult {
  const store = getStore();
  const nowMs = Date.now();
  const existing = store.get(normalizedEmail) ?? {
    attemptedAtMs: [],
    lockedUntilMs: null
  };

  const nextAttempts = pruneAttempts(existing.attemptedAtMs, nowMs);
  let lockedUntilMs = existing.lockedUntilMs;

  if (lockedUntilMs && lockedUntilMs <= nowMs) {
    lockedUntilMs = null;
  }

  if (!lockedUntilMs && nextAttempts.length >= MAX_ATTEMPTS) {
    lockedUntilMs = nowMs + LOCKOUT_MINUTES * 60 * 1000;
  }

  store.set(normalizedEmail, {
    attemptedAtMs: nextAttempts,
    lockedUntilMs
  });

  if (lockedUntilMs && lockedUntilMs > nowMs) {
    return {
      allowed: false,
      remainingAttempts: 0,
      lockedUntil: new Date(lockedUntilMs).toISOString(),
      message:
        "Account is temporarily locked due to too many failed login attempts. Please try again later."
    };
  }

  const remaining = Math.max(0, MAX_ATTEMPTS - nextAttempts.length);

  return {
    allowed: remaining > 0,
    remainingAttempts: remaining,
    lockedUntil: null,
    message:
      remaining <= 0
        ? "Account is temporarily locked due to too many failed login attempts. Please try again later."
        : null
  };
}

function recordMemoryFailure(normalizedEmail: string): void {
  const store = getStore();
  const nowMs = Date.now();
  const existing = store.get(normalizedEmail) ?? {
    attemptedAtMs: [],
    lockedUntilMs: null
  };
  const nextAttempts = [...pruneAttempts(existing.attemptedAtMs, nowMs), nowMs];

  let lockedUntilMs = existing.lockedUntilMs;
  if (!lockedUntilMs && nextAttempts.length >= MAX_ATTEMPTS) {
    lockedUntilMs = nowMs + LOCKOUT_MINUTES * 60 * 1000;
  }

  store.set(normalizedEmail, {
    attemptedAtMs: nextAttempts,
    lockedUntilMs
  });
}

function clearMemoryState(normalizedEmail: string): void {
  getStore().delete(normalizedEmail);
}

/**
 * Check if a login attempt is allowed for the given email.
 * Returns whether the attempt should proceed or be blocked.
 */
export async function checkLoginAllowed(
  email: string
): Promise<LoginProtectionResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const supabase = createSupabaseServiceRoleClient();

  const windowStart = new Date(
    Date.now() - WINDOW_MINUTES * 60 * 1000
  ).toISOString();

  // Check for active lockout
  const { data: lockoutRow, error: lockoutError } = await supabase
    .from("account_lockouts")
    .select("locked_until")
    .eq("email", normalizedEmail)
    .gt("locked_until", new Date().toISOString())
    .maybeSingle();

  if (lockoutError) {
    logger.warn("Lockout lookup failed. Falling back to in-memory lockout check.", {
      email: normalizedEmail,
      message: lockoutError.message
    });
    return checkMemoryFallback(normalizedEmail);
  }

  if (lockoutRow?.locked_until) {
    return {
      allowed: false,
      remainingAttempts: 0,
      lockedUntil: lockoutRow.locked_until,
      message: "Account is temporarily locked due to too many failed login attempts. Please try again later."
    };
  }

  // Count recent failed attempts
  const { count, error: countError } = await supabase
    .from("failed_login_attempts")
    .select("id", { count: "exact", head: true })
    .eq("email", normalizedEmail)
    .gte("attempted_at", windowStart);

  if (countError || typeof count !== "number") {
    logger.warn("Failed-login count lookup failed. Falling back to in-memory lockout check.", {
      email: normalizedEmail,
      message: countError?.message ?? "count was null"
    });
    return checkMemoryFallback(normalizedEmail);
  }

  const attemptCount = count;

  if (attemptCount >= MAX_ATTEMPTS) {
    const lockedUntil = new Date(
      Date.now() + LOCKOUT_MINUTES * 60 * 1000
    ).toISOString();

    const { error: lockoutUpsertError } = await supabase.from("account_lockouts").upsert(
      {
        email: normalizedEmail,
        locked_until: lockedUntil,
        reason: "excessive_failed_logins"
      },
      { onConflict: "email" }
    );

    if (lockoutUpsertError) {
      logger.warn("Failed to persist account lockout. Using in-memory lockout fallback.", {
        email: normalizedEmail,
        message: lockoutUpsertError.message
      });
      recordMemoryFailure(normalizedEmail);
      return checkMemoryFallback(normalizedEmail);
    }

    return {
      allowed: false,
      remainingAttempts: 0,
      lockedUntil,
      message:
        "Account is temporarily locked due to too many failed login attempts. Please try again later."
    };
  }

  const remaining = Math.max(0, MAX_ATTEMPTS - attemptCount);

  return {
    allowed: remaining > 0,
    remainingAttempts: remaining,
    lockedUntil: null,
    message: remaining <= 0
      ? "Account is temporarily locked due to too many failed login attempts. Please try again later."
      : null
  };
}

/**
 * Record a failed login attempt. If the threshold is exceeded,
 * create a lockout record.
 */
export async function recordFailedLogin(
  email: string,
  ipAddress: string
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const supabase = createSupabaseServiceRoleClient();
  recordMemoryFailure(normalizedEmail);

  // Record the failed attempt
  const { error: insertError } = await supabase.from("failed_login_attempts").insert({
    email: normalizedEmail,
    ip_address: ipAddress,
    attempted_at: new Date().toISOString()
  });

  if (insertError) {
    logger.warn("Failed to persist failed login attempt. In-memory fallback active.", {
      email: normalizedEmail,
      message: insertError.message
    });
    return;
  }

  // Check if we've exceeded the threshold
  const windowStart = new Date(
    Date.now() - WINDOW_MINUTES * 60 * 1000
  ).toISOString();

  const { count, error: countError } = await supabase
    .from("failed_login_attempts")
    .select("id", { count: "exact", head: true })
    .eq("email", normalizedEmail)
    .gte("attempted_at", windowStart);

  if (countError || typeof count !== "number") {
    logger.warn("Unable to count failed login attempts after insert. In-memory fallback active.", {
      email: normalizedEmail,
      message: countError?.message ?? "count was null"
    });
    return;
  }

  if (count >= MAX_ATTEMPTS) {
    const lockedUntil = new Date(
      Date.now() + LOCKOUT_MINUTES * 60 * 1000
    ).toISOString();

    const { error: lockoutError } = await supabase.from("account_lockouts").upsert(
      {
        email: normalizedEmail,
        locked_until: lockedUntil,
        reason: "excessive_failed_logins"
      },
      { onConflict: "email" }
    );

    if (lockoutError) {
      logger.warn("Failed to persist account lockout. In-memory lockout still active.", {
        email: normalizedEmail,
        message: lockoutError.message
      });
    }
  }
}

/**
 * Clear failed login attempts after a successful login.
 */
export async function clearFailedLogins(email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const supabase = createSupabaseServiceRoleClient();
  clearMemoryState(normalizedEmail);

  // Delete failed attempts
  const { error: clearAttemptsError } = await supabase
    .from("failed_login_attempts")
    .delete()
    .eq("email", normalizedEmail);

  if (clearAttemptsError) {
    logger.warn("Failed to clear failed login attempts.", {
      email: normalizedEmail,
      message: clearAttemptsError.message
    });
  }

  // Remove any active lockout
  const { error: clearLockoutError } = await supabase
    .from("account_lockouts")
    .delete()
    .eq("email", normalizedEmail);

  if (clearLockoutError) {
    logger.warn("Failed to clear account lockout.", {
      email: normalizedEmail,
      message: clearLockoutError.message
    });
  }
}
