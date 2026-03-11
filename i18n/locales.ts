export const SUPPORTED_LOCALES = ["en", "fr"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "en";

/** Human-readable metadata per locale. No flags — languages are not countries. */
export const LOCALE_META: Record<
  AppLocale,
  { nativeName: string; englishName: string; shortLabel: string }
> = {
  en: { nativeName: "English", englishName: "English", shortLabel: "EN" },
  fr: { nativeName: "Français", englishName: "French", shortLabel: "FR" }
};
