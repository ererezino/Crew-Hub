import { EmptyState } from "../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { hasAnyRole } from "../../../../../lib/roles";
import { SectionClient } from "./section-client";

type SectionPageProps = {
  params: Promise<{
    hubId: string;
    sectionId: string;
  }>;
};

export default async function SectionPage({ params }: SectionPageProps) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Section"
          description="Browse pages in this section."
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

  const { hubId, sectionId } = await params;
  const roles = session.profile.roles;
  const isLeadOrAdmin = hasAnyRole(roles, [
    "TEAM_LEAD",
    "MANAGER",
    "HR_ADMIN",
    "SUPER_ADMIN"
  ]);

  return (
    <SectionClient
      hubId={hubId}
      sectionId={sectionId}
      isLeadOrAdmin={isLeadOrAdmin}
    />
  );
}
