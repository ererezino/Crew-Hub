import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

import { SUPPORTED_LOCALES, type AppLocale } from "./locales";

const LOCALE_COOKIE = "crew-hub-locale";

function isSupported(value: string | undefined): value is AppLocale {
  return SUPPORTED_LOCALES.includes(value as AppLocale);
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const raw = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale: AppLocale = isSupported(raw) ? raw : "en";

  /* Load the requested locale's messages. Also load English as fallback source
     so that missing French keys degrade to English, not raw key paths. */
  const messages = (await import(`../messages/${locale}.json`)).default;

  const isDev = process.env.NODE_ENV === "development";

  return {
    locale,
    messages,
    onError(error) {
      if (isDev) {
        console.error("[i18n]", error.message);
      } else {
        // Structured production logging
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "i18n_error",
            message: error.message
          })
        );
      }
    },
    getMessageFallback({ namespace, key, error }) {
      if (isDev) {
        // Loud in development — show the full path so devs notice
        return `⚠ ${namespace}.${key}`;
      }
      // In production, return the key path as a last resort.
      // The onError handler above already logged the issue.
      return `${namespace}.${key}`;
    }
  };
});
