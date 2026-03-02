import { NAV_GROUPS, USER_ROLES, type UserRole } from "./navigation";
import { hasRole } from "./roles";

export const DASHBOARD_WIDGET_KEYS = [
  "hero_metrics",
  "primary_chart",
  "expense_widget",
  "compliance_widget",
  "secondary_panels"
] as const;

export type DashboardWidgetKey = (typeof DASHBOARD_WIDGET_KEYS)[number];

export type NavigationDefinition = {
  key: string;
  label: string;
  description: string;
  groupLabel: string;
};

export const DASHBOARD_WIDGET_DEFINITIONS: ReadonlyArray<{
  key: DashboardWidgetKey;
  label: string;
  description: string;
}> = [
  {
    key: "hero_metrics",
    label: "Hero Metrics",
    description: "Top KPI cards shown at the top of the dashboard."
  },
  {
    key: "primary_chart",
    label: "Primary Chart",
    description: "Main trend chart in the dashboard body."
  },
  {
    key: "expense_widget",
    label: "Expense Widget",
    description: "Pending expense widget and quick finance context."
  },
  {
    key: "compliance_widget",
    label: "Compliance Widget",
    description: "Overdue compliance summary panel."
  },
  {
    key: "secondary_panels",
    label: "Secondary Panels",
    description: "Department/category breakdown side panels."
  }
] as const;

const ALL_ROLES = USER_ROLES as readonly UserRole[];
const ADMIN_ROLES: readonly UserRole[] = ["HR_ADMIN", "FINANCE_ADMIN", "SUPER_ADMIN"];
const SUPER_ONLY: readonly UserRole[] = ["SUPER_ADMIN"];
const SCHEDULING_ROLES: readonly UserRole[] = [
  "EMPLOYEE",
  "MANAGER",
  "TEAM_LEAD",
  "HR_ADMIN",
  "SUPER_ADMIN"
];
const SCHEDULING_MANAGE_ROLES: readonly UserRole[] = [
  "MANAGER",
  "TEAM_LEAD",
  "HR_ADMIN",
  "SUPER_ADMIN"
];
const ATTENDANCE_APPROVAL_ROLES: readonly UserRole[] = [
  "MANAGER",
  "TEAM_LEAD",
  "HR_ADMIN",
  "FINANCE_ADMIN",
  "SUPER_ADMIN"
];

const DEFAULT_NAV_ROLE_OVERRIDES: Readonly<Record<string, readonly UserRole[]>> = {
  "/analytics": ["HR_ADMIN", "FINANCE_ADMIN", "SUPER_ADMIN"],
  "/compliance": ["HR_ADMIN", "FINANCE_ADMIN", "SUPER_ADMIN"],
  "/payroll": ["FINANCE_ADMIN", "SUPER_ADMIN"],
  "/payroll/settings/deductions": ["FINANCE_ADMIN", "SUPER_ADMIN"],
  "/payroll/runs/new": ["FINANCE_ADMIN", "SUPER_ADMIN"],
  "/admin/compensation": ["HR_ADMIN", "FINANCE_ADMIN", "SUPER_ADMIN"],
  "/admin/compensation-bands": ["HR_ADMIN", "FINANCE_ADMIN", "SUPER_ADMIN"],
  "/performance/admin": ["HR_ADMIN", "SUPER_ADMIN"],
  "/admin/time-policies": ["HR_ADMIN", "SUPER_ADMIN"],
  "/admin/access-control": ["SUPER_ADMIN"],
  "/scheduling": SCHEDULING_ROLES,
  "/scheduling/open-shifts": SCHEDULING_ROLES,
  "/scheduling/swaps": SCHEDULING_ROLES,
  "/scheduling/manage": SCHEDULING_MANAGE_ROLES,
  "/admin/scheduling/templates": SCHEDULING_MANAGE_ROLES,
  "/time-attendance": SCHEDULING_ROLES,
  "/time-attendance/approvals": ATTENDANCE_APPROVAL_ROLES
};

