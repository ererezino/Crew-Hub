"use server";

import { cookies } from "next/headers";

import { SUPPORTED_LOCALES, type AppLocale } from "@/i18n/locales";

const LOCALE_COOKIE = "crew-hub-locale";

/**
 * Server Action: sets the locale cookie.
 * Called by the LocaleToggle component and the shared updateLocale flow.
 */
export async function setLocaleCookie(locale: string): Promise<void> {
  if (!SUPPORTED_LOCALES.includes(locale as AppLocale)) {
    return;
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: "lax",
    httpOnly: false // Readable by client JS if needed
  });
}
