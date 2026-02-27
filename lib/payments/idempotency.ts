import type { PaymentLedgerStatus } from "../../types/payments";

export type IdempotencyDecision = "create_new" | "retry_failed" | "reject_duplicate";

export function decideIdempotencyAction(
  existingStatus: PaymentLedgerStatus | null | undefined
): IdempotencyDecision {
  if (!existingStatus) {
    return "create_new";
  }

  if (existingStatus === "failed") {
    return "retry_failed";
  }

  return "reject_duplicate";
}
