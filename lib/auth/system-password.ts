import "server-only";

import { createHmac } from "node:crypto";

/**
 * Derives a deterministic system-managed password for a given user ID.
 *
 * Supabase MFA requires a primary auth factor (password) before TOTP
 * can be verified. This function produces an invisible, per-user password
 * that is never exposed to users — they authenticate with email + TOTP only.
 *
 * The password is derived using HMAC-SHA256(AUTH_SYSTEM_SECRET, userId) and
 * encoded as base64url (43 characters, URL-safe, high entropy).
 *
 * If AUTH_SYSTEM_SECRET is rotated, all user passwords must be re-derived
 * and updated via a migration script.
 */
export function deriveSystemPassword(userId: string): string {
  const secret = process.env.AUTH_SYSTEM_SECRET;

  if (!secret) {
    throw new Error(
      "AUTH_SYSTEM_SECRET environment variable is not set. " +
        "This secret is required for the authentication system."
    );
  }

  return createHmac("sha256", secret).update(userId).digest("base64url");
}
