import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { checkPageAccess } from "../../../../lib/auth/check-page-access";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import type { UserRole } from "../../../../lib/navigation";
import { hasRole } from "../../../../lib/roles";
import { PeopleCompensationClient } from "./people-compensation-client";
import { PeopleOverviewClient } from "./people-overview-client";

type PeopleProfilePageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type PeopleTab = "overview" | "compensation";

const profileIdSchema = z.string().uuid();

function resolveTab(searchParams: Record<string, string | string[] | undefined>): PeopleTab {
  const rawTab = searchParams.tab;

  if (rawTab === "compensation") {
    return "compensation";
  }

  return "overview";
}

function canViewCompensation(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "FINANCE_APPROVER") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

export default async function PeopleProfilePage({
  params,
  searchParams
}: PeopleProfilePageProps) {
  const session = await getAuthenticatedSession();
  const t = await getTranslations("peoplePage");
  const tPeople = await getTranslations("people");
  const tCommon = await getTranslations("common");

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title={tPeople("pageTitle")}
          description={tPeople("pageDescription")}
        />
        <EmptyState
          title={tCommon("emptyState.profileUnavailable")}
          description={tCommon("emptyState.profileUnavailableBody")}
        />
      </>
    );
  }

  const { id } = await params;
  const parsedId = profileIdSchema.safeParse(id);

  if (!parsedId.success) {
    return (
      <>
        <PageHeader
          title={tPeople("pageTitle")}
          description={tPeople("pageDescription")}
        />
        <EmptyState
          title={t("invalidProfileId")}
          description={t("invalidProfileIdDescription")}
          ctaLabel={t("backToCrew")}
          ctaHref="/people"
        />
      </>
    );
  }

  const profile = session.profile;
  const isSelf = parsedId.data === profile.id;

  // Managers/Team Leads can always view individual profiles (for direct reports).
  // Finance roles can view individual profiles (for compensation/payment review).
  // Other roles need People module access via access config.
  // Self-view is always allowed.
  const isManagerOrLead =
    hasRole(profile.roles, "MANAGER") || hasRole(profile.roles, "TEAM_LEAD");
  const hasFinanceAccess = canViewCompensation(profile.roles);

  let hasPeopleAccess = isSelf || isManagerOrLead || hasFinanceAccess;

  if (!hasPeopleAccess) {
    const { allowed } = await checkPageAccess("/people");
    hasPeopleAccess = allowed;
  }

  if (!hasPeopleAccess) {
    return (
      <>
        <PageHeader
          title={tPeople("pageTitle")}
          description={tPeople("pageDescription")}
        />
        <EmptyState
          title={tCommon("emptyState.accessDenied")}
          description={t("accessDeniedDescription")}
        />
      </>
    );
  }

  const resolvedSearchParams = await searchParams;
  const requestedTab = resolveTab(resolvedSearchParams);
  const hasCompensationAccess = canViewCompensation(profile.roles) || isSelf;
  const activeTab: PeopleTab = hasCompensationAccess ? requestedTab : "overview";

  return (
    <>
      <PageHeader
        title={tPeople("pageTitle")}
        description={tPeople("pageDescription")}
      />

      <section className="page-tabs" role="tablist" aria-label={t("profileTabsAriaLabel")}>
        <Link
          href={`/people/${parsedId.data}?tab=overview`}
          className={
            activeTab === "overview"
              ? "page-tab page-tab-active"
              : "page-tab"
          }
          role="tab"
          aria-selected={activeTab === "overview"}
        >
          {t("overviewTab")}
        </Link>
        {hasCompensationAccess ? (
          <Link
            href={`/people/${parsedId.data}?tab=compensation`}
            className={
              activeTab === "compensation"
                ? "page-tab page-tab-active"
                : "page-tab"
            }
            role="tab"
            aria-selected={activeTab === "compensation"}
          >
            {t("compensationTab")}
          </Link>
        ) : null}
      </section>

      {activeTab === "overview" ? (
        <PeopleOverviewClient
          employeeId={parsedId.data}
          isSelf={isSelf}
          canSeePrivateFields={
            hasRole(profile.roles, "HR_ADMIN") ||
            hasRole(profile.roles, "FINANCE_ADMIN") ||
            hasRole(profile.roles, "FINANCE_APPROVER") ||
            hasRole(profile.roles, "SUPER_ADMIN")
          }
          canManageSensitiveProfile={
            hasRole(profile.roles, "HR_ADMIN") ||
            hasRole(profile.roles, "SUPER_ADMIN")
          }
          isSuperAdmin={hasRole(profile.roles, "SUPER_ADMIN")}
          canInitiateOffboarding={
            hasRole(profile.roles, "HR_ADMIN") ||
            hasRole(profile.roles, "SUPER_ADMIN")
          }
        />
      ) : null}

      {activeTab === "compensation" ? (
        hasCompensationAccess ? (
          <PeopleCompensationClient
            employeeId={parsedId.data}
            mode={isSelf ? "me" : "admin"}
          />
        ) : (
          <EmptyState
            title={t("compensationAccessDenied")}
            description={t("compensationAccessDeniedDescription")}
            ctaLabel={t("backToCrew")}
            ctaHref="/people"
          />
        )
      ) : null}
    </>
  );
}
