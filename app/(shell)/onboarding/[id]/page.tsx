import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { OnboardingInstanceClient } from "./onboarding-instance-client";

type OnboardingInstancePageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function OnboardingInstancePage({
  params
}: OnboardingInstancePageProps) {
  const session = await getAuthenticatedSession();
  const tCommon = await getTranslations("common");

  if (!session?.profile) {
    return (
      <EmptyState
        title={tCommon("emptyState.profileUnavailable")}
        description={tCommon("emptyState.profileUnavailableBody")}
      />
    );
  }

  const { id } = await params;

  return <OnboardingInstanceClient instanceId={id} />;
}
