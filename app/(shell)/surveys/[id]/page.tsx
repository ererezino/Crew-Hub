import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../lib/auth/session";

type SurveyDetailPageProps = {
  params: Promise<{ id: string }>;
};

import { SurveyDetailClient } from "./survey-detail-client";

export default async function SurveyDetailPage({ params }: SurveyDetailPageProps) {
  const session = await getAuthenticatedSession();
  const tSurveys = await getTranslations("surveys");
  const tDetail = await getTranslations("surveyDetail");
  const tCommon = await getTranslations("common");

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title={tSurveys("title")}
          description={tSurveys("description")}
        />
        <EmptyState
          title={tCommon("emptyState.profileUnavailable")}
          description={tCommon("emptyState.profileUnavailableBody")}
          ctaLabel={tDetail("backToSurveys")}
          ctaHref="/surveys"
        />
      </>
    );
  }

  const { id } = await params;

  return <SurveyDetailClient surveyId={id} />;
}
