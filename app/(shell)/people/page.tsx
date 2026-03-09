import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import type { UserRole } from "../../../lib/navigation";
import { hasRole } from "../../../lib/roles";
import { PeopleClient } from "./people-client";

type PeopleScope = "all" | "reports" | "me";

function resolveScope(roles: readonly UserRole[]): PeopleScope {
  if (
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  ) {
    return "all";
  }

  if (hasRole(roles, "MANAGER") || hasRole(roles, "TEAM_LEAD")) {
    return "reports";
  }

  return "me";
}

export default async function PeoplePage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader title="Crew Members" description="Find teammates, review roles, and open full profiles." />
        <EmptyState
          title="Profile is unavailable"
          description="No profile is linked to this account yet."
        />
      </>
    );
  }

  const roles = session.profile.roles;
  const canCreatePeople = hasRole(roles, "SUPER_ADMIN");
  const canInvitePeople = hasRole(roles, "SUPER_ADMIN") || hasRole(roles, "HR_ADMIN");
  const canEditPeople = hasRole(roles, "SUPER_ADMIN") || hasRole(roles, "HR_ADMIN");
  const canResetAuthenticator = hasRole(roles, "SUPER_ADMIN");
  const isAdmin = hasRole(roles, "HR_ADMIN") || hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "SUPER_ADMIN");
  const scope = resolveScope(roles);

  return (
    <PeopleClient
      currentUserId={session.profile.id}
      initialScope={scope}
      canCreatePeople={canCreatePeople}
      canInvitePeople={canInvitePeople}
      canEditPeople={canEditPeople}
      canResetAuthenticator={canResetAuthenticator}
      isAdmin={isAdmin}
    />
  );
}
