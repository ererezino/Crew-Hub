import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../components/shared/empty-state";
import { checkPageAccess } from "../../../lib/auth/check-page-access";
import { hasRole } from "../../../lib/roles";
import { SignaturesClient } from "./signatures-client";

export default async function SignaturesPage() {
  const { allowed, profile } = await checkPageAccess("/signatures");

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
    const t = await getTranslations('common');
    const tNav = await getTranslations('nav');
    return (
      <EmptyState
        title={t('emptyState.accessDenied')}
        description={tNav('description.signatures')}
      />
    );
  }

  const canManageSignatures =
    hasRole(profile.roles, "HR_ADMIN") ||
    hasRole(profile.roles, "SUPER_ADMIN");

  return (
    <SignaturesClient
      currentUserId={profile.id}
      canManageSignatures={canManageSignatures}
    />
  );
}
