import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../components/shared/empty-state";
import { checkPageAccess } from "../../../lib/auth/check-page-access";
import { hasRole } from "../../../lib/roles";
import { OnboardingClient } from "./onboarding-client";

export default async function OnboardingPage() {
  const { allowed, profile } = await checkPageAccess("/onboarding");

  if (!profile) {
    const t = await getTranslations('common');
    return (
      <EmptyState
        title={t('emptyState.profileUnavailable')}
        description={t('emptyState.profileUnavailableBody')}
      />
    );
  }

  if (!allowed) {
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

  const userRoles = profile.roles;
  const canViewAll = hasRole(userRoles, "HR_ADMIN") || hasRole(userRoles, "SUPER_ADMIN");

  return (
    <OnboardingClient
      instanceScope={canViewAll ? "all" : "reports"}
      canViewTemplates={canViewAll}
      canManageOnboarding={canViewAll}
    />
  );
}
