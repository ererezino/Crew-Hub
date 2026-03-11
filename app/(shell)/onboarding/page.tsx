import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { hasRole } from "../../../lib/roles";
import { OnboardingClient } from "./onboarding-client";

export default async function OnboardingPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    const t = await getTranslations('common');
    return (
      <EmptyState
        title={t('emptyState.profileUnavailable')}
        description={t('emptyState.profileUnavailableBody')}
      />
    );
  }

  const userRoles = session.profile.roles;
  const canViewAll = hasRole(userRoles, "HR_ADMIN") || hasRole(userRoles, "SUPER_ADMIN");
  const canViewReports =
    canViewAll || hasRole(userRoles, "MANAGER");

  if (!canViewReports) {
    const tOnboarding = await getTranslations('onboardingPage');
    return (
      <EmptyState
        title={tOnboarding('accessDenied')}
        description={tOnboarding('accessDeniedBody')}
        ctaLabel={tOnboarding('openMyOnboarding')}
        ctaHref="/me/onboarding"
      />
    );
  }

  return (
    <OnboardingClient
      instanceScope={canViewAll ? "all" : "reports"}
      canViewTemplates={canViewAll}
      canManageOnboarding={canViewAll}
    />
  );
}
