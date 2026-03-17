import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { checkPageAccess } from "../../../lib/auth/check-page-access";
import { normalizeUserRoles } from "../../../lib/navigation";
import { canManageCompliance } from "../../../lib/compliance";
import { ComplianceClient } from "./compliance-client";
import { ComplianceEmployeeClient } from "./compliance-employee-client";

export default async function CompliancePage() {
  const { allowed, profile } = await checkPageAccess("/compliance");

  if (!profile) {
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

  if (!allowed) {
    const t = await getTranslations('common');
    const tNav = await getTranslations('nav');
    return (
      <>
        <PageHeader
          title={tNav('compliance')}
          description={tNav('description.compliance')}
        />
        <EmptyState
          title={t('emptyState.accessDenied')}
          description={t('emptyState.accessDeniedBody')}
        />
      </>
    );
  }

  const userRoles = normalizeUserRoles(profile.roles);
  const isAdmin = canManageCompliance(userRoles);

  if (!isAdmin) {
    return <ComplianceEmployeeClient userId={profile.id} />;
  }

  return <ComplianceClient />;
}
