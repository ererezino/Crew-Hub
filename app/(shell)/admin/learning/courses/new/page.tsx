import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { hasRole } from "../../../../../../lib/roles";
import { NewLearningCourseClient } from "./new-learning-course-client";

export default async function NewLearningCoursePage() {
  const session = await getAuthenticatedSession();
  const tPage = await getTranslations("learningPage");
  const tReports = await getTranslations("learningReports");
  const tCommon = await getTranslations("common");

  if (!session?.profile) {
    return (
      <EmptyState
        title={tCommon("emptyState.profileUnavailable")}
        description={tCommon("emptyState.profileUnavailableBody")}
        ctaLabel={tReports("backToAdmin")}
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
        title={tPage("courseCreationRestricted")}
        description={tPage("courseCreationRestrictedBody")}
        ctaLabel={tPage("openLearning")}
        ctaHref="/learning"
      />
    );
  }

  return <NewLearningCourseClient />;
}
