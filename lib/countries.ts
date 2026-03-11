import { DEFAULT_LOCALE, type AppLocale } from "@/i18n/locales";

const countryNameByCode: Record<string, string> = {
  NG: "Nigeria",
  GH: "Ghana",
  KE: "Kenya",
  ZA: "South Africa",
  CA: "Canada"
};

const countryDefaults: Record<string, { currency: string; timezone: string }> = {
  NG: { currency: "NGN", timezone: "Africa/Lagos" },
  GH: { currency: "GHS", timezone: "Africa/Accra" },
  KE: { currency: "KES", timezone: "Africa/Nairobi" },
  ZA: { currency: "ZAR", timezone: "Africa/Johannesburg" },
  CA: { currency: "CAD", timezone: "America/Toronto" }
};

export function getCountryDefaults(countryCode: string): { currency: string; timezone: string } | null {
  const normalized = countryCode.trim().toUpperCase();
  return countryDefaults[normalized] ?? null;
}

export function getCountryCodes(): string[] {
  return Object.keys(countryNameByCode);
}

function toCountryCode(value: string): string | null {
  const normalized = value.trim().toUpperCase();

  if (!/^[A-Z]{2}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

export function countryFlagFromCode(countryCode: string | null): string {
  if (!countryCode) {
    return "--";
  }

  const normalized = toCountryCode(countryCode);

  if (!normalized) {
    return "--";
  }

  return [...normalized]
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join("");
}

export function countryNameFromCode(
  countryCode: string | null,
  locale: AppLocale = DEFAULT_LOCALE
): string {
  if (!countryCode) {
    return locale === "fr" ? "Aucun pays" : "No country";
  }

  const normalized = toCountryCode(countryCode);

  if (!normalized) {
    return countryCode;
  }

  try {
    const displayNames = new Intl.DisplayNames([locale], { type: "region" });
    return displayNames.of(normalized) ?? countryNameByCode[normalized] ?? normalized;
  } catch {
    // Fallback to static English map if Intl unavailable
    return countryNameByCode[normalized] ?? normalized;
  }
}

export function getCountryOptions(
  locale: AppLocale = DEFAULT_LOCALE
): Array<{ code: string; name: string }> {
  const codes = getCountryCodes();
  const options = codes.map((code) => ({
    code,
    name: countryNameFromCode(code, locale)
  }));
  const collator = new Intl.Collator(locale);
  return options.sort((a, b) => collator.compare(a.name, b.name));
}
