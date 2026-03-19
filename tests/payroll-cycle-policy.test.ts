import { describe, expect, it } from "vitest";

import {
  evaluateCreateAmendmentAction,
  evaluateCycleAction,
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

  // ── cycle action: mark_ready ──────────────────────────────────────

  describe("cycle action: mark_ready", () => {
    it("allows marking a draft cycle as ready", () => {
      const decision = evaluateCycleAction({
        action: "mark_ready",
        cycleStatus: "draft",
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(true);
    });

    it("blocks marking a ready cycle as ready (already transitioned)", () => {
      const decision = evaluateCycleAction({
        action: "mark_ready",
        cycleStatus: "ready",
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("INVALID_STATE");
      }
    });

    it("blocks marking a paid cycle as ready", () => {
      const decision = evaluateCycleAction({
        action: "mark_ready",
        cycleStatus: "paid",
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("INVALID_STATE");
      }
    });

    it("blocks non-finance roles from marking ready", () => {
      const decision = evaluateCycleAction({
        action: "mark_ready",
        cycleStatus: "draft",
        actorRoles: ["HR_ADMIN"]
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("FORBIDDEN");
      }
    });
  });

  // ── cycle action: mark_processing ─────────────────────────────────

  describe("cycle action: mark_processing", () => {
    it("allows marking a ready cycle as processing", () => {
      const decision = evaluateCycleAction({
        action: "mark_processing",
        cycleStatus: "ready",
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(true);
    });

    it("blocks marking a draft cycle as processing (must be ready first)", () => {
      const decision = evaluateCycleAction({
        action: "mark_processing",
        cycleStatus: "draft",
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("INVALID_STATE");
      }
    });

    it("blocks marking a paid cycle as processing", () => {
      const decision = evaluateCycleAction({
        action: "mark_processing",
        cycleStatus: "paid",
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("INVALID_STATE");
      }
    });
  });

  // ── cycle action: mark_paid ───────────────────────────────────────

  describe("cycle action: mark_paid", () => {
    it("allows marking a ready cycle as paid", () => {
      const decision = evaluateCycleAction({
        action: "mark_paid",
        cycleStatus: "ready",
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(true);
    });

    it("allows marking a processing cycle as paid", () => {
      const decision = evaluateCycleAction({
        action: "mark_paid",
        cycleStatus: "processing",
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(true);
    });

    it("blocks marking a draft cycle as paid (must be ready or processing)", () => {
      const decision = evaluateCycleAction({
        action: "mark_paid",
        cycleStatus: "draft",
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("INVALID_STATE");
      }
    });

    it("blocks marking an already-paid cycle as paid", () => {
      const decision = evaluateCycleAction({
        action: "mark_paid",
        cycleStatus: "paid",
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("INVALID_STATE");
      }
    });

    it("blocks non-finance roles from marking paid", () => {
      const decision = evaluateCycleAction({
        action: "mark_paid",
        cycleStatus: "ready",
        actorRoles: ["HR_ADMIN"]
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("FORBIDDEN");
      }
    });
  });

  // ── mark cycle paid (legacy function) ─────────────────────────────

  describe("mark cycle paid (legacy)", () => {
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
    it("allows FINANCE_APPROVER to create amendment when run has paid cycles", () => {
      const decision = evaluateCreateAmendmentAction({
        hasPaidCycles: true,
        hasActiveAmendment: false,
        actorRoles: ["FINANCE_APPROVER"]
      });

      expect(decision.allowed).toBe(true);
    });

    it("allows SUPER_ADMIN to create amendment", () => {
      const decision = evaluateCreateAmendmentAction({
        hasPaidCycles: true,
        hasActiveAmendment: false,
        actorRoles: ["SUPER_ADMIN"]
      });

      expect(decision.allowed).toBe(true);
    });

    it("blocks FINANCE_ADMIN from creating amendment", () => {
      const decision = evaluateCreateAmendmentAction({
        hasPaidCycles: true,
        hasActiveAmendment: false,
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("FORBIDDEN");
      }
    });

    it("blocks amendment when run has no paid cycles", () => {
      const decision = evaluateCreateAmendmentAction({
        hasPaidCycles: false,
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
        hasPaidCycles: true,
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
