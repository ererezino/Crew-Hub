import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasRole } from "../../../../lib/roles";

import { AdminSurveysClient } from "./admin-surveys-client";

export default async function AdminSurveysPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Survey Admin"
          description="Create and manage pulse and engagement surveys in Crew Hub."
        />
        <EmptyState
          title="Profile is unavailable"
          description="No profile is linked to this account yet."
        />
      </>
    );
  }

  const canManageSurveys =
    hasRole(session.profile.roles, "HR_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  if (!canManageSurveys) {
    return (
      <>
        <PageHeader
          title="Survey Admin"
          description="Create and manage pulse and engagement surveys in Crew Hub."
        />
        <EmptyState
          title="Survey admin is restricted"
          description="Only HR Admin and Super Admin can manage surveys."
          ctaLabel="Open surveys"
          ctaHref="/surveys"
        />
      </>
    );
  }

  return <AdminSurveysClient />;
}