const DEFAULT_WIDGET_ROLE_OVERRIDES: Readonly<
  Record<DashboardWidgetKey, readonly UserRole[]>
> = {
  hero_metrics: ALL_ROLES,
  primary_chart: ALL_ROLES,
  expense_widget: ALL_ROLES,
  compliance_widget: ["HR_ADMIN", "FINANCE_ADMIN", "SUPER_ADMIN"],
  secondary_panels: ALL_ROLES
};

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function getNavigationDefinitions(): NavigationDefinition[] {
  return NAV_GROUPS.flatMap((group) =>
    group.items.map((item) => ({
      key: item.href,
      label: item.label,
      description: item.description,
      groupLabel: group.label
    }))
  );
}

export function getAllNavigationItemKeys(): string[] {
  return uniqueStrings(getNavigationDefinitions().map((item) => item.key));
}

export function getDefaultVisibleRolesForNavItem(navItemKey: string): UserRole[] {
  const override = DEFAULT_NAV_ROLE_OVERRIDES[navItemKey];

  if (override) {
    return [...override];
  }

  if (navItemKey.startsWith("/admin/")) {
    return [...ADMIN_ROLES];
  }

  return [...ALL_ROLES];
}

export function getDefaultVisibleRolesForWidget(widgetKey: DashboardWidgetKey): UserRole[] {
  return [...DEFAULT_WIDGET_ROLE_OVERRIDES[widgetKey]];
}

export function getAllDashboardWidgetKeys(): DashboardWidgetKey[] {
  return [...DASHBOARD_WIDGET_KEYS];
}

export function roleIntersection(
  lhs: readonly UserRole[],
  rhs: readonly UserRole[]
): UserRole[] {
  return lhs.filter((role): role is UserRole => rhs.includes(role));
}

function normalizeIdArray(values: readonly string[] | null | undefined): string[] {
  if (!values) {
    return [];
  }

  return uniqueStrings(
    values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  );
}

function isRoleVisible(
  userRoles: readonly UserRole[],
  visibleToRoles: readonly UserRole[]
): boolean {
  return visibleToRoles.some((role) => hasRole(userRoles, role));
}

export function isNavItemVisibleForUser({
  userId,
  userRoles,
  visibleToRoles,
  grantedEmployeeIds,
  revokedEmployeeIds
}: {
  userId: string;
  userRoles: readonly UserRole[];
  visibleToRoles: readonly UserRole[];
  grantedEmployeeIds?: readonly string[] | null;
  revokedEmployeeIds?: readonly string[] | null;
}): boolean {
  if (hasRole(userRoles, "SUPER_ADMIN")) {
    return true;
  }

  const granted = normalizeIdArray(grantedEmployeeIds).includes(userId);
  const revoked = normalizeIdArray(revokedEmployeeIds).includes(userId);

  if (revoked) {
    return false;
  }

  return isRoleVisible(userRoles, visibleToRoles) || granted;
}

export function isWidgetVisibleForUser({
  userRoles,
  visibleToRoles
}: {
  userRoles: readonly UserRole[];
  visibleToRoles: readonly UserRole[];
}): boolean {
  if (hasRole(userRoles, "SUPER_ADMIN")) {
    return true;
  }

  return isRoleVisible(userRoles, visibleToRoles);
}

export function isSuperAdmin(userRoles: readonly UserRole[]): boolean {
  return hasRole(userRoles, "SUPER_ADMIN");
}

export function defaultNavVisibilityForRoles(userRoles: readonly UserRole[]): string[] {
  if (hasRole(userRoles, "SUPER_ADMIN")) {
    return getAllNavigationItemKeys();
  }

  return getAllNavigationItemKeys().filter((key) => {
    const visibleToRoles = getDefaultVisibleRolesForNavItem(key);
    return visibleToRoles.some((role) => hasRole(userRoles, role));
  });
}

export function defaultWidgetVisibilityForRoles(
  userRoles: readonly UserRole[]
): DashboardWidgetKey[] {
  if (hasRole(userRoles, "SUPER_ADMIN")) {
    return getAllDashboardWidgetKeys();
  }

  return DASHBOARD_WIDGET_KEYS.filter((widgetKey) => {
    const visibleToRoles = getDefaultVisibleRolesForWidget(widgetKey);
    return visibleToRoles.some((role) => hasRole(userRoles, role));
  });
}

