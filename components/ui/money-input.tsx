import { getCurrencyDecimals, getCurrencySymbol } from "../../lib/format-currency";

type MoneyInputProps = {
  id: string;
  value: string;
  onChange: (nextValue: string) => void;
  onBlur?: () => void;
  currency?: string;
  placeholder?: string;
  disabled?: boolean;
  hasError?: boolean;
};

function sanitizeMoneyInput(value: string, currency: string): string {
  const decimals = getCurrencyDecimals(currency);
  const normalized = value.replace(",", ".");
  const sanitized = normalized.replace(/[^\d.]/g, "");
  const [integerPart = "", decimalPart = ""] = sanitized.split(".");

  if (sanitized.includes(".") && decimals > 0) {
    return `${integerPart}.${decimalPart.slice(0, decimals)}`;
  }

  return integerPart;
}

export function MoneyInput({
  id,
  value,
  onChange,
  onBlur,
  currency = "USD",
  placeholder,
  disabled = false,
  hasError = false
}: MoneyInputProps) {
  return (
    <label className={hasError ? "money-input money-input-error" : "money-input"} htmlFor={id}>
      <span className="money-input-prefix">{getCurrencySymbol(currency)}</span>
      <input
        id={id}
        className="money-input-field numeric"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder ?? (getCurrencyDecimals(currency) > 0 ? "0.00" : "0")}
        value={value}
        onChange={(event) => onChange(sanitizeMoneyInput(event.currentTarget.value, currency))}
        onBlur={onBlur}
        disabled={disabled}
      />
    </label>
  );
}
