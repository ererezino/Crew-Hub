import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { checkPageAccess } from "../../../lib/auth/check-page-access";
import type { UserRole } from "../../../lib/navigation";
import { fetchPeopleData } from "../../../lib/people/fetch-people-data";
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
    hasRole(roles, "FINANCE_APPROVER") ||
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
  const { allowed, profile } = await checkPageAccess("/people");

  if (!profile) {
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

  if (!allowed) {
    const t = await getTranslations('common');
    const tNav = await getTranslations('nav');
    return (
      <>
        <PageHeader title={tNav('people')} description={tNav('description.people')} />
        <EmptyState
          title={t('emptyState.accessDenied')}
          description="You don't have access to the people directory. Contact your admin if you need access."
        />
      </>
    );
  }

  const roles = profile.roles;
  const canCreatePeople = hasRole(roles, "SUPER_ADMIN");
  const canInvitePeople = hasRole(roles, "SUPER_ADMIN") || hasRole(roles, "HR_ADMIN");
  const canEditPeople = hasRole(roles, "SUPER_ADMIN") || hasRole(roles, "HR_ADMIN");
  const canResetAuthenticator = hasRole(roles, "SUPER_ADMIN") || hasRole(roles, "HR_ADMIN");
  const isAdmin = hasRole(roles, "HR_ADMIN") || hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "FINANCE_APPROVER") || hasRole(roles, "SUPER_ADMIN");
  const isSuperAdmin = hasRole(roles, "SUPER_ADMIN");
  const scope = resolveScope(roles);

  // Server-fetch people data for the default scope so it's in the initial HTML.
  // If the fetch fails, render without initialData — the client will retry via API.
  let initialPeopleData;

  try {
    initialPeopleData = await fetchPeopleData(profile, { scope });
  } catch {
    // Graceful degradation: client will fetch on mount
  }

  // Super Admins get the tabbed view with org chart access
  if (isSuperAdmin) {
    const resolvedSearchParams = await searchParams;
    const requestedTab = resolveRequestedTab(resolvedSearchParams);

    return (
      <PeopleTabsClient
        requestedTab={requestedTab}
        userRoles={roles}
        currentUserId={profile.id}
        initialScope={scope}
        canCreatePeople={canCreatePeople}
        canInvitePeople={canInvitePeople}
        canEditPeople={canEditPeople}
        canResetAuthenticator={canResetAuthenticator}
        isAdmin={isAdmin}
        isSuperAdmin={isSuperAdmin}
        initialPeopleData={initialPeopleData}
      />
    );
  }

  // Non-Super-Admins get the existing directory view without tabs
  return (
    <PeopleClient
      currentUserId={profile.id}
      initialScope={scope}
      canCreatePeople={canCreatePeople}
      canInvitePeople={canInvitePeople}
      canEditPeople={canEditPeople}
      canResetAuthenticator={canResetAuthenticator}
      isAdmin={isAdmin}
      initialPeopleData={initialPeopleData}
    />
  );
}