export type NavigationAccessConfigPayload = {
  navItemKey: string;
  visibleToRoles: UserRole[];
  grantedEmployeeIds: string[];
  revokedEmployeeIds: string[];
};

export type DashboardWidgetConfigPayload = {
  widgetKey: DashboardWidgetKey;
  visibleToRoles: UserRole[];
};

export function sanitizeRoles(inputRoles: readonly string[]): UserRole[] {
  return uniqueStrings(inputRoles)
    .map((role) => role.trim())
    .filter((role): role is UserRole => USER_ROLES.includes(role as UserRole));
}

export function ensureValidVisibleRoles(
  roles: readonly string[],
  fallback: readonly UserRole[]
): UserRole[] {
  const parsedRoles = sanitizeRoles(roles);
  return parsedRoles.length > 0 ? parsedRoles : [...fallback];
}

export function normalizeNavigationPayload(
  values: readonly NavigationAccessConfigPayload[]
): NavigationAccessConfigPayload[] {
  const byKey = new Map<string, NavigationAccessConfigPayload>();

  for (const value of values) {
    const key = value.navItemKey.trim();
    if (key.length === 0) {
      continue;
    }

    byKey.set(key, {
      navItemKey: key,
      visibleToRoles: ensureValidVisibleRoles(
        value.visibleToRoles,
        getDefaultVisibleRolesForNavItem(key)
      ),
      grantedEmployeeIds: normalizeIdArray(value.grantedEmployeeIds),
      revokedEmployeeIds: normalizeIdArray(value.revokedEmployeeIds)
    });
  }

  return [...byKey.values()];
}

export function normalizeWidgetPayload(
  values: readonly DashboardWidgetConfigPayload[]
): DashboardWidgetConfigPayload[] {
  const byKey = new Map<DashboardWidgetKey, DashboardWidgetConfigPayload>();

  for (const value of values) {
    const key = value.widgetKey;

    if (!DASHBOARD_WIDGET_KEYS.includes(key)) {
      continue;
    }

    byKey.set(key, {
      widgetKey: key,
      visibleToRoles: ensureValidVisibleRoles(
        value.visibleToRoles,
        getDefaultVisibleRolesForWidget(key)
      )
    });
  }

  for (const widgetKey of DASHBOARD_WIDGET_KEYS) {
    if (!byKey.has(widgetKey)) {
      byKey.set(widgetKey, {
        widgetKey,
        visibleToRoles: getDefaultVisibleRolesForWidget(widgetKey)
      });
    }
  }

  return [...byKey.values()];
}

export function defaultNavigationConfigPayload(): NavigationAccessConfigPayload[] {
  return getAllNavigationItemKeys().map((navItemKey) => ({
    navItemKey,
    visibleToRoles: getDefaultVisibleRolesForNavItem(navItemKey),
    grantedEmployeeIds: [],
    revokedEmployeeIds: []
  }));
}

export function defaultWidgetConfigPayload(): DashboardWidgetConfigPayload[] {
  return DASHBOARD_WIDGET_KEYS.map((widgetKey) => ({
    widgetKey,
    visibleToRoles: getDefaultVisibleRolesForWidget(widgetKey)
  }));
}

export function getRoleLabel(role: UserRole): string {
  if (role === "SUPER_ADMIN") return "Super Admin";
  if (role === "FINANCE_ADMIN") return "Finance Admin";
  if (role === "HR_ADMIN") return "HR Admin";
  if (role === "TEAM_LEAD") return "Team Lead";
  if (role === "MANAGER") return "Manager";
  return "Employee";
}

export function getNonSuperAdminRoles(): UserRole[] {
  return USER_ROLES.filter((role) => role !== "SUPER_ADMIN");
}

export function getSuperOnlyRoles(): UserRole[] {
  return [...SUPER_ONLY];
}
