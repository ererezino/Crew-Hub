import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import type { UserRole } from "../../../lib/navigation";
import { hasRole } from "../../../lib/roles";
import { PeopleClient } from "./people-client";
import { PeopleTabsClient } from "./people-tabs-client";

type PeopleScope = "all" | "reports" | "me";

type PeoplePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

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

function resolveRequestedTab(searchParams: Record<string, string | string[] | undefined>): string {
  const rawTab = searchParams.tab;
  if (typeof rawTab !== "string") {
    return "directory";
  }
  return rawTab;
}

export default async function PeoplePage({ searchParams }: PeoplePageProps) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    const t = await getTranslations('common');
    const tNav = await getTranslations('nav');
    return (
      <>
        <PageHeader title={tNav('people')} description={tNav('description.people')} />
        <EmptyState
          title={t('emptyState.profileUnavailable')}
          description={t('emptyState.profileUnavailableBody')}
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
  const isSuperAdmin = hasRole(roles, "SUPER_ADMIN");
  const scope = resolveScope(roles);

  // Super Admins get the tabbed view with org chart access
  if (isSuperAdmin) {
    const resolvedSearchParams = await searchParams;
    const requestedTab = resolveRequestedTab(resolvedSearchParams);

    return (
      <PeopleTabsClient
        requestedTab={requestedTab}
        userRoles={roles}
        currentUserId={session.profile.id}
        initialScope={scope}
        canCreatePeople={canCreatePeople}
        canInvitePeople={canInvitePeople}
        canEditPeople={canEditPeople}
        canResetAuthenticator={canResetAuthenticator}
        isAdmin={isAdmin}
        isSuperAdmin={isSuperAdmin}
      />
    );
  }

  // Non-Super-Admins get the existing directory view without tabs
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
