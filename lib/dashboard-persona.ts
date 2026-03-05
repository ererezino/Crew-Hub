import type { UserRole } from "./navigation";
import { hasRole } from "./roles";

export type DashboardPersona =
  | "new_hire"
  | "employee"
  | "manager"
  | "hr_admin"
  | "finance_admin"
  | "super_admin";

export type PersonaProfile = {
  roles: readonly UserRole[];
  startDate: string | null;
};

export type PersonaOnboardingInstance = {
  status: string;
};

/**
 * Determines the dashboard persona for a user.
 *
 * Called once, server-side, in the dashboard API handler.
 * This is the single source of truth for all dashboard rendering decisions.
 *
 * Priority:
 * 1. SUPER_ADMIN role → super_admin
 * 2. FINANCE_ADMIN role → finance_admin
 * 3. HR_ADMIN role → hr_admin
 * 4. MANAGER or TEAM_LEAD role → manager
 * 5. start_date within last 30 days AND active onboarding → new_hire
 * 6. Otherwise → employee
 */
export function getDashboardPersona(
  profile: PersonaProfile,
  onboardingInstance: PersonaOnboardingInstance | null
): DashboardPersona {
  if (hasRole(profile.roles, "SUPER_ADMIN")) return "super_admin";
  if (hasRole(profile.roles, "FINANCE_ADMIN")) return "finance_admin";
  if (hasRole(profile.roles, "HR_ADMIN")) return "hr_admin";
  if (hasRole(profile.roles, "MANAGER") || hasRole(profile.roles, "TEAM_LEAD"))
    return "manager";

  if (
    profile.startDate &&
    onboardingInstance &&
    onboardingInstance.status === "active"
  ) {
    const startDate = new Date(profile.startDate);
    const now = new Date();
    const thirtyDaysAgo = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 30
    );

    if (startDate >= thirtyDaysAgo) {
      return "new_hire";
    }
  }

  return "employee";
}
