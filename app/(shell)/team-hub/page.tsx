import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { hasAnyRole } from "../../../lib/roles";
import { TeamHubClient } from "./team-hub-client";

export default async function TeamHubPage() {
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

  const roles = session.profile.roles;
  const isAdmin = hasAnyRole(roles, ["HR_ADMIN", "SUPER_ADMIN"]);

  return (
    <TeamHubClient
      currentUserId={session.profile.id}
      isAdmin={isAdmin}
    />
  );
}
