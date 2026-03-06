const CURRENCY_CONFIG: Record<
  string,
  { symbol: string; locale: string; decimals: number }
> = {
  NGN: { symbol: "\u20A6", locale: "en-NG", decimals: 2 },
  USD: { symbol: "$", locale: "en-US", decimals: 2 },
  GHS: { symbol: "GH\u20B5", locale: "en-GH", decimals: 2 },
  KES: { symbol: "KSh", locale: "en-KE", decimals: 2 },
  ZAR: { symbol: "R", locale: "en-ZA", decimals: 2 },
  CAD: { symbol: "CA$", locale: "en-CA", decimals: 2 },
  GBP: { symbol: "\u00A3", locale: "en-GB", decimals: 2 },
  EUR: { symbol: "\u20AC", locale: "en-IE", decimals: 2 }
};

export function formatCurrency(
  amount: number | null | undefined,
  currencyCode: string = "USD"
): string {
  if (amount === null || amount === undefined) return "-";

  const config = CURRENCY_CONFIG[currencyCode.toUpperCase()];

  if (!config) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currencyCode,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(amount);
    } catch {
      return `${currencyCode} ${amount.toFixed(2)}`;
    }
  }

  const formatted = new Intl.NumberFormat(config.locale, {
    minimumFractionDigits: config.decimals,
    maximumFractionDigits: config.decimals
  }).format(amount);

  return `${config.symbol}${formatted}`;
}

export function getCurrencySymbol(currencyCode: string): string {
  return CURRENCY_CONFIG[currencyCode.toUpperCase()]?.symbol ?? currencyCode;
}
