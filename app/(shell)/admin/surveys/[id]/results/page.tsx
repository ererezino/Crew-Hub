import { EmptyState } from "../../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { hasRole } from "../../../../../../lib/roles";

import { SurveyResultsClient } from "./survey-results-client";

type SurveyResultsPageProps = {
  params: Promise<{ id: string }>;
};

export default async function SurveyResultsPage({ params }: SurveyResultsPageProps) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Survey Results"
          description="Review response metrics and export aggregated survey data."
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
          title="Survey Results"
          description="Review response metrics and export aggregated survey data."
        />
        <EmptyState
          title="Survey results are restricted"
          description="Only HR Admin and Super Admin can view survey results."
          ctaLabel="Open surveys"
          ctaHref="/surveys"
        />
      </>
    );
  }

  const { id } = await params;

  return <SurveyResultsClient surveyId={id} />;
}
