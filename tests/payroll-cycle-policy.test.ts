import { describe, expect, it } from "vitest";

import {
  evaluateCreateAmendmentAction,
  evaluateMarkCyclePaidAction,
  evaluatePreparePayoutAction
} from "../lib/payroll/cycle-policy";

describe("Payroll cycle policy", () => {
  // ── prepare payout ─────────────────────────────────────────────────

  describe("prepare payout", () => {
    it("allows payout prep on an approved run with no flags", () => {
      const decision = evaluatePreparePayoutAction({
        runStatus: "approved",
        flaggedCount: 0,
        overrideHolds: false,
        actorRoles: ["FINANCE_ADMIN"],
        existingCycleCount: 0
      });

      expect(decision.allowed).toBe(true);
    });

    it("blocks payout prep when run is not approved", () => {
      const decision = evaluatePreparePayoutAction({
        runStatus: "calculated",
        flaggedCount: 0,
        overrideHolds: false,
        actorRoles: ["FINANCE_ADMIN"],
        existingCycleCount: 0
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("INVALID_STATE");
      }
    });

    it("blocks payout prep when cycles already exist", () => {
      const decision = evaluatePreparePayoutAction({
        runStatus: "approved",
        flaggedCount: 0,
        overrideHolds: false,
        actorRoles: ["FINANCE_ADMIN"],
        existingCycleCount: 2
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("INVALID_STATE");
      }
    });

    it("blocks payout prep when flagged items exist and no override", () => {
      const decision = evaluatePreparePayoutAction({
        runStatus: "approved",
        flaggedCount: 3,
        overrideHolds: false,
        actorRoles: ["FINANCE_ADMIN"],
        existingCycleCount: 0
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("INVALID_STATE");
      }
    });

    it("allows payout prep with override by FINANCE_APPROVER", () => {
      const decision = evaluatePreparePayoutAction({
        runStatus: "approved",
        flaggedCount: 2,
        overrideHolds: true,
        actorRoles: ["FINANCE_APPROVER"],
        existingCycleCount: 0
      });

      expect(decision.allowed).toBe(true);
    });

    it("blocks hold override by FINANCE_ADMIN (requires FINANCE_APPROVER or SUPER_ADMIN)", () => {
      const decision = evaluatePreparePayoutAction({
        runStatus: "approved",
        flaggedCount: 2,
        overrideHolds: true,
        actorRoles: ["FINANCE_ADMIN"],
        existingCycleCount: 0
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("FORBIDDEN");
      }
    });

    it("allows hold override by SUPER_ADMIN", () => {
      const decision = evaluatePreparePayoutAction({
        runStatus: "approved",
        flaggedCount: 1,
        overrideHolds: true,
        actorRoles: ["SUPER_ADMIN"],
        existingCycleCount: 0
      });

      expect(decision.allowed).toBe(true);
    });

    it("blocks non-finance roles from preparing payout", () => {
      const decision = evaluatePreparePayoutAction({
        runStatus: "approved",
        flaggedCount: 0,
        overrideHolds: false,
        actorRoles: ["HR_ADMIN"],
        existingCycleCount: 0
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("FORBIDDEN");
      }
    });
  });

  // ── mark cycle paid ────────────────────────────────────────────────

  describe("mark cycle paid", () => {
    it("allows marking a ready cycle as paid", () => {
      const decision = evaluateMarkCyclePaidAction({
        cycleStatus: "ready",
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(true);
    });

    it("allows marking a processing cycle as paid", () => {
      const decision = evaluateMarkCyclePaidAction({
        cycleStatus: "processing",
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(true);
    });

    it("blocks marking a draft cycle as paid", () => {
      const decision = evaluateMarkCyclePaidAction({
        cycleStatus: "draft",
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("INVALID_STATE");
      }
    });

    it("blocks marking an already-paid cycle as paid", () => {
      const decision = evaluateMarkCyclePaidAction({
        cycleStatus: "paid",
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("INVALID_STATE");
      }
    });

    it("blocks non-finance roles from marking paid", () => {
      const decision = evaluateMarkCyclePaidAction({
        cycleStatus: "ready",
        actorRoles: ["HR_ADMIN"]
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("FORBIDDEN");
      }
    });
  });

  // ── create amendment ───────────────────────────────────────────────

  describe("create amendment", () => {
    it("allows FINANCE_APPROVER to create amendment on locked run", () => {
      const decision = evaluateCreateAmendmentAction({
        runLockedAt: "2026-03-19T00:00:00Z",
        hasActiveAmendment: false,
        actorRoles: ["FINANCE_APPROVER"]
      });

      expect(decision.allowed).toBe(true);
    });

    it("allows SUPER_ADMIN to create amendment", () => {
      const decision = evaluateCreateAmendmentAction({
        runLockedAt: "2026-03-19T00:00:00Z",
        hasActiveAmendment: false,
        actorRoles: ["SUPER_ADMIN"]
      });

      expect(decision.allowed).toBe(true);
    });

    it("blocks FINANCE_ADMIN from creating amendment", () => {
      const decision = evaluateCreateAmendmentAction({
        runLockedAt: "2026-03-19T00:00:00Z",
        hasActiveAmendment: false,
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("FORBIDDEN");
      }
    });

    it("blocks amendment when run has no locked_at", () => {
      const decision = evaluateCreateAmendmentAction({
        runLockedAt: null,
        hasActiveAmendment: false,
        actorRoles: ["FINANCE_APPROVER"]
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("INVALID_STATE");
      }
    });

    it("blocks amendment when active amendment already exists", () => {
      const decision = evaluateCreateAmendmentAction({
        runLockedAt: "2026-03-19T00:00:00Z",
        hasActiveAmendment: true,
        actorRoles: ["FINANCE_APPROVER"]
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("INVALID_STATE");
      }
    });
  });
});
