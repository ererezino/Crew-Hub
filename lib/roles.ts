import type { UserRole } from "./navigation";

export function hasRole(userRoles: readonly UserRole[], role: UserRole): boolean {
  return userRoles.includes(role);
}

export function isAdminUser(userRoles: readonly UserRole[]): boolean {
  return (
    hasRole(userRoles, "HR_ADMIN") ||
    hasRole(userRoles, "FINANCE_ADMIN") ||
    hasRole(userRoles, "SUPER_ADMIN")
  );
}
