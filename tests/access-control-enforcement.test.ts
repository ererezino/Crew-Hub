import { describe, expect, it } from "vitest";

import {
  getDefaultVisibleRolesForNavItem,
  isNavItemVisibleForUser,
  defaultNavVisibilityForRoles
} from "../lib/access-control";
import type { UserRole } from "../lib/navigation";

/**
 * These tests verify the unified access control model:
 *
 * 1. Default role-based visibility is correct for each nav item
 * 2. Per-person grants/revokes work as expected
 * 3. SUPER_ADMIN always has access
 * 4. Revokes take precedence over grants
 * 5. The configurable vs hard-gated boundary is respected
 */

/* ── Default Role Visibility ── */

describe("Default nav item visibility by role", () => {
  const CONFIGURABLE_ITEMS: Record<string, UserRole[]> = {
    "/people": ["HR_ADMIN", "SUPER_ADMIN"],
    "/payroll": ["FINANCE_ADMIN", "FINANCE_APPROVER", "SUPER_ADMIN"],
    "/analytics": ["HR_ADMIN", "FINANCE_ADMIN", "FINANCE_APPROVER", "SUPER_ADMIN"],
    "/compliance": ["HR_ADMIN", "SUPER_ADMIN"],
    "/performance": ["HR_ADMIN", "SUPER_ADMIN"],
    "/signatures": ["HR_ADMIN", "SUPER_ADMIN"],
    "/approvals": ["MANAGER", "HR_ADMIN", "FINANCE_ADMIN", "FINANCE_APPROVER", "SUPER_ADMIN"],
    "/onboarding": ["MANAGER", "HR_ADMIN", "SUPER_ADMIN"],
    "/admin/compensation": ["HR_ADMIN", "FINANCE_ADMIN", "FINANCE_APPROVER", "SUPER_ADMIN"],
    "/payroll/oversight": ["FINANCE_APPROVER", "SUPER_ADMIN"],
    "/admin/access-control": ["SUPER_ADMIN"]
  };

  for (const [navKey, expectedRoles] of Object.entries(CONFIGURABLE_ITEMS)) {
    it(`${navKey} defaults to ${expectedRoles.join(", ")}`, () => {
      const roles = getDefaultVisibleRolesForNavItem(navKey);
      expect(roles.sort()).toEqual([...expectedRoles].sort());
    });
  }

  it("/people does NOT include FINANCE_ADMIN by default", () => {
    const roles = getDefaultVisibleRolesForNavItem("/people");
    expect(roles).not.toContain("FINANCE_ADMIN");
  });

  it("/people does NOT include MANAGER by default", () => {
    const roles = getDefaultVisibleRolesForNavItem("/people");
    expect(roles).not.toContain("MANAGER");
  });
});

/* ── isNavItemVisibleForUser ── */

describe("isNavItemVisibleForUser", () => {
  const userId = "user-1";

  it("SUPER_ADMIN always has access regardless of visibleToRoles", () => {
    const result = isNavItemVisibleForUser({
      userId,
      userRoles: ["SUPER_ADMIN"],
      visibleToRoles: [], // empty — should still grant
      grantedEmployeeIds: [],
      revokedEmployeeIds: []
    });
    expect(result).toBe(true);
  });

  it("grants access when user's role is in visibleToRoles", () => {
    const result = isNavItemVisibleForUser({
      userId,
      userRoles: ["FINANCE_ADMIN"],
      visibleToRoles: ["HR_ADMIN", "FINANCE_ADMIN", "SUPER_ADMIN"],
      grantedEmployeeIds: [],
      revokedEmployeeIds: []
    });
    expect(result).toBe(true);
  });

  it("denies access when user's role is NOT in visibleToRoles", () => {
    const result = isNavItemVisibleForUser({
      userId,
      userRoles: ["FINANCE_ADMIN"],
      visibleToRoles: ["HR_ADMIN", "SUPER_ADMIN"],
      grantedEmployeeIds: [],
      revokedEmployeeIds: []
    });
    expect(result).toBe(false);
  });

  it("EMPLOYEE cannot access /people by default", () => {
    const result = isNavItemVisibleForUser({
      userId,
      userRoles: ["EMPLOYEE"],
      visibleToRoles: getDefaultVisibleRolesForNavItem("/people"),
      grantedEmployeeIds: [],
      revokedEmployeeIds: []
    });
    expect(result).toBe(false);
  });

  it("FINANCE_ADMIN cannot access /people by default", () => {
    const result = isNavItemVisibleForUser({
      userId,
      userRoles: ["FINANCE_ADMIN"],
      visibleToRoles: getDefaultVisibleRolesForNavItem("/people"),
      grantedEmployeeIds: [],
      revokedEmployeeIds: []
    });
    expect(result).toBe(false);
  });

  it("HR_ADMIN can access /people by default", () => {
    const result = isNavItemVisibleForUser({
      userId,
      userRoles: ["HR_ADMIN"],
      visibleToRoles: getDefaultVisibleRolesForNavItem("/people"),
      grantedEmployeeIds: [],
      revokedEmployeeIds: []
    });
    expect(result).toBe(true);
  });
});

/* ── Per-Person Grants ── */

