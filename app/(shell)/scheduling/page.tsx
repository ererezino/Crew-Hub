import { getTranslations } from "next-intl/server";

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

function resolveRequestedScheduleId(searchParams: Record<string, string | string[] | undefined>): string | null {
  const rawScheduleId = searchParams.scheduleId;

  if (typeof rawScheduleId !== "string" || rawScheduleId.length === 0) {
    return null;
  }

  return rawScheduleId;
}

const CS_DEPARTMENT = "Customer Success";

export default async function SchedulingPage({ searchParams }: SchedulingPageProps) {
  const session = await getAuthenticatedSession();
  const t = await getTranslations("scheduling");

  if (!session?.profile) {
    return (
      <EmptyState
        title={t("profileUnavailable")}
        description={t("profileUnavailableBody")}
      />
    );
  }

  const isSuperAdmin = hasRole(session.profile.roles, "SUPER_ADMIN");
  const isCSTeam = session.profile.department === CS_DEPARTMENT;

  if (!isSuperAdmin && !isCSTeam) {
    return (
      <>
        <PageHeader
          title={t("pageTitle")}
          description={t("pageDescription")}
        />
        <EmptyState
          title={t("accessDeniedTitle")}
          description={t("accessDeniedBody")}
        />
      </>
    );
  }

  const resolvedSearchParams = await searchParams;

  return (
    <SchedulingTabsClient
      requestedTab={resolveRequestedTab(resolvedSearchParams)}
      requestedScheduleId={resolveRequestedScheduleId(resolvedSearchParams)}
      userRoles={session.profile.roles}
      userDepartment={session.profile.department}
      currentUserId={session.profile.id}
    />
  );
}
