import { getTranslations } from "next-intl/server";

import { getAuthenticatedSession } from "../../../lib/auth/session";
import { hasRole } from "../../../lib/roles";
import { TheCrewClient } from "./the-crew-client";

export default async function TheCrewPage() {
  const session = await getAuthenticatedSession();

  const currentUserId = session?.profile?.id ?? "";
  const roles = session?.profile?.roles ?? [];
  const isAdmin =
    hasRole(roles, "SUPER_ADMIN") || hasRole(roles, "HR_ADMIN");

  return (
    <TheCrewClient
      currentUserId={currentUserId}
      isAdmin={isAdmin}
    />
  );
}
