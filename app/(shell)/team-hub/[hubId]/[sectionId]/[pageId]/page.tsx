import { EmptyState } from "../../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { hasAnyRole } from "../../../../../../lib/roles";
import { PageViewClient } from "./page-view-client";

type PageViewPageProps = {
  params: Promise<{
    hubId: string;
    sectionId: string;
    pageId: string;
  }>;
};

export default async function PageViewPage({ params }: PageViewPageProps) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Page"
          description="View page content."
        />
        <EmptyState
          title="Profile is unavailable"
          description="No profile is linked to this account yet."
        />
      </>
    );
  }

  const { hubId, sectionId, pageId } = await params;
  const roles = session.profile.roles;
  const isLeadOrAdmin = hasAnyRole(roles, [
    "TEAM_LEAD",
    "MANAGER",
    "HR_ADMIN",
    "SUPER_ADMIN"
  ]);

  return (
    <PageViewClient
      hubId={hubId}
      sectionId={sectionId}
      pageId={pageId}
      isLeadOrAdmin={isLeadOrAdmin}
    />
  );
}
