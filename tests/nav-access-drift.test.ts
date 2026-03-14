import { describe, expect, it } from "vitest";

import {
  defaultNavVisibilityForRoles,
  getDefaultVisibleRolesForNavItem
} from "../lib/access-control";
import { resolveDefaultAccessForRoles } from "../lib/auth/default-role-access";
import type { UserRole } from "../lib/navigation";

/**
 * These tests guard against nav-config drift: a role seeing a nav item
 * that leads to a page it cannot actually use.
 *
 * The two proven mismatches fixed in W2.6:
 *   - TEAM_LEAD was shown /approvals but the page denies access
 *   - TEAM_LEAD was shown /onboarding but the page denies access
 *
 * The tests also verify that roles which CAN use those pages still see them,
 * and that TEAM_LEAD's legitimate nav items (/scheduling, /team-hub) remain.
 */

function navVisibleForRole(role: UserRole): string[] {
  return defaultNavVisibilityForRoles([role]);
}

function defaultAccessForRole(role: UserRole): string[] {
  return resolveDefaultAccessForRoles([role]);
}

describe("Nav visibility alignment (W2.6)", () => {
  // ── TEAM_LEAD: removed from /approvals and /onboarding ──

  it("TEAM_LEAD does NOT see /approvals in nav visibility", () => {
    const visible = navVisibleForRole("TEAM_LEAD");
    expect(visible).not.toContain("/approvals");
  });

  it("TEAM_LEAD does NOT see /onboarding in nav visibility", () => {
    const visible = navVisibleForRole("TEAM_LEAD");
    expect(visible).not.toContain("/onboarding");
  });

  it("TEAM_LEAD does NOT have /approvals in default role access", () => {
    const access = defaultAccessForRole("TEAM_LEAD");
    expect(access).not.toContain("/approvals");
  });

  it("TEAM_LEAD does NOT have /onboarding in default role access", () => {
    const access = defaultAccessForRole("TEAM_LEAD");
    expect(access).not.toContain("/onboarding");
  });

  // ── TEAM_LEAD: still has legitimate nav items ──

  it("TEAM_LEAD still sees /scheduling in nav visibility", () => {
    const visible = navVisibleForRole("TEAM_LEAD");
    expect(visible).toContain("/scheduling");
  });

  it("TEAM_LEAD still sees /team-hub in nav visibility", () => {
    const visible = navVisibleForRole("TEAM_LEAD");
    expect(visible).toContain("/team-hub");
  });

  it("TEAM_LEAD still has /scheduling/manage in default role access", () => {
    const access = defaultAccessForRole("TEAM_LEAD");
    expect(access).toContain("/scheduling/manage");
  });

  // ── MANAGER: /people is admin-only, not part of MANAGER default access ──

  it("MANAGER does NOT have /people in default role access", () => {
    const access = defaultAccessForRole("MANAGER");
    expect(access).not.toContain("/people");
  });

  it("MANAGER does NOT see /people in nav visibility", () => {
    const visible = navVisibleForRole("MANAGER");
    expect(visible).not.toContain("/people");
  });

  // ── MANAGER: still has /approvals and /onboarding ──

  it("MANAGER still sees /approvals in nav visibility", () => {
    const visible = navVisibleForRole("MANAGER");
    expect(visible).toContain("/approvals");
  });

  it("MANAGER still sees /onboarding in nav visibility", () => {
    const visible = navVisibleForRole("MANAGER");
    expect(visible).toContain("/onboarding");
  });

  it("MANAGER still has /approvals in default role access", () => {
    const access = defaultAccessForRole("MANAGER");
    expect(access).toContain("/approvals");
  });

  it("MANAGER still has /onboarding in default role access", () => {
    const access = defaultAccessForRole("MANAGER");
    expect(access).toContain("/onboarding");
  });

  // ── HR_ADMIN: still has both ──

  it("HR_ADMIN still sees /approvals in nav visibility", () => {
    const visible = navVisibleForRole("HR_ADMIN");
    expect(visible).toContain("/approvals");
  });

  it("HR_ADMIN still sees /onboarding in nav visibility", () => {
    const visible = navVisibleForRole("HR_ADMIN");
    expect(visible).toContain("/onboarding");
  });

  it("HR_ADMIN still has /approvals in default role access", () => {
    const access = defaultAccessForRole("HR_ADMIN");
    expect(access).toContain("/approvals");
  });

  it("HR_ADMIN still has /onboarding in default role access", () => {
    const access = defaultAccessForRole("HR_ADMIN");
    expect(access).toContain("/onboarding");
  });

  // ── Role list consistency for the affected nav items ──

  it("/approvals visible-to-roles does not include TEAM_LEAD", () => {
    const roles = getDefaultVisibleRolesForNavItem("/approvals");
    expect(roles).not.toContain("TEAM_LEAD");
    expect(roles).toContain("MANAGER");
    expect(roles).toContain("HR_ADMIN");
    expect(roles).toContain("FINANCE_ADMIN");
  });

  it("/onboarding visible-to-roles does not include TEAM_LEAD", () => {
    const roles = getDefaultVisibleRolesForNavItem("/onboarding");
    expect(roles).not.toContain("TEAM_LEAD");
    expect(roles).toContain("MANAGER");
    expect(roles).toContain("HR_ADMIN");
  });

  it("/scheduling visible-to-roles still includes TEAM_LEAD", () => {
    const roles = getDefaultVisibleRolesForNavItem("/scheduling");
    expect(roles).toContain("TEAM_LEAD");
  });

  it("/team-hub visible-to-roles still includes TEAM_LEAD", () => {
    const roles = getDefaultVisibleRolesForNavItem("/team-hub");
    expect(roles).toContain("TEAM_LEAD");
  });
});
