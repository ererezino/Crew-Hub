type ChartTooltipProps = {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number | string;
    color: string;
  }>;
  label?: string;
  format?: "number" | "currency";
  currency?: string;
};

const zeroFractionCurrencies = new Set(["JPY", "KRW"]);

function toNumber(value: number | string): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatTooltipValue(
  rawValue: number | string,
  format: "number" | "currency",
  currency?: string
): string {
  const value = toNumber(rawValue);

  if (format === "currency" && currency) {
    const normalizedCurrency = currency.trim().toUpperCase();
    const fractionDigits = zeroFractionCurrencies.has(normalizedCurrency) ? 0 : 2;
    const majorAmount = value / 10 ** fractionDigits;

    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    }).format(majorAmount);
  }

  return Math.trunc(value).toLocaleString();
}

export function ChartTooltip({
  active,
  payload,
  label,
  format = "number",
  currency
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="chart-tooltip-frosted">
      <p className="chart-tooltip-label">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="chart-tooltip-entry">
          <span
            className="chart-tooltip-dot"
            style={{ background: entry.color }}
          />
          <span className="chart-tooltip-name">{entry.name}</span>
          <span className="chart-tooltip-value numeric">
            {formatTooltipValue(entry.value, format, currency)}
          </span>
        </p>
      ))}
    </div>
  );
}
