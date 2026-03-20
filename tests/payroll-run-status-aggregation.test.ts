import { describe, expect, it } from "vitest";

import { derivePayrollRunStatusFromCycles } from "../lib/payroll/runs";

describe("derivePayrollRunStatusFromCycles", () => {
  it("treats all-draft semimonthly cycles as a calculated month", () => {
    expect(derivePayrollRunStatusFromCycles(["draft", "draft"], "draft")).toBe("calculated");
  });

  it("surfaces submitted when any cycle is awaiting approval", () => {
    expect(derivePayrollRunStatusFromCycles(["submitted", "draft"], "calculated")).toBe("submitted");
  });

  it("surfaces rejected when a cycle needs correction and none are awaiting approval", () => {
    expect(derivePayrollRunStatusFromCycles(["approved", "rejected"], "approved")).toBe("rejected");
  });

  it("surfaces approved when at least one cycle is approved or ready and none are blocked", () => {
    expect(derivePayrollRunStatusFromCycles(["approved", "draft"], "calculated")).toBe("approved");
    expect(derivePayrollRunStatusFromCycles(["ready", "draft"], "calculated")).toBe("approved");
  });

  it("surfaces processing once any cycle is being processed or has already been paid", () => {
    expect(derivePayrollRunStatusFromCycles(["processing", "draft"], "approved")).toBe("processing");
    expect(derivePayrollRunStatusFromCycles(["paid", "draft"], "approved")).toBe("processing");
  });

  it("preserves completed and cancelled terminal states", () => {
    expect(derivePayrollRunStatusFromCycles(["paid", "paid"], "completed")).toBe("completed");
    expect(derivePayrollRunStatusFromCycles(["draft", "draft"], "cancelled")).toBe("cancelled");
  });
});
