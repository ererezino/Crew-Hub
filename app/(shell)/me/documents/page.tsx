import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasRole } from "../../../../lib/roles";
import { MyDocumentsClient } from "./my-documents-client";

export default async function MyDocumentsPage() {
  const session = await getAuthenticatedSession();
  const tCommon = await getTranslations("common");

  if (!session?.profile) {
    return (
      <EmptyState
        title={tCommon("emptyState.profileUnavailable")}
        description={tCommon("emptyState.profileUnavailableBody")}
      />
    );
  }

  const isSuperAdmin = hasRole(session.profile.roles, "SUPER_ADMIN");
  const isHrAdmin = hasRole(session.profile.roles, "HR_ADMIN");

  return (
    <MyDocumentsClient
      currentUserId={session.profile.id}
      isSuperAdmin={isSuperAdmin}
      isHrAdmin={isHrAdmin}
    />
  );
}
