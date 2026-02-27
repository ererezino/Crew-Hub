import { NotificationsClient } from "./notifications-client";
import { PageHeader } from "../../../components/shared/page-header";

export default function NotificationsPage() {
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Track updates across approvals, payroll, expenses, compliance, and announcements."
      />
      <NotificationsClient />
    </>
  );
}
