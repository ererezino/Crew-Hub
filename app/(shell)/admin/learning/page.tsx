import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasRole } from "../../../../lib/roles";
import { LearningAdminClient } from "./learning-admin-client";

export default async function LearningAdminPage() {
  const session = await getAuthenticatedSession();
  const tPage = await getTranslations("learningPage");
  const tCommon = await getTranslations("common");

  if (!session?.profile) {
    return (
      <EmptyState
        title={tCommon("emptyState.profileUnavailable")}
        description={tCommon("emptyState.profileUnavailableBody")}
      />
    );
  }

  const canManageLearning =
    hasRole(session.profile.roles, "HR_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  if (!canManageLearning) {
    return (
      <EmptyState
        title={tPage("adminRestricted")}
        description={tPage("adminRestrictedBody")}
        ctaLabel={tPage("openLearning")}
        ctaHref="/learning"
      />
    );
  }

  return <LearningAdminClient />;
}