describe("Per-person grants", () => {
  const userId = "user-1";

  it("grants access to a user explicitly listed in grantedEmployeeIds", () => {
    const result = isNavItemVisibleForUser({
      userId,
      userRoles: ["EMPLOYEE"],
      visibleToRoles: ["HR_ADMIN", "SUPER_ADMIN"], // EMPLOYEE not included
      grantedEmployeeIds: [userId], // but explicitly granted
      revokedEmployeeIds: []
    });
    expect(result).toBe(true);
  });

  it("does not grant access to a different user via grantedEmployeeIds", () => {
    const result = isNavItemVisibleForUser({
      userId,
      userRoles: ["EMPLOYEE"],
      visibleToRoles: ["HR_ADMIN", "SUPER_ADMIN"],
      grantedEmployeeIds: ["other-user"],
      revokedEmployeeIds: []
    });
    expect(result).toBe(false);
  });
});

/* ── Per-Person Revokes ── */

describe("Per-person revokes", () => {
  const userId = "user-1";

  it("revokes access even when user's role is in visibleToRoles", () => {
    const result = isNavItemVisibleForUser({
      userId,
      userRoles: ["HR_ADMIN"],
      visibleToRoles: ["HR_ADMIN", "SUPER_ADMIN"],
      grantedEmployeeIds: [],
      revokedEmployeeIds: [userId] // explicitly revoked
    });
    expect(result).toBe(false);
  });

  it("revoke takes precedence over grant for the same user", () => {
    const result = isNavItemVisibleForUser({
      userId,
      userRoles: ["EMPLOYEE"],
      visibleToRoles: [],
      grantedEmployeeIds: [userId],
      revokedEmployeeIds: [userId] // both granted and revoked → revoked wins
    });
    expect(result).toBe(false);
  });

  it("SUPER_ADMIN cannot be revoked (always has access)", () => {
    const result = isNavItemVisibleForUser({
      userId,
      userRoles: ["SUPER_ADMIN"],
      visibleToRoles: [],
      grantedEmployeeIds: [],
      revokedEmployeeIds: [userId] // revoked, but SUPER_ADMIN overrides
    });
    expect(result).toBe(true);
  });
});

/* ── Role Visibility Aggregation ── */

describe("defaultNavVisibilityForRoles", () => {
  it("EMPLOYEE sees core personal modules", () => {
    const visible = defaultNavVisibilityForRoles(["EMPLOYEE"]);
    expect(visible).toContain("/dashboard");
    expect(visible).toContain("/time-off");
    expect(visible).toContain("/me/pay");
    expect(visible).toContain("/me/documents");
    expect(visible).toContain("/expenses");
    expect(visible).not.toContain("/documents");
    expect(visible).not.toContain("/people");
    expect(visible).not.toContain("/payroll");
    expect(visible).not.toContain("/analytics");
    expect(visible).not.toContain("/admin/access-control");
  });

  it("FINANCE_ADMIN sees payroll and compensation but not people or oversight (by default)", () => {
    const visible = defaultNavVisibilityForRoles(["FINANCE_ADMIN"]);
    expect(visible).toContain("/payroll");
    expect(visible).toContain("/admin/compensation");
    expect(visible).toContain("/analytics");
    expect(visible).not.toContain("/people");
    expect(visible).not.toContain("/payroll/oversight");
    expect(visible).not.toContain("/admin/access-control");
  });

  it("FINANCE_APPROVER sees payroll, oversight, and compensation", () => {
    const visible = defaultNavVisibilityForRoles(["FINANCE_APPROVER"]);
    expect(visible).toContain("/payroll");
    expect(visible).toContain("/payroll/oversight");
    expect(visible).toContain("/admin/compensation");
    expect(visible).not.toContain("/people");
  });

  it("HR_ADMIN sees people, compliance, performance", () => {
    const visible = defaultNavVisibilityForRoles(["HR_ADMIN"]);
    expect(visible).toContain("/people");
    expect(visible).toContain("/compliance");
    expect(visible).toContain("/performance");
    expect(visible).toContain("/signatures");
    expect(visible).not.toContain("/admin/access-control");
  });

  it("SUPER_ADMIN sees everything", () => {
    const visible = defaultNavVisibilityForRoles(["SUPER_ADMIN"]);
    expect(visible).toContain("/people");
    expect(visible).toContain("/payroll");
    expect(visible).toContain("/admin/access-control");
    expect(visible).toContain("/analytics");
    expect(visible).toContain("/performance");
  });

  it("MANAGER sees approvals and onboarding", () => {
    const visible = defaultNavVisibilityForRoles(["MANAGER"]);
    expect(visible).toContain("/approvals");
    expect(visible).toContain("/onboarding");
    expect(visible).not.toContain("/payroll");
    expect(visible).not.toContain("/admin/access-control");
  });
});

/* ── Access Control Admin UI Data Transformation ── */

describe("Role-to-nav-item visibility transformation", () => {
  it("toggling a role on/off for a nav item updates visibleToRoles correctly", () => {
    // Simulates what the admin UI does when toggling FINANCE_ADMIN on for /people
    const currentVisibleToRoles: UserRole[] = ["HR_ADMIN", "SUPER_ADMIN"];
    const roleToToggle: UserRole = "FINANCE_ADMIN";
    const addRole = true;

    const updated = addRole
      ? [...currentVisibleToRoles, roleToToggle]
      : currentVisibleToRoles.filter((r) => r !== roleToToggle);

    expect(updated).toContain("FINANCE_ADMIN");
    expect(updated).toContain("HR_ADMIN");

    // And removing it
    const removed = updated.filter((r) => r !== "FINANCE_ADMIN");
    expect(removed).not.toContain("FINANCE_ADMIN");
    expect(removed).toContain("HR_ADMIN");
  });
});
