import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasAnyRole } from "../../../../lib/roles";
import { HubHomeClient } from "./hub-home-client";

type HubPageProps = {
  params: Promise<{
    hubId: string;
  }>;
};

export default async function HubPage({ params }: HubPageProps) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Team Hub"
          description="Your department's knowledge base: guides, contacts, and resources."
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

  const { hubId } = await params;
  const roles = session.profile.roles;
  const isLeadOrAdmin = hasAnyRole(roles, [
    "TEAM_LEAD",
    "MANAGER",
    "HR_ADMIN",
    "SUPER_ADMIN"
  ]);

  return <HubHomeClient hubId={hubId} isLeadOrAdmin={isLeadOrAdmin} />;
}
