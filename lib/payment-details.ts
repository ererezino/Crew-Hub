import type { PaymentMethod } from "../types/payment-details";

function toDigitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function extractLast4Digits(value: string): string {
  const digits = toDigitsOnly(value);

  if (digits.length === 0) {
    return "";
  }

  return digits.slice(-4);
}

export function normalizeCurrencyCode(value: string): string {
  return value.trim().toUpperCase();
}

export function maskFromLast4(last4: string | null): string {
  if (!last4) {
    return "****";
  }

  return `****${last4}`;
}

export function maskWiseRecipientId(recipientId: string | null): string {
  if (!recipientId) {
    return "****";
  }

  const trimmed = recipientId.trim();

  if (trimmed.length <= 4) {
    return "****";
  }

  return `****${trimmed.slice(-4)}`;
}

export function methodLabel(method: PaymentMethod): string {
  switch (method) {
    case "bank_transfer":
      return "Bank transfer";
    case "mobile_money":
      return "Mobile money";
    case "wise":
      return "Wise";
    default:
      return method;
  }
}

export function holdSecondsRemaining(
  changeEffectiveAt: string,
  now: Date = new Date()
): number {
  const effectiveTimestamp = Date.parse(changeEffectiveAt);

  if (Number.isNaN(effectiveTimestamp)) {
    return 0;
  }

  const seconds = Math.ceil((effectiveTimestamp - now.getTime()) / 1000);
  return Math.max(0, seconds);
}

export function holdActive(changeEffectiveAt: string): boolean {
  return holdSecondsRemaining(changeEffectiveAt) > 0;
}

export function formatHoldCountdown(totalSeconds: number): string {
  const safeSeconds = Math.max(0, totalSeconds);

  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}
