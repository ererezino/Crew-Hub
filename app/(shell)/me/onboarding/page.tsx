import { EmptyState } from "../../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { MyOnboardingClient } from "./my-onboarding-client";

export default async function MyOnboardingPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <EmptyState
        title="Profile is unavailable"
        description="No profile is linked to this account yet."
      />
    );
  }

  return <MyOnboardingClient />;
}
