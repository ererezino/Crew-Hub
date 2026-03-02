import { EmptyState } from "../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { LearningClient } from "./learning-client";

export default async function LearningPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <EmptyState
        title="Profile is unavailable"
        description="No profile is linked to this account yet."
        ctaLabel="Back to dashboard"
        ctaHref="/dashboard"
      />
    );
  }

  return <LearningClient />;
}
