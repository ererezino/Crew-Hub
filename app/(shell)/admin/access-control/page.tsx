import { EmptyState } from "../../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasRole } from "../../../../lib/roles";
import { AccessControlAdminClient } from "./access-control-admin-client";

export default async function AccessControlPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <EmptyState
        title="Profile is unavailable"
        description="No profile is linked to this account yet."
      />
    );
  }

  if (!hasRole(session.profile.roles, "SUPER_ADMIN")) {
    return (
      <EmptyState
        title="Access control is restricted"
        description="Only Super Admin can update navigation and dashboard visibility rules."
      />
    );
  }

  return <AccessControlAdminClient />;
}
