import { getTranslations } from "next-intl/server";

import { PageHeader } from "../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { hasRole } from "../../../lib/roles";
import { TheCrewClient } from "./the-crew-client";

export default async function TheCrewPage() {
  const session = await getAuthenticatedSession();
  const t = await getTranslations("theCrew");

  const currentUserId = session?.profile?.id ?? "";
  const roles = session?.profile?.roles ?? [];
  const isAdmin =
    hasRole(roles, "SUPER_ADMIN") || hasRole(roles, "HR_ADMIN");

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        description={t("pageSubtitle")}
      />
      <TheCrewClient
        currentUserId={currentUserId}
        isAdmin={isAdmin}
      />
    </>
  );
}
