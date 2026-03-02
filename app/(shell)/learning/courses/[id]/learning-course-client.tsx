"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../components/shared/page-header";
import { StatusBadge } from "../../../../../components/shared/status-badge";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../../lib/datetime";
import type {
  LearningAssignmentMutationResponse,
  LearningAssignmentRecord,
  LearningCourseMutationResponse,
  LearningCourseRecord,
  LearningMyAssignmentsResponse
} from "../../../../../types/learning";

type LearningCourseClientProps = {
  courseId: string;
};

type InlineErrors = {
  progress?: string;
  quiz?: string;
  form?: string;
};

function toneForAssignmentStatus(status: LearningAssignmentRecord["status"]) {
  switch (status) {
    case "assigned":
      return "draft" as const;
    case "in_progress":
      return "processing" as const;
    case "completed":
      return "success" as const;
    case "overdue":
      return "warning" as const;
    case "failed":
      return "error" as const;
    default:
      return "draft" as const;
  }
}

function parseInteger(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function learningCourseSkeleton() {
  return (
    <section className="timeoff-skeleton-layout" aria-hidden="true">
      <div className="timeoff-balance-skeleton-grid">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={`learning-course-metric-skeleton-${index}`} className="timeoff-balance-skeleton-card" />
        ))}
      </div>
      <div className="timeoff-table-skeleton">
        <div className="timeoff-table-skeleton-header" />
        {Array.from({ length: 4 }, (_, index) => (
          <div key={`learning-course-row-skeleton-${index}`} className="timeoff-table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

export function LearningCourseClient({ courseId }: LearningCourseClientProps) {
  const [course, setCourse] = useState<LearningCourseRecord | null>(null);
  const [assignment, setAssignment] = useState<LearningAssignmentRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progressInput, setProgressInput] = useState("0");
  const [quizScoreInput, setQuizScoreInput] = useState("");
  const [isSavingProgress, setIsSavingProgress] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [errors, setErrors] = useState<InlineErrors>({});
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    const run = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const [courseResponse, assignmentsResponse] = await Promise.all([
          fetch(`/api/v1/learning/courses/${courseId}`, {
            method: "GET",
            signal: abortController.signal
          }),
          fetch("/api/v1/learning/my-assignments", {
            method: "GET",
            signal: abortController.signal
          })
        ]);

        const coursePayload = (await courseResponse.json()) as LearningCourseMutationResponse;
        const assignmentsPayload = (await assignmentsResponse.json()) as LearningMyAssignmentsResponse;

        if (!courseResponse.ok || !coursePayload.data?.course) {
          setCourse(null);
          setAssignment(null);
          setErrorMessage(coursePayload.error?.message ?? "Unable to load course details.");
          return;
        }

        const nextCourse = coursePayload.data.course;
        const nextAssignment = (assignmentsPayload.data?.assignments ?? []).find(
          (row) => row.courseId === nextCourse.id
        ) ?? null;

        setCourse(nextCourse);
        setAssignment(nextAssignment);
        setProgressInput(String(nextAssignment?.progressPct ?? 0));
        setQuizScoreInput(nextAssignment?.quizScore !== null && nextAssignment?.quizScore !== undefined ? String(nextAssignment.quizScore) : "");
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setCourse(null);
        setAssignment(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load course details.");
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void run();

    return () => {
      abortController.abort();
    };
  }, [courseId]);

  const parsedModules = useMemo(() => {
    if (!course || !Array.isArray(course.modules)) {
      return [] as Array<Record<string, unknown>>;
    }

    return course.modules
      .map((moduleValue) =>
        moduleValue && typeof moduleValue === "object" && !Array.isArray(moduleValue)
          ? (moduleValue as Record<string, unknown>)
          : null
      )
      .filter((value): value is Record<string, unknown> => Boolean(value));
  }, [course]);

  async function handleSaveProgress() {
    if (!assignment) {
      setErrors({ form: "This course is not assigned to you yet." });
      return;
    }

    setErrors({});
    setSubmitMessage(null);

    const parsedProgress = parseInteger(progressInput);

    if (parsedProgress === null || parsedProgress < 0 || parsedProgress > 100) {
      setErrors({ progress: "Progress must be a whole number from 0 to 100." });
      return;
    }

    setIsSavingProgress(true);

    try {
      const response = await fetch(`/api/v1/learning/assignments/${assignment.id}/progress`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          progressPct: parsedProgress
        })
      });

      const payload = (await response.json()) as LearningAssignmentMutationResponse;

      if (!response.ok || !payload.data?.assignment) {
        setErrors({ form: payload.error?.message ?? "Unable to update progress." });
        return;
      }

      setAssignment(payload.data.assignment);
      setProgressInput(String(payload.data.assignment.progressPct));
      setSubmitMessage("Progress updated.");
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : "Unable to update progress." });
    } finally {
      setIsSavingProgress(false);
    }
  }

  async function handleCompleteCourse() {
    if (!assignment || !course) {
      setErrors({ form: "This course is not assigned to you yet." });
      return;
    }

    setErrors({});
    setSubmitMessage(null);

    const parsedQuizScore = quizScoreInput.trim().length === 0 ? null : parseInteger(quizScoreInput);

    if (quizScoreInput.trim().length > 0 && (parsedQuizScore === null || parsedQuizScore < 0 || parsedQuizScore > 100)) {
      setErrors({ quiz: "Quiz score must be a whole number from 0 to 100." });
      return;
    }

    if (course.passingScore !== null && parsedQuizScore === null) {
      setErrors({ quiz: "Quiz score is required for this course." });
      return;
    }

    setIsCompleting(true);

    try {
      const response = await fetch(`/api/v1/learning/assignments/${assignment.id}/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          quizScore: parsedQuizScore ?? undefined
        })
      });

      const payload = (await response.json()) as LearningAssignmentMutationResponse;

      if (!response.ok || !payload.data?.assignment) {
        setErrors({ form: payload.error?.message ?? "Unable to complete course." });
        return;
      }

      setAssignment(payload.data.assignment);
      setProgressInput(String(payload.data.assignment.progressPct));
      if (payload.data.assignment.quizScore !== null) {
        setQuizScoreInput(String(payload.data.assignment.quizScore));
      }

      if (payload.data.assignment.status === "failed") {
        setSubmitMessage("Quiz score did not meet the passing threshold. Please retry.");
      } else {
        setSubmitMessage("Course marked as completed.");
      }
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : "Unable to complete course." });
    } finally {
      setIsCompleting(false);
    }
  }

  return (
    <>
      <PageHeader
        title={course?.title ?? "Learning Course"}
        description="Review course content and keep your assignment progress up to date."
      />

      {isLoading ? learningCourseSkeleton() : null}

      {!isLoading && errorMessage ? (
        <section className="compensation-error-state">
          <EmptyState
            title="Course data is unavailable"
            description={errorMessage}
            ctaLabel="Back to learning"
            ctaHref="/learning"
          />
        </section>
      ) : null}

      {!isLoading && !errorMessage && course ? (
        <section className="compensation-layout" aria-label="Learning course detail">
          <article className="metric-grid">
            <article className="metric-card">
              <p className="metric-label">Category</p>
              <p className="metric-value">{course.category ?? "General"}</p>
              <p className="metric-description">Course category tag.</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Duration</p>
              <p className="metric-value numeric">
                {course.durationMinutes === null ? "--" : `${course.durationMinutes}m`}
              </p>
              <p className="metric-description">Estimated completion time.</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Difficulty</p>
              <p className="metric-value">{course.difficulty ?? "General"}</p>
              <p className="metric-description">Learning complexity tier.</p>
            </article>
          </article>

          <article className="settings-card">
            <header className="announcement-item-header">
              <div>
                <h2 className="section-title">Course details</h2>
                <p className="settings-card-description">
                  {course.description ?? "No additional course description was provided."}
                </p>
              </div>
              <StatusBadge tone={course.isMandatory ? "warning" : "draft"}>
                {course.isMandatory ? "Mandatory" : "Optional"}
              </StatusBadge>
            </header>

            {course.contentUrl ? (
              <div className="documents-row-actions">
                <a href={course.contentUrl} target="_blank" rel="noreferrer" className="button button-accent">
                  Open content
                </a>
              </div>
            ) : (
              <p className="settings-card-description">No external content URL was configured yet.</p>
            )}
          </article>

          <article className="compensation-section">
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">Modules</h2>
                <p className="settings-card-description">
                  Structured content modules for this course.
                </p>
              </div>
            </header>

            {parsedModules.length === 0 ? (
              <EmptyState
                title="No modules configured"
                description="This course does not yet have structured modules."
                ctaLabel="Back to learning"
                ctaHref="/learning"
              />
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label="Learning modules table">
                  <thead>
                    <tr>
                      <th>Module</th>
                      <th>Type</th>
                      <th>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedModules.map((moduleRow, index) => {
                      const titleValue =
                        typeof moduleRow.title === "string" && moduleRow.title.trim().length > 0
                          ? moduleRow.title
                          : `Module ${index + 1}`;
                      const typeValue =
                        typeof moduleRow.type === "string" && moduleRow.type.trim().length > 0
                          ? moduleRow.type
                          : "content";
                      const durationValue =
                        typeof moduleRow.duration_minutes === "number"
                          ? `${Math.trunc(moduleRow.duration_minutes)}m`
                          : "--";

                      return (
                        <tr key={`${titleValue}-${index}`} className="data-table-row">
                          <td>{titleValue}</td>
                          <td>
                            <StatusBadge tone="info">{typeValue}</StatusBadge>
                          </td>
                          <td className="numeric">{durationValue}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <article className="settings-card">
            <header className="announcement-item-header">
              <div>
                <h2 className="section-title">Assignment progress</h2>
                <p className="settings-card-description">
                  Update your completion progress and submit final completion.
                </p>
              </div>
              {assignment ? (
                <StatusBadge tone={toneForAssignmentStatus(assignment.status)}>
                  {assignment.status.replace("_", " ")}
                </StatusBadge>
              ) : null}
            </header>

            {!assignment ? (
              <EmptyState
                title="Not assigned"
                description="This course is in the catalog, but you do not have an assignment yet."
                ctaLabel="Back to learning"
                ctaHref="/learning"
              />
            ) : (
              <>
                <div className="settings-form-grid">
                  {assignment.dueDate ? (
                    <p className="settings-card-description">
                      Due {" "}
                      <span title={formatDateTimeTooltip(`${assignment.dueDate}T00:00:00.000Z`)}>
                        {formatRelativeTime(`${assignment.dueDate}T00:00:00.000Z`)}
                      </span>
                    </p>
                  ) : (
                    <p className="settings-card-description">No due date set.</p>
                  )}

                  <label className="settings-field">
                    <span className="settings-field-label">Progress (%)</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className="settings-input numeric"
                      value={progressInput}
                      onChange={(event) => setProgressInput(event.target.value)}
                    />
                  </label>
                  {errors.progress ? <p className="form-field-error">{errors.progress}</p> : null}

                  <label className="settings-field">
                    <span className="settings-field-label">Quiz score (%)</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className="settings-input numeric"
                      value={quizScoreInput}
                      onChange={(event) => setQuizScoreInput(event.target.value)}
                    />
                  </label>
                  {errors.quiz ? <p className="form-field-error">{errors.quiz}</p> : null}

                  {errors.form ? <p className="form-field-error">{errors.form}</p> : null}

                  <div className="settings-actions">
                    <button
                      type="button"
                      className="button"
                      disabled={isSavingProgress}
                      onClick={() => void handleSaveProgress()}
                    >
                      {isSavingProgress ? "Saving..." : "Save progress"}
                    </button>
                    <button
                      type="button"
                      className="button button-accent"
                      disabled={isCompleting}
                      onClick={() => void handleCompleteCourse()}
                    >
                      {isCompleting ? "Submitting..." : "Complete course"}
                    </button>
                    {assignment.status === "completed" && assignment.certificateUrl ? (
                      <Link href="/learning/certificates" className="button">
                        View certificate
                      </Link>
                    ) : null}
                  </div>
                </div>

                {submitMessage ? <p className="settings-card-description">{submitMessage}</p> : null}
              </>
            )}
          </article>
        </section>
      ) : null}
    </>
  );
}
