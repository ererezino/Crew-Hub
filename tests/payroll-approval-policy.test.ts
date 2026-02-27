import { describe, expect, it } from "vitest";

import { evaluatePayrollApprovalAction } from "../lib/payroll/approval-policy";

describe("Payroll approval policy", () => {
  it("returns 403 when an initiator attempts first approval", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "approve_first",
      status: "pending_first_approval",
      actorId: "actor-1",
      initiatedBy: "actor-1",
      firstApprovedBy: null,
      actorRoles: ["FINANCE_ADMIN"]
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("FORBIDDEN");
    }
  });

  it("returns 403 when the same person tries both approvals", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "approve_final",
      status: "pending_final_approval",
      actorId: "actor-2",
      initiatedBy: "actor-1",
      firstApprovedBy: "actor-2",
      actorRoles: ["SUPER_ADMIN"]
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("FORBIDDEN");
    }
  });

  it("returns 403 when non-SUPER_ADMIN attempts final approval", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "approve_final",
      status: "pending_final_approval",
      actorId: "actor-3",
      initiatedBy: "actor-1",
      firstApprovedBy: "actor-2",
      actorRoles: ["FINANCE_ADMIN"]
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("FORBIDDEN");
    }
  });

  it("returns 403 for edits after payroll is approved", () => {
    const decision = evaluatePayrollApprovalAction({
      action: "cancel",
      status: "approved",
      actorId: "actor-4",
      initiatedBy: "actor-1",
      firstApprovedBy: "actor-2",
      actorRoles: ["SUPER_ADMIN"]
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("PAYROLL_LOCKED");
    }
  });
});
