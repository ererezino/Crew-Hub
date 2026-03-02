import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../lib/auth/session";

type SurveyDetailPageProps = {
  params: Promise<{ id: string }>;
};

import { SurveyDetailClient } from "./survey-detail-client";

export default async function SurveyDetailPage({ params }: SurveyDetailPageProps) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Survey"
          description="Submit your responses and help improve team experience in Crew Hub."
        />
        <EmptyState
          title="Profile is unavailable"
          description="No profile is linked to this account yet."
          ctaLabel="Back to surveys"
          ctaHref="/surveys"
        />
      </>
    );
  }

  const { id } = await params;

  return <SurveyDetailClient surveyId={id} />;
}
