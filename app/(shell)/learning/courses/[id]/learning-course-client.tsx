"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState } from "../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../components/shared/page-header";
import { ProgressRing } from "../../../../../components/shared/progress-ring";
import { StatusBadge } from "../../../../../components/shared/status-badge";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../../lib/datetime";
import { toSentenceCase } from "../../../../../lib/format-labels";
import type {
  LearningAssignmentRecord,
  LearningCourseMutationResponse,
  LearningCourseRecord,
  LearningModuleDefinition,
  LearningModuleProgressResponse,
  LearningModuleStatus,
  LearningMyAssignmentsResponse,
  LearningQuizQuestion,
  LearningQuizResult
} from "../../../../../types/learning";

// ── Types ──

type LearningCourseClientProps = {
  courseId: string;
};

type ParsedModule = LearningModuleDefinition;

type QuizState = {
  currentIndex: number;
  answers: Record<string, number>;
};

// ── Helpers ──

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

function parseModulesFromCourse(course: LearningCourseRecord): ParsedModule[] {
  if (!Array.isArray(course.modules)) return [];

  return course.modules
    .filter(
      (item): item is Record<string, unknown> =>
        item !== null && typeof item === "object" && !Array.isArray(item)
    )
    .filter((item) => typeof item.id === "string" && (item.id as string).length > 0)
    .map((item) => ({
      id: item.id as string,
      title: typeof item.title === "string" ? item.title : "Untitled",
      type: (typeof item.type === "string" ? item.type : "content") as ParsedModule["type"],
      contentUrl: typeof item.content_url === "string" ? item.content_url : null,
      durationMinutes:
        typeof item.duration_minutes === "number" ? Math.trunc(item.duration_minutes) : null,
      questions: Array.isArray(item.questions)
        ? (item.questions as Array<Record<string, unknown>>)
            .filter(
              (q): q is Record<string, unknown> =>
                q !== null && typeof q === "object" && typeof q.id === "string"
            )
            .map((q) => ({
              id: q.id as string,
              text: typeof q.text === "string" ? q.text : "",
              options: Array.isArray(q.options) ? (q.options as string[]) : []
            }))
        : []
    }));
}

function getModuleStatus(
  moduleId: string,
  moduleIndex: number,
  moduleProgress: Record<string, unknown>,
  modules: ParsedModule[]
): LearningModuleStatus {
  const entry = moduleProgress[moduleId] as
    | { status?: string; startedAt?: string; completedAt?: string }
    | undefined;

  if (entry?.status === "completed") {
    return { status: "completed", completedAt: entry.completedAt };
  }

  if (entry?.status === "in_progress") {
    return { status: "in_progress", startedAt: entry.startedAt };
  }

  // First module is always unlocked
  if (moduleIndex === 0) {
    return { status: "in_progress" };
  }

  // Unlock if previous module is completed
  const prevModule = modules[moduleIndex - 1];

  if (prevModule) {
    const prevEntry = moduleProgress[prevModule.id] as
      | { status?: string }
      | undefined;

    if (prevEntry?.status === "completed") {
      return { status: "in_progress" };
    }
  }

  return { status: "locked" };
}

function toneForModuleStatus(status: LearningModuleStatus["status"]) {
  switch (status) {
    case "completed":
      return "success" as const;
    case "in_progress":
      return "processing" as const;
    case "locked":
      return "draft" as const;
    default:
      return "draft" as const;
  }
}

