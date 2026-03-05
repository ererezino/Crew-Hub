import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { normalizeUserRoles } from "../../../lib/navigation";
import { canManageCompliance } from "../../../lib/compliance";
import { ComplianceClient } from "./compliance-client";
import { ComplianceEmployeeClient } from "./compliance-employee-client";

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
  const isAdmin = canManageCompliance(userRoles);

  if (!isAdmin) {
    return <ComplianceEmployeeClient userId={session.profile.id} />;
  }

  return <ComplianceClient />;
}
