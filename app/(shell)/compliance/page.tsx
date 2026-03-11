import { getTranslations } from "next-intl/server";

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
    const t = await getTranslations('common');
    const tNav = await getTranslations('nav');
    return (
      <>
        <PageHeader
          title={tNav('compliance')}
          description={tNav('description.compliance')}
        />
        <EmptyState
          title={t('emptyState.profileUnavailable')}
          description={t('emptyState.profileUnavailableBody')}
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
