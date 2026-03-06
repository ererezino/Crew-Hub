import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";

export default function TeamHubPage() {
  return (
    <>
      <PageHeader
        title="Team Hub"
        description="Your department's knowledge base: guides, contacts, and resources."
      />
      <EmptyState
        title="Team Hub is coming soon"
        description="Your department's knowledge base will be available here. Guides, contacts, runbooks, and more."
        ctaLabel="Back to dashboard"
        ctaHref="/dashboard"
      />
    </>
  );
}
