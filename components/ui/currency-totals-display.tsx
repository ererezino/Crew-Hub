import type { PayrollCurrencyTotals } from "../../types/payroll-runs";
import { CurrencyDisplay } from "./currency-display";

type CurrencyTotalsDisplayProps = {
  totals: PayrollCurrencyTotals | null | undefined;
  className?: string;
  locale?: string;
  layout?: "stacked" | "inline";
  emptyLabel?: string;
};

export function CurrencyTotalsDisplay({
  totals,
  className,
  locale,
  layout = "stacked",
  emptyLabel = "--"
}: CurrencyTotalsDisplayProps) {
  const entries = Object.entries(totals ?? {})
    .filter(([, amount]) => Number.isFinite(amount) && amount !== 0)
    .sort((left, right) => right[1] - left[1]);

  if (entries.length === 0) {
    return <span className={className}>{emptyLabel}</span>;
  }

  return (
    <span
      className={[
        "currency-totals-display",
        `currency-totals-display-${layout}`,
        className
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {entries.map(([currency, amount]) => (
        <span key={currency} className="currency-totals-item">
          <CurrencyDisplay amount={amount} currency={currency} locale={locale} />
        </span>
      ))}
    </span>
  );
}
