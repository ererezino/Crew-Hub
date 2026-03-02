import type { UserRole } from "./navigation";

export function hasRole(userRoles: readonly UserRole[], role: UserRole): boolean {
  return userRoles.includes(role);
}

export function hasAnyRole(
  userRoles: readonly UserRole[],
  roles: readonly UserRole[]
): boolean {
  return roles.some((role) => hasRole(userRoles, role));
}

export function isSuperAdminUser(userRoles: readonly UserRole[]): boolean {
  return hasRole(userRoles, "SUPER_ADMIN");
}

export function isAdminUser(userRoles: readonly UserRole[]): boolean {
  return (
    hasRole(userRoles, "HR_ADMIN") ||
    hasRole(userRoles, "FINANCE_ADMIN") ||
    hasRole(userRoles, "SUPER_ADMIN")
  );
}

export function isDepartmentScopedTeamLead(userRoles: readonly UserRole[]): boolean {
  if (!hasRole(userRoles, "TEAM_LEAD")) {
    return false;
  }

  return !hasAnyRole(userRoles, ["MANAGER", "HR_ADMIN", "FINANCE_ADMIN", "SUPER_ADMIN"]);
}
