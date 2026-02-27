type CurrencyDisplayProps = {
  amount: number;
  currency: string;
  className?: string;
  locale?: string;
};

const defaultFractionDigitsByCurrency: Record<string, number> = {
  JPY: 0,
  KRW: 0
};

function resolveFractionDigits(currency: string): number {
  const normalizedCurrency = currency.trim().toUpperCase();
  return defaultFractionDigitsByCurrency[normalizedCurrency] ?? 2;
}

function formatCurrencyValue({
  amount,
  currency,
  locale
}: {
  amount: number;
  currency: string;
  locale: string;
}): string {
  const normalizedCurrency = currency.trim().toUpperCase();
  const fractionDigits = resolveFractionDigits(normalizedCurrency);
  const majorAmount = amount / 10 ** fractionDigits;

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: normalizedCurrency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    }).format(majorAmount);
  } catch {
    const numericValue = majorAmount.toFixed(fractionDigits);
    return `${normalizedCurrency} ${numericValue}`;
  }
}

export function CurrencyDisplay({
  amount,
  currency,
  className,
  locale
}: CurrencyDisplayProps) {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const safeCurrency = currency.trim().toUpperCase() || "USD";
  const formattedValue = formatCurrencyValue({
    amount: safeAmount,
    currency: safeCurrency,
    locale: locale ?? "en-US"
  });

  return (
    <span className={["currency-display", "numeric", className].filter(Boolean).join(" ")}>
      {formattedValue}
    </span>
  );
}
