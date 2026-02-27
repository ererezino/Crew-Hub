import type { PaymentProvider } from "../../types/payments";

export type ProviderRouteTarget = "cashramp" | "wise";

export type ProviderRoute = {
  provider: PaymentProvider;
  futureProvider: ProviderRouteTarget;
};

export type MockPaymentRequest = {
  amount: number;
  currency: string;
  idempotencyKey: string;
  paymentMethod: string;
  recipientId: string;
};

export type MockPaymentResult = {
  status: "completed" | "failed";
  providerReference: string;
  failureReason: string | null;
  processingDelayMs: number;
};

const CASHRAMP_CURRENCIES = new Set(["NGN", "GHS", "KES", "ZAR"]);

const MOCK_FAILURE_REASONS = [
  "Temporary provider outage.",
  "Bank rejected the transfer request.",
  "Recipient account validation failed."
] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function randomFailureReason(): string {
  const index = Math.floor(Math.random() * MOCK_FAILURE_REASONS.length);
  return MOCK_FAILURE_REASONS[index] ?? "Payment request failed.";
}

function randomReference(prefix: string): string {
  const randomPart = Math.random().toString(16).slice(2, 10);
  return `${prefix}_${Date.now()}_${randomPart}`;
}

export function resolvePaymentProvider(currency: string): ProviderRoute {
  const normalizedCurrency = currency.trim().toUpperCase();

  if (CASHRAMP_CURRENCIES.has(normalizedCurrency)) {
    return {
      provider: "mock",
      futureProvider: "cashramp"
    };
  }

  return {
    provider: "mock",
    futureProvider: "wise"
  };
}

export async function processMockPayment(
  request: MockPaymentRequest
): Promise<MockPaymentResult> {
  const requestFingerprint = [
    request.currency.trim().toUpperCase(),
    request.idempotencyKey,
    request.recipientId,
    request.paymentMethod,
    String(request.amount)
  ].join(":");
  const processingDelayMs = 1000 + Math.floor(Math.random() * 1001);
  await sleep(processingDelayMs);

  const success = Math.random() < 0.9;

  if (success) {
    return {
      status: "completed",
      providerReference: `${randomReference("mockpay")}_${requestFingerprint.length}`,
      failureReason: null,
      processingDelayMs
    };
  }

  return {
    status: "failed",
    providerReference: `${randomReference("mockfail")}_${requestFingerprint.length}`,
    failureReason: randomFailureReason(),
    processingDelayMs
  };
}