function learningCourseSkeleton() {
  return (
    <section className="timeoff-skeleton-layout" aria-hidden="true">
      <div className="timeoff-balance-skeleton-grid">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={`learning-course-metric-skeleton-${index}`} className="timeoff-balance-skeleton-card" />
        ))}
      </div>
      <div className="table-skeleton">
        <div className="table-skeleton-header" />
        {Array.from({ length: 4 }, (_, index) => (
          <div key={`learning-course-row-skeleton-${index}`} className="table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

// ── Quiz Module ──

function QuizModule({
  questions,
  onSubmit,
  isSubmitting,
  quizResult,
  allowRetake,
  onRetry
}: {
  questions: LearningQuizQuestion[];
  onSubmit: (answers: Record<string, number>) => void;
  isSubmitting: boolean;
  quizResult: LearningQuizResult | null;
  allowRetake: boolean;
  onRetry: () => void;
}) {
  const [quiz, setQuiz] = useState<QuizState>({
    currentIndex: 0,
    answers: {}
  });
  const resolvedQuizResult = quizResult;
  const isQuizSubmitted = resolvedQuizResult !== null;

  const currentQuestion = questions[quiz.currentIndex];
  const isLastQuestion = quiz.currentIndex === questions.length - 1;
  const hasAnswered = currentQuestion ? quiz.answers[currentQuestion.id] !== undefined : false;

  function handleSelectOption(questionId: string, optionIndex: number) {
    if (isQuizSubmitted) return;

    setQuiz((prev) => ({
      ...prev,
      answers: { ...prev.answers, [questionId]: optionIndex }
    }));
  }

  function handleNext() {
    if (isLastQuestion) {
      onSubmit(quiz.answers);
      return;
    }

    setQuiz((prev) => ({
      ...prev,
      currentIndex: prev.currentIndex + 1
    }));
  }

  function handleRetry() {
    onRetry();
    setQuiz({
      currentIndex: 0,
      answers: {}
    });
  }

  // Show result card after submission
  if (isQuizSubmitted && resolvedQuizResult) {
    return (
      <div className="module-quiz-result">
        <h3 className="section-title">Quiz Result</h3>
        <p className="module-quiz-score">
          You scored <strong className="numeric">{resolvedQuizResult.score}%</strong>.
          {resolvedQuizResult.passingScore !== null
            ? ` Pass mark is ${resolvedQuizResult.passingScore}%.`
            : ""}
        </p>

        {resolvedQuizResult.passed ? (
          <StatusBadge tone="success">Passed</StatusBadge>
        ) : (
          <StatusBadge tone="error">Failed</StatusBadge>
        )}

        <div className="module-quiz-result-actions">
          {resolvedQuizResult.passed ? (
            <p className="settings-card-description">Module completed. Continue to the next module.</p>
          ) : resolvedQuizResult.allowRetake ? (
            <button type="button" className="button" onClick={handleRetry}>
              Try again
            </button>
          ) : (
            <p className="form-submit-error">You did not pass this module.</p>
          )}
        </div>
      </div>
    );
  }

  if (!currentQuestion) {
    return (
      <EmptyState
        title="No questions"
        description="This quiz module has no questions configured."
        ctaLabel="Back to learning"
        ctaHref="/learning"
      />
    );
  }

  return (
    <div className="module-quiz">
      <p className="module-quiz-counter">
        Question {quiz.currentIndex + 1} of {questions.length}
      </p>

      <h3 className="module-quiz-question">{currentQuestion.text}</h3>

      <div className="module-quiz-options">
        {currentQuestion.options.map((option, optionIndex) => {
          const optionLetter = String.fromCharCode(65 + optionIndex);
          const isSelected = quiz.answers[currentQuestion.id] === optionIndex;

          return (
            <label
              key={`${currentQuestion.id}-${optionIndex}`}
              className={`module-quiz-option ${isSelected ? "module-quiz-option-selected" : ""}`}
            >
              <input
                type="radio"
                name={`quiz-${currentQuestion.id}`}
                checked={isSelected}
                onChange={() => handleSelectOption(currentQuestion.id, optionIndex)}
              />
              <span className="module-quiz-option-letter">{optionLetter}</span>
              <span>{option}</span>
            </label>
          );
        })}
      </div>

      <div className="module-quiz-actions">
        <button
          type="button"
          className="button button-accent"
          disabled={!hasAnswered || isSubmitting}
          onClick={handleNext}
        >
          {isSubmitting
            ? "Submitting..."
            : isLastQuestion
              ? "Submit quiz"
              : "Next question"}
        </button>
      </div>
    </div>
  );
}

// ── Module Content Renderers ──

function VideoModuleContent({
  module: mod,
  onMarkComplete,
  isCompleting
}: {
  module: ParsedModule;
  onMarkComplete: () => void;
  isCompleting: boolean;
}) {
  return (
    <div className="module-content-block">
      {mod.contentUrl ? (
        <div className="module-video-container">
          <iframe
            src={mod.contentUrl}
            title={mod.title}
            className="module-video-iframe"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <p className="settings-card-description">No video URL configured for this module.</p>
      )}
      <button
        type="button"
        className="button button-accent"
        disabled={isCompleting}
        onClick={onMarkComplete}
      >
        {isCompleting ? "Saving..." : "Mark as complete"}
      </button>
    </div>
  );
}

function DocumentModuleContent({
  module: mod,
  onMarkComplete,
  isCompleting
}: {
  module: ParsedModule;
  onMarkComplete: () => void;
  isCompleting: boolean;
}) {
  return (
    <div className="module-content-block">
      {mod.contentUrl ? (
        <div className="module-document-container">
          <iframe
            src={mod.contentUrl}
            title={mod.title}
            className="module-document-iframe"
          />
        </div>
      ) : (
        <p className="settings-card-description">No document URL configured for this module.</p>
      )}
      <button
        type="button"
        className="button button-accent"
        disabled={isCompleting}
        onClick={onMarkComplete}
      >
        {isCompleting ? "Saving..." : "Mark as complete"}
      </button>
    </div>
  );
}

function LinkModuleContent({
  module: mod,
  onMarkComplete,
  isCompleting
}: {
  module: ParsedModule;
  onMarkComplete: () => void;
  isCompleting: boolean;
}) {
  const [hasOpened, setHasOpened] = useState(false);

  return (
    <div className="module-content-block">
      {mod.contentUrl ? (
        <>
          <p className="settings-card-description">
            External resource for this module:
          </p>
          <a
            href={mod.contentUrl}
            target="_blank"
            rel="noreferrer"
            className="button"
            onClick={() => setHasOpened(true)}
          >
            Open resource
          </a>
        </>
      ) : (
        <p className="settings-card-description">No URL configured for this module.</p>
      )}

      {hasOpened || !mod.contentUrl ? (
        <button
          type="button"
          className="button button-accent"
          disabled={isCompleting}
          onClick={onMarkComplete}
          style={{ marginTop: "var(--space-md)" }}
        >
          {isCompleting ? "Saving..." : "Mark as complete"}
        </button>
      ) : null}
    </div>
  );
}

// ── Main Component ──

export function LearningCourseClient({ courseId }: LearningCourseClientProps) {
  const [course, setCourse] = useState<LearningCourseRecord | null>(null);
  const [assignment, setAssignment] = useState<LearningAssignmentRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [isModuleSubmitting, setIsModuleSubmitting] = useState(false);
  const [moduleError, setModuleError] = useState<string | null>(null);
  const [quizResult, setQuizResult] = useState<LearningQuizResult | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  // Load course and assignment data
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
        const nextAssignment =
          (assignmentsPayload.data?.assignments ?? []).find(
            (row) => row.courseId === nextCourse.id
          ) ?? null;

        setCourse(nextCourse);
        setAssignment(nextAssignment);
      } catch (error) {
        if (abortController.signal.aborted) return;
        setCourse(null);
        setAssignment(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load course details.");
      } finally {
        if (!abortController.signal.aborted) setIsLoading(false);
      }
    };

    void run();
    return () => { abortController.abort(); };
  }, [courseId]);

  // Parse modules
  const modules = useMemo(() => {
    if (!course) return [];
    return parseModulesFromCourse(course);
  }, [course]);

  // Set first module as active
  useEffect(() => {
    if (modules.length > 0 && !activeModuleId) {
      // Find the first non-completed module, or default to the first one
      const progress = assignment?.moduleProgress ?? {};
      const firstIncomplete = modules.find((m) => {
        const entry = progress[m.id] as { status?: string } | undefined;
        return entry?.status !== "completed";
      });
      setActiveModuleId(firstIncomplete?.id ?? modules[0].id);
    }
  }, [modules, activeModuleId, assignment?.moduleProgress]);

  // Module statuses
  const moduleStatuses = useMemo(() => {
    const progress = assignment?.moduleProgress ?? {};
    const statusMap = new Map<string, LearningModuleStatus>();

    for (let i = 0; i < modules.length; i++) {
      statusMap.set(modules[i].id, getModuleStatus(modules[i].id, i, progress, modules));
    }

    return statusMap;
  }, [modules, assignment?.moduleProgress]);

  const activeModule = useMemo(
    () => modules.find((m) => m.id === activeModuleId) ?? null,
    [modules, activeModuleId]
  );

  const activeModuleStatus = activeModuleId
    ? moduleStatuses.get(activeModuleId) ?? { status: "locked" as const }
    : { status: "locked" as const };

  const isMultiModule = course?.contentType === "multi_module";

  // ── Module progress handler ──
  const handleModuleAction = useCallback(
    async (moduleId: string, status: "completed" | "in_progress", quizAnswers?: Record<string, number>) => {
      if (!assignment) return;

      setIsModuleSubmitting(true);
      setModuleError(null);
      setSubmitMessage(null);
      setQuizResult(null);

      try {
        const response = await fetch(`/api/v1/learning/assignments/${assignment.id}/progress`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ moduleId, status, quizAnswers })
        });

        const payload = (await response.json()) as LearningModuleProgressResponse;

        if (!response.ok || !payload.data?.assignment) {
          setModuleError(payload.error?.message ?? "Unable to update module progress.");
          return;
        }

        setAssignment(payload.data.assignment);

        if (payload.data.quizResult) {
          setQuizResult(payload.data.quizResult);

          if (payload.data.quizResult.passed) {
            setSubmitMessage("Quiz passed! Module completed.");
          }
        } else if (status === "completed") {
          setSubmitMessage("Module completed.");

          // Auto-advance to next module
          const currentIndex = modules.findIndex((m) => m.id === moduleId);

          if (currentIndex >= 0 && currentIndex < modules.length - 1) {
            setActiveModuleId(modules[currentIndex + 1].id);
            setSubmitMessage(null);
          } else if (payload.data.assignment.status === "completed") {
            setSubmitMessage("All modules completed. Course is done!");
          }
        }
      } catch (error) {
        setModuleError(error instanceof Error ? error.message : "Unable to update module progress.");
      } finally {
        setIsModuleSubmitting(false);
      }
    },
    [assignment, modules]
  );

  const handleMarkComplete = useCallback(
    (moduleId: string) => {
      void handleModuleAction(moduleId, "completed");
    },
    [handleModuleAction]
  );

  const handleQuizSubmit = useCallback(
    (moduleId: string, answers: Record<string, number>) => {
      void handleModuleAction(moduleId, "completed", answers);
    },
    [handleModuleAction]
  );

  // ── Render active module content ──
  function renderModuleContent(mod: ParsedModule, status: LearningModuleStatus) {
    if (status.status === "locked") {
      return (
        <div className="module-locked-message">
          <p className="settings-card-description">
            Complete the previous module to unlock this one.
          </p>
        </div>
      );
    }

    if (status.status === "completed" && mod.type !== "quiz") {
      return (
        <div className="module-completed-message">
          <StatusBadge tone="success">Completed</StatusBadge>
          <p className="settings-card-description">
            This module has been completed.
            {status.completedAt
              ? ` Completed ${formatRelativeTime(status.completedAt)}.`
              : ""}
          </p>
        </div>
      );
    }

    switch (mod.type) {
      case "video":
        return (
          <VideoModuleContent
            module={mod}
            onMarkComplete={() => handleMarkComplete(mod.id)}
            isCompleting={isModuleSubmitting}
          />
        );

      case "document":
        return (
          <DocumentModuleContent
            module={mod}
            onMarkComplete={() => handleMarkComplete(mod.id)}
            isCompleting={isModuleSubmitting}
          />
        );

      case "link":
        return (
          <LinkModuleContent
            module={mod}
            onMarkComplete={() => handleMarkComplete(mod.id)}
            isCompleting={isModuleSubmitting}
          />
        );

      case "quiz":
        return (
          <QuizModule
            questions={mod.questions}
            onSubmit={(answers) => handleQuizSubmit(mod.id, answers)}
            isSubmitting={isModuleSubmitting}
            quizResult={quizResult}
            allowRetake={course?.allowRetake ?? false}
            onRetry={() => setQuizResult(null)}
          />
        );

      default:
        return (
          <div className="module-content-block">
            <p className="settings-card-description">
              Module type &quot;{mod.type}&quot; is not yet supported.
            </p>
            <button
              type="button"
              className="button button-accent"
              disabled={isModuleSubmitting}
              onClick={() => handleMarkComplete(mod.id)}
            >
              {isModuleSubmitting ? "Saving..." : "Mark as complete"}
            </button>
          </div>
        );
    }
  }

  // ── Render ──
  return (
    <>
      <PageHeader
        title={course?.title ?? "Learning Course"}
        description="Review course content and keep your assignment progress up to date."
      />

      {isLoading ? learningCourseSkeleton() : null}

      {!isLoading && errorMessage ? (
        <section className="error-state">
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
          {/* ── Metrics ── */}
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
              <p className="metric-label">Progress</p>
              <p className="metric-value">
                {assignment ? (
                  <ProgressRing value={assignment.progressPct} size={48} label={`${assignment.progressPct}%`} />
                ) : (
                  "--"
                )}
              </p>
              <p className="metric-description">
                {assignment
                  ? `${assignment.progressPct}% complete`
                  : "Not assigned yet."}
              </p>
            </article>
          </article>

          {/* ── Assignment status ── */}
          {assignment ? (
            <article className="settings-card">
              <header className="announcement-item-header">
                <div>
                  <h2 className="section-title">Assignment</h2>
                  <p className="settings-card-description">
                    {assignment.dueDate ? (
                      <>
                        Due{" "}
                        <span title={formatDateTimeTooltip(`${assignment.dueDate}T00:00:00.000Z`)}>
                          {formatRelativeTime(`${assignment.dueDate}T00:00:00.000Z`)}
                        </span>
                      </>
                    ) : (
                      "No due date set."
                    )}
                    {assignment.status === "completed" && assignment.certificateUrl ? (
                      <>
                        {" • "}
                        <Link href="/learning/certificates">View certificate</Link>
                      </>
                    ) : null}
                  </p>
                </div>
                <StatusBadge tone={toneForAssignmentStatus(assignment.status)}>
                  {toSentenceCase(assignment.status)}
                </StatusBadge>
              </header>
            </article>
          ) : null}

          {/* ── Feedback messages ── */}
          {moduleError ? (
            <article className="settings-card">
              <p className="form-submit-error">{moduleError}</p>
            </article>
          ) : null}

          {submitMessage ? (
            <article className="settings-card">
              <p className="settings-card-description">{submitMessage}</p>
            </article>
          ) : null}

          {/* ── Multi-module layout ── */}
          {isMultiModule && modules.length > 0 ? (
            <article className="module-layout">
              {/* Sidebar */}
              <nav className="module-sidebar" aria-label="Course modules">
                <h3 className="module-sidebar-title">Modules</h3>
                <ul className="module-sidebar-list">
                  {modules.map((mod, index) => {
                    const status = moduleStatuses.get(mod.id) ?? { status: "locked" as const };
                    const isActive = mod.id === activeModuleId;

                    return (
                      <li key={mod.id}>
                        <button
                          type="button"
                          className={`module-sidebar-item ${isActive ? "module-sidebar-item-active" : ""} ${status.status === "locked" ? "module-sidebar-item-locked" : ""}`}
                          disabled={status.status === "locked"}
                          onClick={() => {
                            setActiveModuleId(mod.id);
                            setModuleError(null);
                            setSubmitMessage(null);
                            setQuizResult(null);
                          }}
                        >
                          <span className="module-sidebar-index">
                            {status.status === "completed"
                              ? "✓"
                              : status.status === "locked"
                                ? "—"
                                : String(index + 1)}
                          </span>
                          <span className="module-sidebar-label">
                            <span className="module-sidebar-name">{mod.title}</span>
                            <StatusBadge tone={toneForModuleStatus(status.status)}>
                              {toSentenceCase(status.status)}
                            </StatusBadge>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </nav>

              {/* Module content */}
              <div className="module-content-area">
                {activeModule ? (
                  <>
                    <h2 className="section-title">{activeModule.title}</h2>
                    <p className="settings-card-description">
                      {toSentenceCase(activeModule.type)} module
                      {activeModule.durationMinutes
                        ? ` • ${activeModule.durationMinutes}m`
                        : ""}
                    </p>
                    {renderModuleContent(activeModule, activeModuleStatus)}
                  </>
                ) : (
                  <EmptyState
                    title="Select a module"
                    description="Choose a module from the sidebar to view its content."
                    ctaLabel="Back to learning"
                    ctaHref="/learning"
                  />
                )}
              </div>
            </article>
          ) : null}

          {/* ── Single-module courses ── */}
          {!isMultiModule && modules.length > 0 && assignment ? (
            <article className="settings-card">
              <header className="announcement-item-header">
                <div>
                  <h2 className="section-title">Course content</h2>
                  <p className="settings-card-description">
                    {toSentenceCase(course.contentType)} content
                    {course.durationMinutes ? ` • ${course.durationMinutes}m` : ""}
                  </p>
                </div>
              </header>
              {renderModuleContent(modules[0], {
                status: assignment.status === "completed" ? "completed" : "in_progress"
              })}
            </article>
          ) : null}

          {/* ── Single-module — no modules configured but has contentUrl ── */}
          {!isMultiModule && modules.length === 0 && course.contentUrl ? (
            <article className="settings-card">
              <header className="announcement-item-header">
                <div>
                  <h2 className="section-title">Course content</h2>
                  <p className="settings-card-description">
                    {toSentenceCase(course.contentType)} content
                  </p>
                </div>
              </header>

              {course.contentType === "video" ? (
                <div className="module-video-container">
                  <iframe
                    src={course.contentUrl}
                    title={course.title}
                    className="module-video-iframe"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : course.contentType === "document" ? (
                <div className="module-document-container">
                  <iframe
                    src={course.contentUrl}
                    title={course.title}
                    className="module-document-iframe"
                  />
                </div>
              ) : (
                <div className="documents-row-actions">
                  <a href={course.contentUrl} target="_blank" rel="noreferrer" className="button button-accent">
                    Open content
                  </a>
                </div>
              )}
            </article>
          ) : null}

          {/* ── Not assigned ── */}
          {!assignment ? (
            <article className="settings-card">
              <EmptyState
                title="Not assigned"
                description="This course is in the catalog but you do not have an assignment yet."
                ctaLabel="Back to learning"
                ctaHref="/learning"
              />
            </article>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
