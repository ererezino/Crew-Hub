import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { checkPageAccess, checkPageAccessForProfile } from "../../../lib/auth/check-page-access";
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

export default async function SchedulingPage({ searchParams }: SchedulingPageProps) {
  const t = await getTranslations("scheduling");
  const { allowed, profile } = await checkPageAccess("/scheduling");

  if (!profile) {
    return (
      <EmptyState
        title={t("profileUnavailable")}
        description={t("profileUnavailableBody")}
      />
    );
  }

  if (!allowed) {
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

  const [resolvedSearchParams, canManageSchedules] = await Promise.all([
    searchParams,
    checkPageAccessForProfile("/scheduling/manage", profile)
  ]);

  return (
    <SchedulingTabsClient
      requestedTab={resolveRequestedTab(resolvedSearchParams)}
      requestedScheduleId={resolveRequestedScheduleId(resolvedSearchParams)}
      userRoles={profile.roles}
      userDepartment={profile.department}
      currentUserId={profile.id}
      canManageSchedules={canManageSchedules}
    />
  );
}
