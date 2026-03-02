import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasRole } from "../../../../lib/roles";
import { AdminUsersClient } from "./admin-users-client";

export default async function AdminUsersPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Admin Users"
          description="Invite and manage Crew Hub users."
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

  if (!hasRole(session.profile.roles, "SUPER_ADMIN")) {
    return (
      <>
        <PageHeader
          title="Admin Users"
          description="Invite and manage Crew Hub users."
        />
        <EmptyState
          title="Access denied"
          description="Only Super Admin can manage users from this page."
          ctaLabel="Back to dashboard"
          ctaHref="/dashboard"
        />
      </>
    );
  }

  return <AdminUsersClient currentUserId={session.profile.id} />;
}
