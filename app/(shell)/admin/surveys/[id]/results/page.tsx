import { getTranslations } from "next-intl/server";

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
  const t = await getTranslations("surveyResults");
  const tSurveys = await getTranslations("surveys");
  const tCommon = await getTranslations("common");

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title={tSurveys("resultsTitle")}
          description={tSurveys("resultsDescription")}
        />
        <EmptyState
          title={tCommon("emptyState.profileUnavailable")}
          description={tCommon("emptyState.profileUnavailableBody")}
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
          title={tSurveys("resultsTitle")}
          description={tSurveys("resultsDescription")}
        />
        <EmptyState
          title={t("resultsRestricted")}
          description={t("resultsRestrictedDescription")}
          ctaLabel={t("openSurveys")}
          ctaHref="/surveys"
        />
      </>
    );
  }

  const { id } = await params;

  return <SurveyResultsClient surveyId={id} />;
}
