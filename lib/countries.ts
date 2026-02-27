const countryNameByCode: Record<string, string> = {
  NG: "Nigeria",
  GH: "Ghana",
  KE: "Kenya",
  ZA: "South Africa",
  CA: "Canada"
};

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

export function countryNameFromCode(countryCode: string | null): string {
  if (!countryCode) {
    return "No country";
  }

  const normalized = toCountryCode(countryCode);

  if (!normalized) {
    return countryCode;
  }

  return countryNameByCode[normalized] ?? normalized;
}
