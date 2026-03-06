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

  return (
    <>
      <PageHeader
        title={routeName}
      />
      <EmptyState
        title="Coming soon"
        description={`The ${routeName.toLowerCase()} module is under development. Check back later.`}
      />
    </>
  );
}
