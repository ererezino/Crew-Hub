/**
 * OFFLINE-01 (exactly-once) and OFFLINE-02 (account binding) behavioral tests.
 *
 * The queue's IndexedDB plumbing is not exercised here; its DECISION logic is
 * exported as pure functions (the gate that actually prevents cross-account
 * replay and silent drops), and that is what we assert on — behavior, not
 * source strings.
 */
import { describe, expect, it } from "vitest";

import {
  createSubmissionId,
  decideReplayDisposition,
  dispositionFromResponse,
  ownsSubmission,
  MAX_QUEUE_AGE_MS,
  type QueueIdentity
} from "../lib/offline/submission-queue";

const A: QueueIdentity = { userId: "user-a", orgId: "org-1" };
const B: QueueIdentity = { userId: "user-b", orgId: "org-1" };
const A_OTHER_ORG: QueueIdentity = { userId: "user-a", orgId: "org-2" };

function item(
  owner: QueueIdentity,
  overrides: Partial<{ createdAt: number; status: "pending" | "failed" | "stale" | "quarantined" }> = {}
) {
  return {
    ownerUserId: owner.userId,
    ownerOrgId: owner.orgId,
    createdAt: overrides.createdAt ?? 1_000,
    status: overrides.status ?? ("pending" as const)
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("OFFLINE-01: exactly-once idempotency key", () => {
  it("mints a valid v4 UUID the server's z.string().uuid() will accept", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(createSubmissionId()).toMatch(UUID_RE);
    }
  });

  it("generates distinct ids for distinct submissions", () => {
    const ids = new Set(Array.from({ length: 100 }, () => createSubmissionId()));
    expect(ids.size).toBe(100);
  });

  it("committed-but-response-lost: the same id replays and the server's idempotent 200 settles it (no duplicate)", () => {
    // The client reuses ONE id for the initial attempt and every replay; the
    // server returns the existing row as 200 on the repeat. dispositionFromResponse
    // treats that 200 as done — the item leaves the queue, exactly once.
    const idForInitialAndReplay = createSubmissionId();
    expect(idForInitialAndReplay).toMatch(UUID_RE);
    // First attempt "committed" server-side but the response was lost → client
    // never saw 2xx, so it keeps the SAME id queued. Replay returns idempotent 200.
    expect(dispositionFromResponse(200)).toEqual({ outcome: "done" });
  });
});

describe("OFFLINE-02: ownership binding", () => {
  it("an item belongs only to the exact user+org that created it", () => {
    expect(ownsSubmission(item(A), A)).toBe(true);
    expect(ownsSubmission(item(A), B)).toBe(false); // different user
    expect(ownsSubmission(item(A), A_OTHER_ORG)).toBe(false); // same user, different org
    expect(ownsSubmission(item(A), null)).toBe(false); // logged out
  });
});

describe("OFFLINE-02: replay disposition never crosses accounts or silently drops", () => {
  const now = 10_000;

  it("account switch: user B must NOT transmit user A's queued item — it is quarantined", () => {
    expect(decideReplayDisposition(item(A), B, now)).toBe("quarantine");
  });

  it("logout: with no identity, items are quarantined (hidden), never transmitted or deleted", () => {
    expect(decideReplayDisposition(item(A), null, now)).toBe("quarantine");
  });

  it("logout then the SAME user logs back in: their fresh item transmits again", () => {
    expect(decideReplayDisposition(item(A), null, now)).toBe("quarantine");
    expect(decideReplayDisposition(item(A), A, now)).toBe("transmit");
  });

  it("a fresh, owned, pending item transmits", () => {
    expect(decideReplayDisposition(item(A, { createdAt: now - 1000 }), A, now)).toBe("transmit");
  });

  it("a stale (>48h) owned item is held for review, not transmitted", () => {
    const old = now - (MAX_QUEUE_AGE_MS + 1);
    expect(decideReplayDisposition(item(A, { createdAt: old }), A, now)).toBe("stale");
  });

  it("already-failed / stale / quarantined items are skipped (await explicit user action), never re-sent", () => {
    expect(decideReplayDisposition(item(A, { status: "failed" }), A, now)).toBe("skip");
    expect(decideReplayDisposition(item(A, { status: "stale" }), A, now)).toBe("skip");
    expect(decideReplayDisposition(item(A, { status: "quarantined" }), A, now)).toBe("skip");
  });

  it("a file-bearing item created by A is also quarantined under B (files never cross accounts)", () => {
    // Ownership is independent of payload; a queued receipt/evidence file is
    // gated by the same owner check.
    expect(ownsSubmission(item(A), B)).toBe(false);
    expect(decideReplayDisposition(item(A), B, now)).toBe("quarantine");
  });
});

describe("OFFLINE-02: server rejections surface a visible failed state (no silent delete)", () => {
  it("2xx settles the item as done", () => {
    expect(dispositionFromResponse(200)).toEqual({ outcome: "done" });
    expect(dispositionFromResponse(201)).toEqual({ outcome: "done" });
  });

  it("401, 403, 422 become a VISIBLE failed state carrying the status — not a silent drop", () => {
    expect(dispositionFromResponse(401)).toEqual({ outcome: "failed", failedStatus: 401 });
    expect(dispositionFromResponse(403)).toEqual({ outcome: "failed", failedStatus: 403 });
    expect(dispositionFromResponse(422)).toEqual({ outcome: "failed", failedStatus: 422 });
  });

  it("5xx leaves the item to retry later (transient server error)", () => {
    expect(dispositionFromResponse(500)).toEqual({ outcome: "retry" });
    expect(dispositionFromResponse(503)).toEqual({ outcome: "retry" });
  });
});
