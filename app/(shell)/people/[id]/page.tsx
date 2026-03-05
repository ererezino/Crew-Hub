import Link from "next/link";
import { z } from "zod";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
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

function canViewPeopleProfile(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "MANAGER") ||
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

function canViewCompensation(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

export default async function PeopleProfilePage({
  params,
  searchParams
}: PeopleProfilePageProps) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="People"
          description="Crew profile details and compensation tabs."
        />
        <EmptyState
          title="Profile is unavailable"
          description="No profile is linked to this account yet."
          ctaLabel="Back to dashboard"
          ctaHref="/dashboard"
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
          title="People"
          description="Crew profile details and compensation tabs."
        />
        <EmptyState
          title="Invalid profile id"
          description="The requested crew profile path is not a valid identifier."
          ctaLabel="Back to people"
          ctaHref="/people"
        />
      </>
    );
  }

  const isSelf = parsedId.data === session.profile.id;
  const hasPeopleAccess = canViewPeopleProfile(session.profile.roles) || isSelf;

  if (!hasPeopleAccess) {
    return (
      <>
        <PageHeader
          title="People"
          description="Crew profile details and compensation tabs."
        />
        <EmptyState
          title="Access denied"
          description="You do not have permission to view this crew profile."
          ctaLabel="Back to dashboard"
          ctaHref="/dashboard"
        />
      </>
    );
  }

  const resolvedSearchParams = await searchParams;
  const requestedTab = resolveTab(resolvedSearchParams);
  const hasCompensationAccess = canViewCompensation(session.profile.roles) || isSelf;
  const activeTab: PeopleTab = hasCompensationAccess ? requestedTab : "overview";

  return (
    <>
      <PageHeader
        title="People"
        description="Crew profile details and compensation records."
      />

      <section className="page-tabs" role="tablist" aria-label="Profile tabs">
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
          Overview
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
            Compensation
          </Link>
        ) : null}
      </section>

      {activeTab === "overview" ? (
        <PeopleOverviewClient
          employeeId={parsedId.data}
          isSelf={isSelf}
          isAdmin={
            hasRole(session.profile.roles, "HR_ADMIN") ||
            hasRole(session.profile.roles, "FINANCE_ADMIN") ||
            hasRole(session.profile.roles, "SUPER_ADMIN")
          }
          canOffboard={
            hasRole(session.profile.roles, "HR_ADMIN") ||
            hasRole(session.profile.roles, "SUPER_ADMIN")
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
            title="Compensation access denied"
            description="Only HR Admin, Finance Admin, Super Admin, or the profile owner can view compensation."
            ctaLabel="Back to people"
            ctaHref="/people"
          />
        )
      ) : null}
    </>
  );
}
