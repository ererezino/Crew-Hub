/**
 * W1.4: Verifies that health check DB failures produce visible error alerts
 * instead of silently returning null (which the dashboard treats as "all clear").
 */
import { describe, expect, it, vi } from "vitest";
import { getOrgHealthAlerts, type HealthAlert } from "../lib/dashboard/health-alerts";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";

// ── Supabase mock helpers ─────────────────────────────────────────────

/** Chainable query that resolves with the given value at any terminal. */
function chainable(resolvedValue: { data?: unknown; error?: unknown; count?: unknown }) {
  const self = {
    select: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    is: vi.fn(),
    in: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
    then: (resolve: (v: unknown) => void) => resolve(resolvedValue)
  };
  for (const method of ["select", "eq", "neq", "is", "in", "gte", "lte", "order", "limit"]) {
    (self as unknown as Record<string, ReturnType<typeof vi.fn>>)[method].mockReturnValue(self);
  }
  self.maybeSingle.mockResolvedValue(resolvedValue);
  self.single.mockResolvedValue(resolvedValue);
  return self;
}

/** Supabase mock where EVERY table query returns an error. */
function allFailingSupabase() {
  return {
    from: vi.fn(() => chainable({ data: null, error: { message: "connection refused" } }))
  } as never;
}

/** Supabase mock where EVERY table query returns empty/zero results (no issues). */
function allHealthySupabase() {
  return {
    from: vi.fn(() => chainable({ data: [], error: null, count: 0 }))
  } as never;
}

/** Supabase mock with per-table control. */
function mixedSupabase(tableResults: Record<string, { data?: unknown; error?: unknown; count?: unknown }>) {
  return {
    from: vi.fn((table: string) => {
      const result = tableResults[table] ?? { data: [], error: null, count: 0 };
      return chainable(result);
    })
  } as never;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("Health alerts — failure surfacing (W1.4)", () => {
  it("returns check-failure alerts for ALL checks when DB is completely down", async () => {
    const alerts = await getOrgHealthAlerts(allFailingSupabase(), ORG_ID);

    // All 5 checks should produce a check_failed alert
    expect(alerts.length).toBe(5);
    for (const alert of alerts) {
      expect(alert.key).toMatch(/^check_failed_/);
      expect(alert.label).toMatch(/^Unable to check:/);
      expect(alert.severity).toBe("error");
      expect(alert.count).toBe(0);
      expect(alert.icon).toBe("AlertTriangle");
    }
  });

  it("returns empty array when all checks succeed with no issues", async () => {
    const alerts = await getOrgHealthAlerts(allHealthySupabase(), ORG_ID);
    expect(alerts).toEqual([]);
  });

  it("returns check-failure alert for contractors check on DB error", async () => {
    const supabase = mixedSupabase({
      profiles: { data: null, error: { message: "timeout" } }
    });

    const alerts = await getOrgHealthAlerts(supabase, ORG_ID);
    const contractorAlert = alerts.find((a) => a.key === "check_failed_contractors_missing_payout");
    expect(contractorAlert).toBeDefined();
    expect(contractorAlert!.severity).toBe("error");
    expect(contractorAlert!.label).toBe("Unable to check: contractors missing payout method");
  });

  it("returns check-failure alert for stale onboarding on DB error", async () => {
    const supabase = mixedSupabase({
      onboarding_instances: { data: null, error: { message: "timeout" } }
    });

    const alerts = await getOrgHealthAlerts(supabase, ORG_ID);
    const staleAlert = alerts.find((a) => a.key === "check_failed_stale_onboarding");
    expect(staleAlert).toBeDefined();
    expect(staleAlert!.label).toBe("Unable to check: stale onboarding instances");
  });

  it("returns check-failure alert for compliance deadlines on DB error", async () => {
    const supabase = mixedSupabase({
      compliance_deadlines: { data: null, error: { message: "timeout" }, count: null }
    });

    const alerts = await getOrgHealthAlerts(supabase, ORG_ID);
    const complianceAlert = alerts.find((a) => a.key === "check_failed_compliance_due_soon");
    expect(complianceAlert).toBeDefined();
    expect(complianceAlert!.label).toBe("Unable to check: compliance deadlines");
  });

  it("returns check-failure alert for stuck expenses on DB error", async () => {
    const supabase = mixedSupabase({
      expenses: { data: null, error: { message: "timeout" }, count: null }
    });

    const alerts = await getOrgHealthAlerts(supabase, ORG_ID);
    const expenseAlert = alerts.find((a) => a.key === "check_failed_expenses_stuck");
    expect(expenseAlert).toBeDefined();
    expect(expenseAlert!.label).toBe("Unable to check: stuck expenses");
  });

  it("returns check-failure alert for expiring documents on DB error", async () => {
    const supabase = mixedSupabase({
      documents: { data: null, error: { message: "timeout" }, count: null }
    });

    const alerts = await getOrgHealthAlerts(supabase, ORG_ID);
    const docAlert = alerts.find((a) => a.key === "check_failed_documents_expiring");
    expect(docAlert).toBeDefined();
    expect(docAlert!.label).toBe("Unable to check: expiring documents");
  });

  it("surfaces error alerts sorted before warning/info alerts in mixed scenarios", async () => {
    // Compliance check fails, but documents check finds real results
    const supabase = mixedSupabase({
      compliance_deadlines: { data: null, error: { message: "timeout" }, count: null },
      documents: { data: null, error: null, count: 3 }
    });

    const alerts = await getOrgHealthAlerts(supabase, ORG_ID);

    // Should have the compliance failure alert (error) and documents alert (info)
    const failedAlerts = alerts.filter((a) => a.key.startsWith("check_failed_"));
    const realAlerts = alerts.filter((a) => !a.key.startsWith("check_failed_"));

    expect(failedAlerts.length).toBeGreaterThan(0);

    // Error-severity alerts should come first
    if (failedAlerts.length > 0 && realAlerts.length > 0) {
      const firstFailed = alerts.indexOf(failedAlerts[0]);
      const firstReal = alerts.indexOf(realAlerts[0]);
      // Error alerts (severity 0) sort before info alerts (severity 2)
      expect(firstFailed).toBeLessThan(firstReal);
    }
  });

  it("catches unexpected exceptions and returns check-failure alert", async () => {
    // Supabase .from() itself throws an exception
    const throwingSupabase = {
      from: vi.fn(() => { throw new Error("unexpected crash"); })
    } as never;

    const alerts = await getOrgHealthAlerts(throwingSupabase, ORG_ID);

    // All 5 should be check_failed (caught by outer catch blocks)
    expect(alerts.length).toBe(5);
    for (const alert of alerts) {
      expect(alert.key).toMatch(/^check_failed_/);
      expect(alert.severity).toBe("error");
    }
  });
});
