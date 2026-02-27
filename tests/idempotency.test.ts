import { describe, expect, it } from "vitest";

import { decideIdempotencyAction } from "../lib/payments/idempotency";

describe("Payment idempotency policy", () => {
  it("rejects duplicate keys when an existing non-failed payment exists", () => {
    expect(decideIdempotencyAction("processing")).toBe("reject_duplicate");
    expect(decideIdempotencyAction("completed")).toBe("reject_duplicate");
    expect(decideIdempotencyAction("cancelled")).toBe("reject_duplicate");
  });

  it("allows retry when the existing key status is failed", () => {
    expect(decideIdempotencyAction("failed")).toBe("retry_failed");
  });

  it("creates a new payment when no prior idempotency key exists", () => {
    expect(decideIdempotencyAction(null)).toBe("create_new");
  });
});
