import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { canRequestExpenseInfo } from "../app/api/v1/expenses/_helpers";
import type { UserRole } from "../lib/navigation";

const ROOT = path.resolve(__dirname, "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

/**
 * PR context: migration 20260812060000 gave TEAM_LEAD operational leads RLS
 * READ access to the expense stack, but three app-layer gates still compared
 * manager_id directly or required manager/finance roles outright — locking
 * out team leads, delegates, and named additional approvers the product
 * admits elsewhere. These tests pin the pure gate semantics and the wiring.
 */

describe("canRequestExpenseInfo (pure gate semantics)", () => {
  const base = {
    roles: [] as readonly UserRole[],
    isOwner: false,
    isSuperAdmin: false,
    isManagerOwner: false
  };

  it("pending stage: the operational approver flag is what grants access", () => {
    expect(canRequestExpenseInfo({ ...base, isManagerOwner: true, status: "pending" })).toBe(true);
    expect(canRequestExpenseInfo({ ...base, isManagerOwner: false, status: "pending" })).toBe(false);
    expect(canRequestExpenseInfo({ ...base, isSuperAdmin: true, status: "pending" })).toBe(true);
  });

  it("finance stages: finance roles or super admin, never the owner", () => {
    for (const status of ["manager_approved", "approved"]) {
      expect(
        canRequestExpenseInfo({ ...base, roles: ["FINANCE_APPROVER"] as const, status })
      ).toBe(true);
      expect(
        canRequestExpenseInfo({ ...base, roles: ["FINANCE_ADMIN"] as const, status })
      ).toBe(true);
      expect(canRequestExpenseInfo({ ...base, isManagerOwner: true, status })).toBe(false);
      expect(
        canRequestExpenseInfo({
          ...base,
          roles: ["FINANCE_APPROVER"] as const,
          isOwner: true,
          status
        })
      ).toBe(false);
    }
  });

  it("non-commentable statuses always refuse", () => {
    for (const status of ["reimbursed", "rejected", "cancelled", "finance_rejected"]) {
      expect(canRequestExpenseInfo({ ...base, isSuperAdmin: true, status })).toBe(false);
    }
  });
});

describe("comments route: operational-approver wiring (source pins)", () => {
  const route = read("app/api/v1/expenses/[id]/comments/route.ts");

  it("resolves manager-stage authority via the delegation scope, not raw manager_id", () => {
    expect(route).toContain("resolveIsOperationalApprover");
    expect(route).toContain("isEffectiveApproverFor");
    expect(route).toContain("team_lead_id === profile.id");
    // isManagerOwner (the ACTION authority) must come from the resolver…
    expect(route).toContain("const isManagerOwner = await resolveIsOperationalApprover({");
    expect(route).not.toContain("const isManagerOwner = employeeProfile.manager_id");
    // …while the raw manager_id link remains only as READ visibility.
    expect(route).toContain("const isDirectManager = employeeProfile.manager_id === session.profile.id");
  });

  it("loads expense context and author names via the service role (gates decide access)", () => {
    expect(route).toContain("supabase: svcClient");
    expect(route).toContain('select("id, full_name, manager_id, team_lead_id")');
  });

  it("routes finance-stage FYIs to the operational lead, not blindly to manager_id", () => {
    expect(route).toContain("employeeProfile.team_lead_id ?? employeeProfile.manager_id");
    expect(route).not.toContain("const directManagerId");
  });
});

describe("reports route: delegation-aware scope (source pins)", () => {
  const route = read("app/api/v1/expenses/reports/route.ts");
  const page = read("app/(shell)/expenses/reports/page.tsx");

  it("scopes non-admin callers with getEffectiveApproverScope over service-role reads", () => {
    expect(route).toContain("getEffectiveApproverScope");
    expect(route).toContain("createSupabaseServiceRoleClient");
    expect(route).not.toContain("listManagerScopeIds");
    expect(route).toContain("approverScope.delegatedReportIds");
  });

  it("page gate matches the API gate (TEAM_LEAD admitted on both)", () => {
    expect(page).toContain('hasRole(roles, "TEAM_LEAD")');
  });
});

describe("approvals route: named additional approvers (source pins)", () => {
  const route = read("app/api/v1/expenses/approvals/route.ts");
  const page = read("app/(shell)/approvals/page.tsx");
  const parentClient = read("app/(shell)/approvals/approvals-client.tsx");
  const patchRoute = read("app/api/v1/expenses/[id]/route.ts");
  const countsLib = read("lib/approvals/fetch-approvals-counts.ts");

  it("GET and bulk POST admit a role-less named approver instead of a blanket 403", () => {
    expect(route).toContain("isNamedAdditionalApprover");
    expect(route.match(/countAdditionalExpenses\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("resolveStage defaults a named approver into the additional queue", () => {
    expect(route).toContain('isNamedAdditionalApprover\n          ? "additional"');
  });

  it("the additional badge is counted for every user, not only manager/finance roles", () => {
    expect(countsLib).toContain("export async function countAdditionalExpenses");
    expect(countsLib).not.toContain("(includeManagerExpenses || includeFinanceExpenses)\n      ? countAdditionalExpenses");
  });

  it("the approvals page and expenses tab open for named approvers", () => {
    expect(page).toContain("initialCountsData?.additionalExpenses");
    expect(parentClient).toContain("additionalExpensesCount > 0");
  });

  it("manager approval notifies the named additional approver and defers the finance ping", () => {
    expect(patchRoute).toContain("Expense needs your additional approval");
    expect(patchRoute).toContain("updatedExpense.requiresAdditionalApproval");
  });
});
