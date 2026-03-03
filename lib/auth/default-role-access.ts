import { getAllNavigationItemKeys } from "../access-control";
import type { UserRole } from "../navigation";

const EMPLOYEE_DEFAULT_ACCESS = [
  "/dashboard",
  "/announcements",
  "/time-off",
  "/expenses",
  "/scheduling",
  "/time-attendance",
  "/documents",
  "/me/pay",
  "/learning",
  "/performance",
  "/settings"
] as const;

const TEAM_LEAD_ADDITIONAL_ACCESS = [
  "/scheduling/manage",
  "/approvals"
] as const;

const MANAGER_ADDITIONAL_ACCESS = [
  "/people",
  "/onboarding"
] as const;

const HR_ADMIN_ADDITIONAL_ACCESS = [
  "/analytics",
  "/compliance",
  "/admin/users",
  "/admin/compensation",
  "/admin/payment-details",
  "/expenses/reports"
] as const;

const FINANCE_ADMIN_ADDITIONAL_ACCESS = [
  "/analytics",
  "/payroll",
  "/compliance",
  "/approvals",
  "/admin/users",
  "/admin/compensation",
  "/admin/payment-details",
  "/expenses/reports"
] as const;

export const DEFAULT_ROLE_ACCESS: Record<UserRole, string[]> = {
  EMPLOYEE: [...EMPLOYEE_DEFAULT_ACCESS],
  TEAM_LEAD: [...EMPLOYEE_DEFAULT_ACCESS, ...TEAM_LEAD_ADDITIONAL_ACCESS],
  MANAGER: [
    ...EMPLOYEE_DEFAULT_ACCESS,
    ...TEAM_LEAD_ADDITIONAL_ACCESS,
    ...MANAGER_ADDITIONAL_ACCESS
  ],
  HR_ADMIN: [
    ...EMPLOYEE_DEFAULT_ACCESS,
    ...TEAM_LEAD_ADDITIONAL_ACCESS,
    ...MANAGER_ADDITIONAL_ACCESS,
    ...HR_ADMIN_ADDITIONAL_ACCESS
  ],
  FINANCE_ADMIN: [...EMPLOYEE_DEFAULT_ACCESS, ...FINANCE_ADMIN_ADDITIONAL_ACCESS],
  SUPER_ADMIN: ["*"]
};

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function normalizeNavItemKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function normalizeNavItemKeyList(values: readonly string[]): string[] {
  return dedupeStrings(values.map(normalizeNavItemKey).filter((value) => value.length > 0));
}

export function resolveDefaultAccessForRoles(userRoles: readonly UserRole[]): string[] {
  if (userRoles.includes("SUPER_ADMIN")) {
    return getAllNavigationItemKeys();
  }

  const roleDefaults = userRoles.flatMap((role) => DEFAULT_ROLE_ACCESS[role] ?? []);
  return normalizeNavItemKeyList(roleDefaults.filter((value) => value !== "*"));
}

export type AccessOverrides = {
  granted: string[];
  revoked: string[];
};

export function normalizeAccessOverrides(value: unknown): AccessOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { granted: [], revoked: [] };
  }

  const rawValue = value as {
    granted?: unknown;
    revoked?: unknown;
  };

  const granted = Array.isArray(rawValue.granted)
    ? normalizeNavItemKeyList(rawValue.granted.filter((item): item is string => typeof item === "string"))
    : [];
  const revoked = Array.isArray(rawValue.revoked)
    ? normalizeNavItemKeyList(rawValue.revoked.filter((item): item is string => typeof item === "string"))
    : [];

  return { granted, revoked };
}

export function buildAccessOverridesFromSelected({
  selectedNavItemKeys,
  defaultNavItemKeys
}: {
  selectedNavItemKeys: readonly string[];
  defaultNavItemKeys: readonly string[];
}): AccessOverrides {
  const selected = new Set(normalizeNavItemKeyList(selectedNavItemKeys));
  const defaults = new Set(normalizeNavItemKeyList(defaultNavItemKeys));

  const granted: string[] = [];
  const revoked: string[] = [];

  for (const navItemKey of selected) {
    if (!defaults.has(navItemKey)) {
      granted.push(navItemKey);
    }
  }

  for (const navItemKey of defaults) {
    if (!selected.has(navItemKey)) {
      revoked.push(navItemKey);
    }
  }

  return {
    granted: normalizeNavItemKeyList(granted),
    revoked: normalizeNavItemKeyList(revoked)
  };
}
