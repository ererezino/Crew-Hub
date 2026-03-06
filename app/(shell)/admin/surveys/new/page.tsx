import { EmptyState } from "../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { hasRole } from "../../../../../lib/roles";

import { NewSurveyClient } from "./new-survey-client";

export default async function NewSurveyPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="New Survey"
          description="Build and launch a new crew survey in Crew Hub."
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
          title="New Survey"
          description="Build and launch a new crew survey in Crew Hub."
        />
        <EmptyState
          title="Survey creation is restricted"
          description="Only HR Admin and Super Admin can create surveys."
          ctaLabel="Open surveys"
          ctaHref="/surveys"
        />
      </>
    );
  }

  return <NewSurveyClient />;
}
