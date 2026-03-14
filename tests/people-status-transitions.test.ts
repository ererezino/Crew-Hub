import { describe, expect, it } from "vitest";

import {
  isValidStatusTransition,
  getStatusTransitionError
} from "../lib/people/shared";
import type { ProfileStatus } from "../types/people";

/**
 * Status transition validation tests (W2.2).
 *
 * Enforced transition matrix:
 *   onboarding → active      Allowed (onboarding completion)
 *   onboarding → inactive    Allowed (no-show / rescinded)
 *   onboarding → offboarding Rejected (never active)
 *   active → offboarding     Allowed (structured departure)
 *   active → inactive        Allowed (immediate termination)
 *   active → onboarding      Rejected (backwards lifecycle)
 *   offboarding → inactive   Allowed (offboarding complete)
 *   offboarding → active     Allowed (offboarding cancelled)
 *   offboarding → onboarding Rejected (backwards lifecycle)
 *   inactive → active        Allowed (rehire)
 *   inactive → onboarding    Rejected (onboarding set at creation)
 *   inactive → offboarding   Rejected (must reactivate first)
 *   same → same              Allowed (no-op)
 */

const ALL_STATUSES: ProfileStatus[] = ["onboarding", "active", "offboarding", "inactive"];

describe("Status transition validation (W2.2)", () => {
  // ── Allowed transitions ──

  it.each([
    ["onboarding", "active"],
    ["onboarding", "inactive"],
    ["active", "offboarding"],
    ["active", "inactive"],
    ["offboarding", "inactive"],
    ["offboarding", "active"],
    ["inactive", "active"]
  ] as [ProfileStatus, ProfileStatus][])(
    "allows %s → %s",
    (from, to) => {
      expect(isValidStatusTransition(from, to)).toBe(true);
    }
  );

  // ── Same-status no-ops ──

  it.each(ALL_STATUSES)(
    "allows same-status no-op: %s → %s",
    (status) => {
      expect(isValidStatusTransition(status, status)).toBe(true);
    }
  );

  // ── Rejected transitions ──

  it.each([
    ["active", "onboarding"],
    ["inactive", "onboarding"],
    ["inactive", "offboarding"],
    ["offboarding", "onboarding"],
    ["onboarding", "offboarding"]
  ] as [ProfileStatus, ProfileStatus][])(
    "rejects %s → %s",
    (from, to) => {
      expect(isValidStatusTransition(from, to)).toBe(false);
    }
  );

  // ── Error message quality ──

  it("error message includes from-status, to-status, and allowed alternatives", () => {
    const message = getStatusTransitionError("active", "onboarding");
    expect(message).toContain('"active"');
    expect(message).toContain('"onboarding"');
    expect(message).toContain("offboarding");
    expect(message).toContain("inactive");
  });

  it("error message for inactive → offboarding shows only 'active' as allowed", () => {
    const message = getStatusTransitionError("inactive", "offboarding");
    expect(message).toContain('"inactive"');
    expect(message).toContain('"offboarding"');
    expect(message).toContain("active");
  });

  // ── Exhaustive coverage: every 4×4 pair is accounted for ──

  it("covers all 16 from×to combinations", () => {
    const allowed = new Set([
      "onboarding→onboarding",
      "onboarding→active",
      "onboarding→inactive",
      "active→active",
      "active→offboarding",
      "active→inactive",
      "offboarding→offboarding",
      "offboarding→inactive",
      "offboarding→active",
      "inactive→inactive",
      "inactive→active"
    ]);

    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const key = `${from}→${to}`;
        const result = isValidStatusTransition(from, to);
        expect(result, `Expected ${key} to be ${allowed.has(key) ? "allowed" : "rejected"}`).toBe(
          allowed.has(key)
        );
      }
    }
  });
});
