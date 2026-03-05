import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../lib/auth/session";

import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Dashboard"
          description="Role-aware dashboard for Crew Hub users."
        />
        <EmptyState
          title="Profile setup is required"
          description="Your account is authenticated, but no profile record was found yet."
          ctaLabel="Open settings"
          ctaHref="/settings"
        />
      </>
    );
  }

  return <DashboardClient />;
}
