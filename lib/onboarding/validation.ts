import { z } from "zod";

/**
 * Zod schema for onboarding task action URLs.
 *
 * Accepts:
 * - Relative internal app paths starting with "/" (e.g. "/me/profile", "/documents?category=policy")
 * - Absolute http/https URLs (e.g. "https://slack.com/invite")
 * - null / undefined (handled by chaining .nullable().optional() at call sites)
 *
 * Rejects:
 * - Malformed strings that are neither a relative path nor a valid http/https URL
 * - javascript: URLs
 * - Protocol-relative URLs (//example.com)
 * - Other non-http schemes (ftp:, data:, etc.)
 */
export const actionUrlSchema = z
  .string()
  .trim()
  .max(500, "Action URL is too long.")
  .refine(
    (val) => {
      // Allow relative internal paths starting with a single slash
      if (val.startsWith("/") && !val.startsWith("//")) {
        return true;
      }

      // For everything else, require a valid http or https URL
      try {
        const parsed = new URL(val);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    },
    "Action URL must be a relative path (starting with /) or a valid http/https URL."
  );
