import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Workspace and user preferences placeholder for Crew Hub."
      />
      <EmptyState
        title="Settings controls are coming in Phase 1.2"
        description="This route is wired into sidebar and command palette navigation with role-aware shell behavior."
        ctaLabel="Back to dashboard"
        ctaHref="/dashboard"
      />
    </>
  );
}
