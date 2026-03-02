import { EmptyState } from "../../../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { LearningCourseClient } from "./learning-course-client";

export default async function LearningCoursePage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <EmptyState
        title="Profile is unavailable"
        description="No profile is linked to this account yet."
        ctaLabel="Back to learning"
        ctaHref="/learning"
      />
    );
  }

  const { id } = await params;

  return <LearningCourseClient courseId={id} />;
}
