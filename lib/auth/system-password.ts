import "server-only";

import { createHmac } from "node:crypto";

function resolveSystemSecret(): string {
  const explicitSecret = process.env.AUTH_SYSTEM_SECRET?.trim();
  if (explicitSecret) {
    return explicitSecret;
  }

  throw new Error(
    "Missing authentication secret. Set AUTH_SYSTEM_SECRET."
  );
}

/**
 * Derives a deterministic system-managed password for a given user ID.
 */
export function deriveSystemPassword(userId: string): string {
  const secret = resolveSystemSecret();
  return createHmac("sha256", secret).update(userId).digest("base64url");
}
