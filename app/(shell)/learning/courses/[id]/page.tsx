import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { LearningCourseClient } from "./learning-course-client";

export default async function LearningCoursePage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getAuthenticatedSession();
  const tCourse = await getTranslations("learningCourse");
  const tCommon = await getTranslations("common");

  if (!session?.profile) {
    return (
      <EmptyState
        title={tCommon("emptyState.profileUnavailable")}
        description={tCommon("emptyState.profileUnavailableBody")}
        ctaLabel={tCourse("backToLearning")}
        ctaHref="/learning"
      />
    );
  }

  const { id } = await params;

  return <LearningCourseClient courseId={id} />;
}
