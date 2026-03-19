import { describe, expect, it } from "vitest";

import {
  evaluateCreateAmendmentAction,
  evaluateCycleAction,
  evaluateMarkCyclePaidAction,
  evaluatePreparePayoutAction
} from "../lib/payroll/cycle-policy";

const DEFAULT_ACTOR_ID = "actor-1";
const DEFAULT_SUBMITTED_BY = "submitter-1";

describe("Payroll cycle policy", () => {
  // ── prepare payout (multi-cycle) ────────────────────────────────────

  describe("prepare payout", () => {
    it("allows payout prep on approved run with eligible employees", () => {
      const decision = evaluatePreparePayoutAction({
        runStatus: "approved",
        actorRoles: ["FINANCE_ADMIN"],
        hasEligibleEmployees: true
      });

      expect(decision.allowed).toBe(true);
    });

    it("allows payout prep on processing run (add another cycle)", () => {
      const decision = evaluatePreparePayoutAction({
        runStatus: "processing",
        actorRoles: ["FINANCE_ADMIN"],
        hasEligibleEmployees: true
      });

      expect(decision.allowed).toBe(true);
    });

    it("allows payout prep on draft run (semimonthly auto-create)", () => {
      const decision = evaluatePreparePayoutAction({
        runStatus: "draft",
        actorRoles: ["FINANCE_ADMIN"],
        hasEligibleEmployees: true
      });

      expect(decision.allowed).toBe(true);
    });

    it("blocks when no eligible employees remain", () => {
      const decision = evaluatePreparePayoutAction({
        runStatus: "approved",
        actorRoles: ["FINANCE_ADMIN"],
        hasEligibleEmployees: false
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("INVALID_STATE");
        expect(decision.message).toContain("already assigned");
      }
    });

    it("blocks non-finance roles", () => {
      const decision = evaluatePreparePayoutAction({
        runStatus: "approved",
        actorRoles: ["HR_ADMIN"],
        hasEligibleEmployees: true
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("FORBIDDEN");
      }
    });

    it("blocks completed run", () => {
      const decision = evaluatePreparePayoutAction({
        runStatus: "completed",
        actorRoles: ["FINANCE_ADMIN"],
        hasEligibleEmployees: true
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("INVALID_STATE");
      }
    });
  });

  // ── cycle action: submit ────────────────────────────────────────────

  describe("cycle action: submit", () => {
    it("allows submitting a draft cycle", () => {
      const decision = evaluateCycleAction({
        action: "submit",
        cycleStatus: "draft",
        actorId: DEFAULT_ACTOR_ID,
        submittedBy: null,
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(true);
    });

    it("allows resubmitting a rejected cycle", () => {
      const decision = evaluateCycleAction({
        action: "submit",
        cycleStatus: "rejected",
        actorId: DEFAULT_ACTOR_ID,
        submittedBy: null,
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(true);
    });

    it("blocks submitting an already-submitted cycle", () => {
      const decision = evaluateCycleAction({
        action: "submit",
        cycleStatus: "submitted",
        actorId: DEFAULT_ACTOR_ID,
        submittedBy: null,
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("INVALID_STATE");
      }
    });
  });

  // ── cycle action: approve ───────────────────────────────────────────

  describe("cycle action: approve", () => {
    it("allows FINANCE_APPROVER to approve a submitted cycle", () => {
      const decision = evaluateCycleAction({
        action: "approve",
        cycleStatus: "submitted",
        actorId: DEFAULT_ACTOR_ID,
        submittedBy: DEFAULT_SUBMITTED_BY,
        actorRoles: ["FINANCE_APPROVER"]
      });

      expect(decision.allowed).toBe(true);
    });

    it("allows SUPER_ADMIN to approve a submitted cycle", () => {
      const decision = evaluateCycleAction({
        action: "approve",
        cycleStatus: "submitted",
        actorId: DEFAULT_ACTOR_ID,
        submittedBy: DEFAULT_SUBMITTED_BY,
        actorRoles: ["SUPER_ADMIN"]
      });

      expect(decision.allowed).toBe(true);
    });

    it("blocks FINANCE_ADMIN from approving", () => {
      const decision = evaluateCycleAction({
        action: "approve",
        cycleStatus: "submitted",
        actorId: DEFAULT_ACTOR_ID,
        submittedBy: DEFAULT_SUBMITTED_BY,
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("FORBIDDEN");
      }
    });

    it("blocks submitter from approving their own cycle (separation of duties)", () => {
      const decision = evaluateCycleAction({
        action: "approve",
        cycleStatus: "submitted",
        actorId: DEFAULT_SUBMITTED_BY,
        submittedBy: DEFAULT_SUBMITTED_BY,
        actorRoles: ["FINANCE_APPROVER"]
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("FORBIDDEN");
        expect(decision.message).toContain("submitted the cycle");
      }
    });
  });

  // ── cycle action: reject ────────────────────────────────────────────

  describe("cycle action: reject", () => {
    it("allows FINANCE_APPROVER to reject a submitted cycle", () => {
      const decision = evaluateCycleAction({
        action: "reject",
        cycleStatus: "submitted",
        actorId: DEFAULT_ACTOR_ID,
        submittedBy: DEFAULT_SUBMITTED_BY,
        actorRoles: ["FINANCE_APPROVER"]
      });

      expect(decision.allowed).toBe(true);
    });

    it("blocks submitter from rejecting their own cycle", () => {
      const decision = evaluateCycleAction({
        action: "reject",
        cycleStatus: "submitted",
        actorId: DEFAULT_SUBMITTED_BY,
        submittedBy: DEFAULT_SUBMITTED_BY,
        actorRoles: ["FINANCE_APPROVER"]
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("FORBIDDEN");
      }
    });
  });

  // ── cycle action: mark_ready ──────────────────────────────────────

  describe("cycle action: mark_ready", () => {
    it("allows marking an approved cycle as ready", () => {
      const decision = evaluateCycleAction({
        action: "mark_ready",
        cycleStatus: "approved",
        actorId: DEFAULT_ACTOR_ID,
        submittedBy: null,
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(true);
    });

    it("blocks marking a draft cycle as ready (must be approved first)", () => {
      const decision = evaluateCycleAction({
        action: "mark_ready",
        cycleStatus: "draft",
        actorId: DEFAULT_ACTOR_ID,
        submittedBy: null,
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
        actorId: DEFAULT_ACTOR_ID,
        submittedBy: null,
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
        cycleStatus: "approved",
        actorId: DEFAULT_ACTOR_ID,
        submittedBy: null,
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
        actorId: DEFAULT_ACTOR_ID,
        submittedBy: null,
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(true);
    });

    it("blocks marking a draft cycle as processing (must be ready first)", () => {
      const decision = evaluateCycleAction({
        action: "mark_processing",
        cycleStatus: "draft",
        actorId: DEFAULT_ACTOR_ID,
        submittedBy: null,
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
        actorId: DEFAULT_ACTOR_ID,
        submittedBy: null,
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
    it("allows marking an approved cycle as paid", () => {
      const decision = evaluateCycleAction({
        action: "mark_paid",
        cycleStatus: "approved",
        actorId: DEFAULT_ACTOR_ID,
        submittedBy: null,
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(true);
    });

    it("allows marking a ready cycle as paid", () => {
      const decision = evaluateCycleAction({
        action: "mark_paid",
        cycleStatus: "ready",
        actorId: DEFAULT_ACTOR_ID,
        submittedBy: null,
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(true);
    });

    it("allows marking a processing cycle as paid", () => {
      const decision = evaluateCycleAction({
        action: "mark_paid",
        cycleStatus: "processing",
        actorId: DEFAULT_ACTOR_ID,
        submittedBy: null,
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(true);
    });

    it("blocks marking a draft cycle as paid (must be approved/ready/processing)", () => {
      const decision = evaluateCycleAction({
        action: "mark_paid",
        cycleStatus: "draft",
        actorId: DEFAULT_ACTOR_ID,
        submittedBy: null,
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
        actorId: DEFAULT_ACTOR_ID,
        submittedBy: null,
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
        actorId: DEFAULT_ACTOR_ID,
        submittedBy: null,
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
    it("allows when allCyclesPaid is true", () => {
      const decision = evaluateCreateAmendmentAction({
        allCyclesPaid: true,
        hasActiveAmendment: false,
        actorRoles: ["FINANCE_APPROVER"]
      });

      expect(decision.allowed).toBe(true);
    });

    it("allows SUPER_ADMIN to create amendment", () => {
      const decision = evaluateCreateAmendmentAction({
        allCyclesPaid: true,
        hasActiveAmendment: false,
        actorRoles: ["SUPER_ADMIN"]
      });

      expect(decision.allowed).toBe(true);
    });

    it("blocks amendment when some cycles are still unpaid", () => {
      const decision = evaluateCreateAmendmentAction({
        allCyclesPaid: false,
        hasActiveAmendment: false,
        actorRoles: ["FINANCE_APPROVER"]
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("INVALID_STATE");
        expect(decision.message).toBe("Only fully completed runs (all cycles paid) can be amended.");
      }
    });

    it("blocks FINANCE_ADMIN", () => {
      const decision = evaluateCreateAmendmentAction({
        allCyclesPaid: true,
        hasActiveAmendment: false,
        actorRoles: ["FINANCE_ADMIN"]
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("FORBIDDEN");
      }
    });

    it("blocks active amendment", () => {
      const decision = evaluateCreateAmendmentAction({
        allCyclesPaid: true,
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
