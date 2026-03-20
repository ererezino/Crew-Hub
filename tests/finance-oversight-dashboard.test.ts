import { describe, expect, it } from "vitest";

import { getDashboardPersona } from "../lib/dashboard-persona";
import type { UserRole } from "../lib/navigation";

/**
 * Finance Oversight Dashboard — role visibility and persona tests.
 *
 * Verifies that:
 * 1. Only FINANCE_APPROVER and SUPER_ADMIN get the finance_approver/super_admin persona
 * 2. FINANCE_ADMIN, HR_ADMIN, MANAGER, EMPLOYEE do NOT get oversight access
 * 3. Persona priority is correct (SUPER_ADMIN > FINANCE_APPROVER > FINANCE_ADMIN)
 * 4. The oversight data shape matches expected types
 */

function personaForRoles(roles: UserRole[]): string {
  return getDashboardPersona({ roles, startDate: null }, null);
}

describe("Finance oversight dashboard visibility", () => {
  // ── Only the right roles get oversight personas ──

  it("FINANCE_APPROVER gets finance_approver persona", () => {
    expect(personaForRoles(["FINANCE_APPROVER"])).toBe("finance_approver");
  });

  it("SUPER_ADMIN gets super_admin persona (includes oversight)", () => {
    expect(personaForRoles(["SUPER_ADMIN"])).toBe("super_admin");
  });

  it("FINANCE_ADMIN does NOT get finance_approver persona", () => {
    expect(personaForRoles(["FINANCE_ADMIN"])).toBe("finance_admin");
  });

  it("HR_ADMIN does NOT get finance oversight persona", () => {
    expect(personaForRoles(["HR_ADMIN"])).toBe("hr_admin");
  });

  it("MANAGER does NOT get finance oversight persona", () => {
    expect(personaForRoles(["MANAGER"])).toBe("manager");
  });

  it("EMPLOYEE does NOT get finance oversight persona", () => {
    expect(personaForRoles(["EMPLOYEE"])).toBe("employee");
  });

  it("TEAM_LEAD does NOT get finance oversight persona", () => {
    expect(personaForRoles(["TEAM_LEAD"])).toBe("manager");
  });

  // ── Persona priority order ──

  it("SUPER_ADMIN takes priority over FINANCE_APPROVER", () => {
    expect(personaForRoles(["SUPER_ADMIN", "FINANCE_APPROVER"])).toBe("super_admin");
  });

  it("FINANCE_APPROVER takes priority over FINANCE_ADMIN", () => {
    expect(personaForRoles(["FINANCE_APPROVER", "FINANCE_ADMIN"])).toBe("finance_approver");
  });

  it("FINANCE_APPROVER takes priority over HR_ADMIN", () => {
    expect(personaForRoles(["FINANCE_APPROVER", "HR_ADMIN"])).toBe("finance_approver");
  });

  it("FINANCE_APPROVER takes priority over MANAGER", () => {
    expect(personaForRoles(["FINANCE_APPROVER", "MANAGER"])).toBe("finance_approver");
  });
});

describe("Finance oversight data shape", () => {
  it("FinanceOversightData type has all required categories", () => {
    // Type-level test: ensure the type exists and has the right shape.
    // We import the type and verify its fields are present.
    type FinanceOversightData = import("../types/dashboard").FinanceOversightData;

    // This function would fail to compile if the type is missing fields.
    const mockData: FinanceOversightData = {
      pendingPayrollApprovals: [],
      pendingSalaryApprovals: { count: 0 },
      historicalAwaitingAction: [],
      completionGaps: [],
      payoutBlockers: [],
      activeCycles: []
    };

    expect(mockData.pendingPayrollApprovals).toEqual([]);
    expect(mockData.pendingSalaryApprovals.count).toBe(0);
    expect(mockData.historicalAwaitingAction).toEqual([]);
    expect(mockData.completionGaps).toEqual([]);
    expect(mockData.payoutBlockers).toEqual([]);
    expect(mockData.activeCycles).toEqual([]);
  });

  it("DashboardResponseData includes financeOversight field", () => {
    type DashboardResponseData = import("../types/dashboard").DashboardResponseData;

    // Type assertion: financeOversight must exist on the type.
    const field: DashboardResponseData["financeOversight"] = null;
    expect(field).toBeNull();
  });

  it("OversightPayrollApproval has correct structure", () => {
    type OversightPayrollApproval = import("../types/dashboard").OversightPayrollApproval;

    const item: OversightPayrollApproval = {
      id: "run-1",
      payPeriod: "2026-03-31",
      status: "submitted",
      employeeCount: 5,
      submittedAt: "2026-03-15T10:00:00Z"
    };

    expect(item.id).toBe("run-1");
    expect(item.status).toBe("submitted");
  });

  it("OversightHistoricalRun has nextStep field", () => {
    type OversightHistoricalRun = import("../types/dashboard").OversightHistoricalRun;

    const item: OversightHistoricalRun = {
      id: "run-2",
      payPeriod: "2025-12-31",
      nextStep: "authorize"
    };

    expect(item.nextStep).toBe("authorize");
  });

  it("OversightActiveCycle has all required fields", () => {
    type OversightActiveCycle = import("../types/dashboard").OversightActiveCycle;

    const item: OversightActiveCycle = {
      runId: "run-3",
      cycleId: "cycle-1",
      label: "Cycle 1",
      status: "processing",
      totalNet: 500000,
      currency: "NGN",
      payPeriod: "2026-03-31"
    };

    expect(item.status).toBe("processing");
    expect(item.totalNet).toBe(500000);
  });
});

describe("Finance oversight — no role leakage", () => {
  it("EMPLOYEE persona does not include oversight in type shape", () => {
    const persona = personaForRoles(["EMPLOYEE"]);
    expect(persona).not.toBe("finance_approver");
    expect(persona).not.toBe("super_admin");
  });

  it("FINANCE_ADMIN persona is separate from FINANCE_APPROVER", () => {
    const finAdmin = personaForRoles(["FINANCE_ADMIN"]);
    const finApprover = personaForRoles(["FINANCE_APPROVER"]);
    expect(finAdmin).toBe("finance_admin");
    expect(finApprover).toBe("finance_approver");
    expect(finAdmin).not.toBe(finApprover);
  });
});
