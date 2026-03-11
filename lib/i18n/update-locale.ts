import type { AppLocale } from "@/i18n/locales";
import { setLocaleCookie } from "@/app/actions/locale";

export type LocaleUpdateResult =
  | { ok: true }
  | { ok: false; cookieSet: boolean };

/**
 * Canonical locale-change mutation used by both the topbar dropdown
 * and the settings language selector.
 *
 * Mutation timing (sequential, not parallel):
 *   1. await setLocaleCookie(locale) — server action, sets HTTP cookie
 *   2. await fetch PATCH /api/v1/me/locale — persists to DB
 *   3. Return result to caller
 *
 * The caller MUST:
 *   - Ensure only one mutation is in flight at a time (disable UI controls)
 *   - Call router.refresh() exactly once after receiving the result:
 *     - On { ok: true }: refresh silently
 *     - On { ok: false, cookieSet: true }: refresh + show warning toast
 *     - On { ok: false, cookieSet: false }: do NOT refresh + show error toast
 */
export async function updateLocale(
  locale: AppLocale
): Promise<LocaleUpdateResult> {
  // Step 1: Cookie
  try {
    await setLocaleCookie(locale);
  } catch {
    return { ok: false, cookieSet: false };
  }

  // Step 2: DB persistence
  try {
    const res = await fetch("/api/v1/me/locale", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale })
    });
    if (!res.ok) return { ok: false, cookieSet: true };
  } catch {
    return { ok: false, cookieSet: true };
  }

  return { ok: true };
}
