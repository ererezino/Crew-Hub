import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";

type PlaceholderPageProps = {
  params: Promise<{
    slug: string[];
  }>;
};

function formatSegment(segment: string): string {
  return segment
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function PlaceholderPage({ params }: PlaceholderPageProps) {
  const { slug } = await params;

  const routeName = slug.map(formatSegment).join(" / ");
  const targetPath = `/${slug.join("/")}`;

  return (
    <>
      <PageHeader
        title={routeName}
        description="Placeholder route connected to the Crew Hub app shell."
      />
      <EmptyState
        title="Page module is not implemented yet"
        description={`This placeholder confirms navigation wiring for ${targetPath}.`}
        ctaLabel="Go to dashboard"
        ctaHref="/dashboard"
      />
    </>
  );
}
