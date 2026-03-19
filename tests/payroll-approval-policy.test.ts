import { describe, expect, it } from "vitest";

import { evaluatePayrollApprovalAction } from "../lib/payroll/approval-policy";

describe("Payroll approval policy", () => {
  // ── submit ──────────────────────────────────────────────────────────

  it("allows a FINANCE_ADMIN to submit a calculated run", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "submit",
      status: "calculated",
      actorId: "actor-1",
      submittedBy: null,
      actorRoles: ["FINANCE_ADMIN"]
    });

    expect(decision.allowed).toBe(true);
  });

  it("allows resubmission of a rejected run", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "submit",
      status: "rejected",
      actorId: "actor-1",
      submittedBy: "actor-1",
      actorRoles: ["FINANCE_ADMIN"]
    });

    expect(decision.allowed).toBe(true);
  });

  it("blocks submit from non-finance roles", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "submit",
      status: "calculated",
      actorId: "actor-1",
      submittedBy: null,
      actorRoles: ["HR_ADMIN"]
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("FORBIDDEN");
    }
  });

  it("blocks submit for non-calculated/non-rejected runs", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "submit",
      status: "submitted",
      actorId: "actor-1",
      submittedBy: "actor-1",
      actorRoles: ["FINANCE_ADMIN"]
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("INVALID_STATE");
    }
  });

  // ── approve ─────────────────────────────────────────────────────────

  it("allows FINANCE_APPROVER to approve a submitted run they did not submit", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "approve",
      status: "submitted",
      actorId: "approver-1",
      submittedBy: "submitter-1",
      actorRoles: ["FINANCE_APPROVER"]
    });

    expect(decision.allowed).toBe(true);
  });

  it("allows SUPER_ADMIN to approve a submitted run they did not submit", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "approve",
      status: "submitted",
      actorId: "admin-1",
      submittedBy: "submitter-1",
      actorRoles: ["SUPER_ADMIN"]
    });

    expect(decision.allowed).toBe(true);
  });

  it("blocks FINANCE_ADMIN (without FINANCE_APPROVER) from approving", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "approve",
      status: "submitted",
      actorId: "admin-1",
      submittedBy: "submitter-1",
      actorRoles: ["FINANCE_ADMIN"]
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("FORBIDDEN");
    }
  });

  it("blocks the submitter from approving their own submission (separation of duties)", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "approve",
      status: "submitted",
      actorId: "actor-1",
      submittedBy: "actor-1",
      actorRoles: ["FINANCE_APPROVER"]
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("FORBIDDEN");
    }
  });

  it("blocks approval of non-submitted runs", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "approve",
      status: "calculated",
      actorId: "approver-1",
      submittedBy: null,
      actorRoles: ["FINANCE_APPROVER"]
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("INVALID_STATE");
    }
  });

  // ── reject ──────────────────────────────────────────────────────────

  it("allows FINANCE_APPROVER to reject a submitted run they did not submit", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "reject",
      status: "submitted",
      actorId: "approver-1",
      submittedBy: "submitter-1",
      actorRoles: ["FINANCE_APPROVER"]
    });

    expect(decision.allowed).toBe(true);
  });

  it("blocks the submitter from rejecting their own submission", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "reject",
      status: "submitted",
      actorId: "actor-1",
      submittedBy: "actor-1",
      actorRoles: ["FINANCE_APPROVER"]
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("FORBIDDEN");
    }
  });

  it("blocks rejection of non-submitted runs", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "reject",
      status: "approved",
      actorId: "approver-1",
      submittedBy: "submitter-1",
      actorRoles: ["FINANCE_APPROVER"]
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("PAYROLL_LOCKED");
    }
  });

  // ── cancel ──────────────────────────────────────────────────────────

  it("blocks cancel after payroll is approved", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "cancel",
      status: "approved",
      actorId: "actor-4",
      submittedBy: "actor-1",
      actorRoles: ["SUPER_ADMIN"]
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("PAYROLL_LOCKED");
    }
  });

  it("allows cancel on a submitted run", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "cancel",
      status: "submitted",
      actorId: "actor-1",
      submittedBy: "actor-1",
      actorRoles: ["FINANCE_ADMIN"]
    });

    expect(decision.allowed).toBe(true);
  });

  // ── reopen ──────────────────────────────────────────────────────────

  it("allows FINANCE_APPROVER to reopen an approved run", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "reopen",
      status: "approved",
      actorId: "approver-1",
      submittedBy: "submitter-1",
      actorRoles: ["FINANCE_APPROVER"]
    });

    expect(decision.allowed).toBe(true);
  });

  it("blocks FINANCE_ADMIN from reopening (needs FINANCE_APPROVER or SUPER_ADMIN)", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "reopen",
      status: "approved",
      actorId: "admin-1",
      submittedBy: "submitter-1",
      actorRoles: ["FINANCE_ADMIN"]
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("FORBIDDEN");
    }
  });

  // ── locked state guards ─────────────────────────────────────────────

  it("blocks modifications to completed runs", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "cancel",
      status: "completed",
      actorId: "actor-1",
      submittedBy: "submitter-1",
      actorRoles: ["SUPER_ADMIN"]
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("PAYROLL_LOCKED");
    }
  });

  it("allows mark_processing on an approved run", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "mark_processing",
      status: "approved",
      actorId: "actor-1",
      submittedBy: "submitter-1",
      actorRoles: ["FINANCE_ADMIN"]
    });

    expect(decision.allowed).toBe(true);
  });

  it("allows mark_completed on a processing run", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "mark_completed",
      status: "processing",
      actorId: "actor-1",
      submittedBy: "submitter-1",
      actorRoles: ["FINANCE_ADMIN"]
    });

    expect(decision.allowed).toBe(true);
  });
});
