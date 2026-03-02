import { EmptyState } from "../../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { LearningCertificatesClient } from "./learning-certificates-client";

export default async function LearningCertificatesPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <EmptyState
        title="Profile is unavailable"
        description="No profile is linked to this account yet."
        ctaLabel="Back to learning"
        ctaHref="/learning"
      />
    );
  }

  return <LearningCertificatesClient />;
}
