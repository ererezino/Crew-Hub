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

  if (!session?.profile) {
    return (
      <EmptyState
        title="Profile is unavailable"
        description="No profile is linked to this account yet."
      />
    );
  }

  const { id } = await params;

  return <OnboardingInstanceClient instanceId={id} />;
}
