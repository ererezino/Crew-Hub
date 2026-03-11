import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { MyOnboardingClient } from "./my-onboarding-client";

export default async function MyOnboardingPage() {
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

  return <MyOnboardingClient />;
}
