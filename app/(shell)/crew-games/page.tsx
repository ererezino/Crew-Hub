import { getAuthenticatedSession } from "../../../lib/auth/session";
import { hasAnyRole } from "../../../lib/roles";
import { CrewGamesClient } from "./crew-games-client";

export default async function CrewGamesPage() {
  const session = await getAuthenticatedSession();

  const currentUserId = session?.profile?.id ?? "";
  const orgId = session?.profile?.org_id ?? "";
  const roles = session?.profile?.roles ?? [];
  const isAdmin = hasAnyRole(roles, ["HR_ADMIN", "SUPER_ADMIN"]);

  return (
    <CrewGamesClient
      currentUserId={currentUserId}
      orgId={orgId}
      userRoles={roles}
      isAdmin={isAdmin}
    />
  );
}
