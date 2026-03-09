import { NotificationsClient } from "./notifications-client";
import { PageHeader } from "../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { hasRole } from "../../../lib/roles";

export default async function NotificationsPage() {
  const session = await getAuthenticatedSession();
  const isSuperAdmin =
    session?.profile?.roles
      ? hasRole(session.profile.roles, "SUPER_ADMIN")
      : false;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Track updates across approvals, payroll, expenses, compliance, and announcements."
      />
      <NotificationsClient isSuperAdmin={isSuperAdmin} />
    </>
  );
}
