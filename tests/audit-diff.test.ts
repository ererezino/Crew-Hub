import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("../lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("../lib/supabase/service-role", () => ({ createSupabaseServiceRoleClient: vi.fn() }));

import { AUDIT_REDACTED, diffAuditValues } from "../lib/audit";

describe("diffAuditValues", () => {
  it("returns only changed fields, paired old and new", () => {
    const { oldValue, newValue, changedFields } = diffAuditValues(
      { baseSalaryAmount: 5000000, currency: "NGN", payFrequency: "monthly" },
      { baseSalaryAmount: 5500000, currency: "NGN", payFrequency: "monthly" }
    );

    expect(changedFields).toEqual(["baseSalaryAmount"]);
    expect(oldValue).toEqual({ baseSalaryAmount: 5000000 });
    expect(newValue).toEqual({ baseSalaryAmount: 5500000 });
  });

  it("diffs added and removed fields against null", () => {
    const { oldValue, newValue } = diffAuditValues(
      { phone: "+2348000000000" },
      { department: "Engineering" }
    );

    expect(oldValue).toEqual({ phone: "+2348000000000", department: null });
    expect(newValue).toEqual({ phone: null, department: "Engineering" });
  });

  it("compares arrays and objects structurally", () => {
    const unchanged = diffAuditValues(
      { roles: ["EMPLOYEE", "MANAGER"] },
      { roles: ["EMPLOYEE", "MANAGER"] }
    );
    expect(unchanged.changedFields).toEqual([]);

    const changed = diffAuditValues(
      { roles: ["EMPLOYEE"] },
      { roles: ["EMPLOYEE", "MANAGER"] }
    );
    expect(changed.changedFields).toEqual(["roles"]);
    expect(changed.oldValue.roles).toEqual(["EMPLOYEE"]);
  });

  it("supports the redaction marker for sensitive values", () => {
    const { oldValue, newValue, changedFields } = diffAuditValues(
      { governmentIdUrl: null },
      { governmentIdUrl: AUDIT_REDACTED }
    );

    expect(changedFields).toEqual(["governmentIdUrl"]);
    expect(newValue.governmentIdUrl).toBe("[redacted]");
    expect(oldValue.governmentIdUrl).toBeNull();
  });

  it("returns empty diffs for identical records", () => {
    const result = diffAuditValues({ a: 1, b: "x" }, { a: 1, b: "x" });
    expect(result.changedFields).toEqual([]);
    expect(result.oldValue).toEqual({});
    expect(result.newValue).toEqual({});
  });
});
