import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { hasRole } from "../../../lib/roles";
import { SchedulingTabsClient } from "./scheduling-tabs-client";

type SchedulingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function resolveRequestedTab(searchParams: Record<string, string | string[] | undefined>): string {
  const rawTab = searchParams.tab;

  if (typeof rawTab !== "string") {
    return "my-shifts";
  }

  return rawTab;
}

const CS_DEPARTMENT = "Customer Success";

export default async function SchedulingPage({ searchParams }: SchedulingPageProps) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <EmptyState
        title="Profile is unavailable"
        description="No profile is linked to this account yet."
      />
    );
  }

  const isSuperAdmin = hasRole(session.profile.roles, "SUPER_ADMIN");
  const isCSTeam = session.profile.department === CS_DEPARTMENT;

  if (!isSuperAdmin && !isCSTeam) {
    return (
      <>
        <PageHeader
          title="Schedule"
          description="Build, publish, and manage team shift schedules."
        />
        <EmptyState
          title="Scheduling is for Customer Success"
          description="Scheduling is available for Customer Success crew. If you believe you should have access, contact your manager."
        />
      </>
    );
  }

  const resolvedSearchParams = await searchParams;

  return (
    <SchedulingTabsClient
      requestedTab={resolveRequestedTab(resolvedSearchParams)}
      userRoles={session.profile.roles}
      userDepartment={session.profile.department}
      currentUserId={session.profile.id}
    />
  );
}
