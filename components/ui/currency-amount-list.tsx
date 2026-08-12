import type { CurrencyAmounts } from "../../types/expenses";
import { CurrencyDisplay } from "./currency-display";

/**
 * Render per-currency totals as one line per currency, largest first.
 * Amounts in different currencies must never be summed into a single number
 * under one symbol — a NGN 150,000 + USD 40 month is two facts, not one.
 * An empty record renders a zero in the fallback currency so metric cards
 * keep their shape.
 */
export function CurrencyAmountList({
  amounts,
  fallbackCurrency = "USD",
  locale
}: {
  amounts: CurrencyAmounts;
  fallbackCurrency?: string;
  locale?: string;
}) {
  const entries = Object.entries(amounts)
    .filter(([, amount]) => Number.isFinite(amount))
    .sort((left, right) => right[1] - left[1]);

  if (entries.length === 0) {
    return (
      <span className="currency-amount-line">
        <CurrencyDisplay amount={0} currency={fallbackCurrency} locale={locale} />
      </span>
    );
  }

  return (
    <>
      {entries.map(([currency, amount]) => (
        <span key={currency} className="currency-amount-line">
          <CurrencyDisplay amount={amount} currency={currency} locale={locale} />
        </span>
      ))}
    </>
  );
}
