import "server-only";

import { createHmac } from "node:crypto";

function resolveSystemSecret(): string {
  const explicitSecret = process.env.AUTH_SYSTEM_SECRET?.trim();
  if (explicitSecret) {
    return explicitSecret;
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceRoleKey) {
    return `fallback:${serviceRoleKey}`;
  }

  throw new Error(
    "Missing authentication secret. Set AUTH_SYSTEM_SECRET (preferred) or SUPABASE_SERVICE_ROLE_KEY."
  );
}

/**
 * Derives a deterministic system-managed password for a given user ID.
 *
 * Preferred secret source: AUTH_SYSTEM_SECRET.
 * Emergency fallback: SUPABASE_SERVICE_ROLE_KEY (keeps auth working if AUTH_SYSTEM_SECRET is missing).
 */
export function deriveSystemPassword(userId: string): string {
  const secret = resolveSystemSecret();
  return createHmac("sha256", secret).update(userId).digest("base64url");
}
