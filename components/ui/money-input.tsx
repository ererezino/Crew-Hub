import { getCurrencySymbol } from "../../lib/format-currency";

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

function sanitizeMoneyInput(value: string): string {
  const normalized = value.replace(",", ".");
  const sanitized = normalized.replace(/[^\d.]/g, "");
  const [integerPart = "", decimalPart = ""] = sanitized.split(".");

  if (sanitized.includes(".")) {
    return `${integerPart}.${decimalPart.slice(0, 2)}`;
  }

  return integerPart;
}

export function MoneyInput({
  id,
  value,
  onChange,
  onBlur,
  currency = "USD",
  placeholder = "0.00",
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
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(sanitizeMoneyInput(event.currentTarget.value))}
        onBlur={onBlur}
        disabled={disabled}
      />
    </label>
  );
}
