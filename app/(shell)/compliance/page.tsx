import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { normalizeUserRoles } from "../../../lib/navigation";
import { canManageCompliance } from "../../../lib/compliance";
import { ComplianceClient } from "./compliance-client";

export default async function CompliancePage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Compliance"
          description="Track statutory deadlines and proof of filing across all operating countries."
        />
        <EmptyState
          title="Profile is unavailable"
          description="No profile is linked to this account yet."
          ctaLabel="Back to dashboard"
          ctaHref="/dashboard"
        />
      </>
    );
  }

  const userRoles = normalizeUserRoles(session.profile.roles);

  if (!canManageCompliance(userRoles)) {
    return (
      <>
        <PageHeader
          title="Compliance"
          description="Track statutory deadlines and proof of filing across all operating countries."
        />
        <EmptyState
          title="Access denied"
          description="Only HR Admin, Finance Admin, and Super Admin can access compliance."
          ctaLabel="Back to dashboard"
          ctaHref="/dashboard"
        />
      </>
    );
  }

  return <ComplianceClient />;
}
