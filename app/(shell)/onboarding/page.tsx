import { EmptyState } from "../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { hasRole } from "../../../lib/roles";
import { OnboardingClient } from "./onboarding-client";

export default async function OnboardingPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <EmptyState
        title="Profile is unavailable"
        description="No profile is linked to this account yet."
        ctaLabel="Back to dashboard"
        ctaHref="/dashboard"
      />
    );
  }

  const userRoles = session.profile.roles;
  const canViewAll = hasRole(userRoles, "HR_ADMIN") || hasRole(userRoles, "SUPER_ADMIN");
  const canViewReports =
    canViewAll || hasRole(userRoles, "MANAGER");

  if (!canViewReports) {
    return (
      <EmptyState
        title="Onboarding dashboard is limited to managers and admins"
        description="Open your personal onboarding page to view your assigned tasks."
        ctaLabel="Open my onboarding"
        ctaHref="/me/onboarding"
      />
    );
  }

  return (
    <OnboardingClient
      instanceScope={canViewAll ? "all" : "reports"}
      canViewTemplates={canViewAll}
    />
  );
}
