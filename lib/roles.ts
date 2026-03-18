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
    hasRole(userRoles, "FINANCE_APPROVER") ||
    hasRole(userRoles, "SUPER_ADMIN")
  );
}

/**
 * Returns true if the user holds any finance-operator role (FINANCE_ADMIN or FINANCE_APPROVER).
 * Use this for gating access to finance surfaces (payroll, compensation, payment details).
 */
export function hasFinanceRole(userRoles: readonly UserRole[]): boolean {
  return hasRole(userRoles, "FINANCE_ADMIN") || hasRole(userRoles, "FINANCE_APPROVER");
}

/**
 * Returns true if the user can approve payroll batches and salary changes.
 * Only FINANCE_APPROVER (CFO) and SUPER_ADMIN hold this authority.
 */
export function canApprovePayroll(userRoles: readonly UserRole[]): boolean {
  return hasRole(userRoles, "FINANCE_APPROVER") || hasRole(userRoles, "SUPER_ADMIN");
}

export function isDepartmentOnlyTeamLead(userRoles: readonly UserRole[]): boolean {
  if (!hasRole(userRoles, "TEAM_LEAD")) {
    return false;
  }

  return !hasAnyRole(userRoles, ["MANAGER", "HR_ADMIN", "FINANCE_ADMIN", "FINANCE_APPROVER", "SUPER_ADMIN"]);
}
