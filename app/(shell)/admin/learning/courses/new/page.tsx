import { EmptyState } from "../../../../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { hasRole } from "../../../../../../lib/roles";
import { NewLearningCourseClient } from "./new-learning-course-client";

export default async function NewLearningCoursePage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <EmptyState
        title="Profile is unavailable"
        description="No profile is linked to this account yet."
        ctaLabel="Back to learning admin"
        ctaHref="/admin/learning"
      />
    );
  }

  const canManageLearning =
    hasRole(session.profile.roles, "HR_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  if (!canManageLearning) {
    return (
      <EmptyState
        title="Course creation is restricted"
        description="Only HR Admin and Super Admin can create learning courses."
        ctaLabel="Open learning"
        ctaHref="/learning"
      />
    );
  }

  return <NewLearningCourseClient />;
}
