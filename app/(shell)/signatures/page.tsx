import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { hasRole } from "../../../lib/roles";
import { SignaturesClient } from "./signatures-client";

export default async function SignaturesPage() {
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

  const canManageSignatures =
    hasRole(session.profile.roles, "HR_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  return (
    <SignaturesClient
      currentUserId={session.profile.id}
      canManageSignatures={canManageSignatures}
    />
  );
}
