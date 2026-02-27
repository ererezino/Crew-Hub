"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { RatingCircles } from "../../../components/shared/rating-circles";
import { StatusBadge } from "../../../components/shared/status-badge";
import { countryFlagFromCode, countryNameFromCode } from "../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import {
  labelForReviewAssignmentStatus,
  labelForReviewCycleStatus,
  toneForReviewAssignmentStatus,
  toneForReviewCycleStatus
} from "../../../lib/performance/reviews";
import { usePerformanceOverview } from "../../../hooks/use-performance";
import type {
  ReviewAnswerValue,
  ReviewAnswers,
  ReviewAssignmentSummary,
  SaveReviewResponseApiResponse,
  SaveReviewResponsePayload
} from "../../../types/performance";

type SortDirection = "asc" | "desc";
type ToastVariant = "success" | "error" | "info";
type ToastMessage = {
  id: string;
  variant: ToastVariant;
  message: string;
};

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createEmptyAnswer(): ReviewAnswerValue {
  return {
    rating: null,
    text: null
  };
}

function initializeAnswers(assignment: ReviewAssignmentSummary | null, responseType: "self" | "manager"): ReviewAnswers {
  if (!assignment) {
    return {};
  }

  const existingAnswers =
    responseType === "self"
      ? assignment.selfResponse?.answers ?? {}
      : assignment.managerResponse?.answers ?? {};
  const initialized: ReviewAnswers = {};

  for (const section of assignment.templateSections) {
    for (const question of section.questions) {
      const answer = existingAnswers[question.id] ?? createEmptyAnswer();

      initialized[question.id] = {
        rating: answer.rating ?? null,
        text: answer.text ?? null
      };
    }
  }

  return initialized;
}

function requiredQuestionErrors(
  assignment: ReviewAssignmentSummary | null,
  answers: ReviewAnswers
): Record<string, string> {
  if (!assignment) {
    return {};
  }

  const errors: Record<string, string> = {};

  for (const section of assignment.templateSections) {
    for (const question of section.questions) {
      if (!question.required) {
        continue;
      }

      const answer = answers[question.id];

      if (question.type === "rating") {
        const ratingValue = answer?.rating;

        if (typeof ratingValue !== "number" || ratingValue < 1 || ratingValue > 5) {
          errors[question.id] = "Rating is required.";
        }
      } else {
        const textValue = answer?.text?.trim() ?? "";

        if (!textValue) {
          errors[question.id] = "Response is required.";
        }
      }
    }
  }

  return errors;
}

function sectionScoreSummary(answers: ReviewAnswers, questionIds: string[]): string {
  const ratings = questionIds
    .map((questionId) => answers[questionId]?.rating)
    .filter((value): value is number => typeof value === "number");

  if (ratings.length === 0) {
    return "--";
  }

  const average = ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
  return average.toFixed(1);
}

function performanceSkeleton() {
  return (
    <section className="performance-skeleton" aria-hidden="true">
      <div className="performance-skeleton-header" />
      <div className="performance-skeleton-card" />
      <div className="performance-skeleton-form" />
      <div className="performance-skeleton-table" />
    </section>
  );
}

export function PerformanceClient({ canManagePerformance }: { canManagePerformance: boolean }) {
  const overviewQuery = usePerformanceOverview();
  const refreshOverview = overviewQuery.refresh;
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const [selfAnswers, setSelfAnswers] = useState<ReviewAnswers>({});
  const [selfDirty, setSelfDirty] = useState(false);
  const [isSavingSelf, setIsSavingSelf] = useState(false);
  const [isSubmittingSelf, setIsSubmittingSelf] = useState(false);

  const [selectedManagerAssignmentId, setSelectedManagerAssignmentId] = useState<string | null>(null);
  const [managerAnswers, setManagerAnswers] = useState<ReviewAnswers>({});
  const [managerDirty, setManagerDirty] = useState(false);
  const [isSavingManager, setIsSavingManager] = useState(false);
  const [isSubmittingManager, setIsSubmittingManager] = useState(false);

  const [pastSortDirection, setPastSortDirection] = useState<SortDirection>("desc");

  const activeCycle = overviewQuery.data?.activeCycle ?? null;
  const selfAssignment = overviewQuery.data?.selfAssignment ?? null;
  const managerAssignments = useMemo(
    () => overviewQuery.data?.managerAssignments ?? [],
    [overviewQuery.data?.managerAssignments]
  );
  const selectedManagerAssignment = useMemo(
    () =>
      managerAssignments.find((assignment) => assignment.id === selectedManagerAssignmentId) ??
      managerAssignments[0] ??
      null,
    [managerAssignments, selectedManagerAssignmentId]
  );

  const pastAssignments = useMemo(() => {
    const rows = overviewQuery.data?.pastAssignments ?? [];

    return [...rows].sort((left, right) => {
      const comparison = left.updatedAt.localeCompare(right.updatedAt);
      return pastSortDirection === "asc" ? comparison : comparison * -1;
    });
  }, [overviewQuery.data?.pastAssignments, pastSortDirection]);

  const dismissToast = useCallback((toastId: string) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
  }, []);

  const showToast = useCallback((variant: ToastVariant, message: string) => {
    const toastId = createToastId();
    setToasts((currentToasts) => [...currentToasts, { id: toastId, variant, message }]);

    window.setTimeout(() => {
      dismissToast(toastId);
    }, 4000);
  }, [dismissToast]);

  useEffect(() => {
    setSelfAnswers(initializeAnswers(selfAssignment, "self"));
    setSelfDirty(false);
  }, [selfAssignment]);

  useEffect(() => {
    if (!selectedManagerAssignmentId && managerAssignments.length > 0) {
      setSelectedManagerAssignmentId(managerAssignments[0].id);
    }
  }, [managerAssignments, selectedManagerAssignmentId]);

  useEffect(() => {
    setManagerAnswers(initializeAnswers(selectedManagerAssignment, "manager"));
    setManagerDirty(false);
  }, [selectedManagerAssignment]);

  const saveResponse = useCallback(
    async ({
      assignment,
      responseType,
      answers,
      submit
    }: {
      assignment: ReviewAssignmentSummary;
      responseType: "self" | "manager";
      answers: ReviewAnswers;
      submit: boolean;
    }): Promise<boolean> => {
      const payload: SaveReviewResponsePayload = {
        assignmentId: assignment.id,
        responseType,
        answers,
        submit
      };

      const response = await fetch("/api/v1/performance/responses", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const body = (await response.json()) as SaveReviewResponseApiResponse;

      if (!response.ok || !body.data) {
        showToast("error", body.error?.message ?? "Unable to save review response.");
        return false;
      }

      if (submit) {
        showToast(
          "success",
          responseType === "self"
            ? "Self review submitted."
            : "Manager review submitted."
        );
      } else {
        showToast("info", "Draft auto-saved.");
      }

      refreshOverview();
      return true;
    },
    [refreshOverview, showToast]
  );

  useEffect(() => {
    if (!selfDirty || !selfAssignment || isSubmittingSelf) {
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      setIsSavingSelf(true);

      try {
        const saved = await saveResponse({
          assignment: selfAssignment,
          responseType: "self",
          answers: selfAnswers,
          submit: false
        });

        if (saved) {
          setSelfDirty(false);
        }
      } finally {
        setIsSavingSelf(false);
      }
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [selfDirty, selfAssignment, selfAnswers, isSubmittingSelf, saveResponse]);

  useEffect(() => {
    if (!managerDirty || !selectedManagerAssignment || isSubmittingManager) {
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      setIsSavingManager(true);

      try {
        const saved = await saveResponse({
          assignment: selectedManagerAssignment,
          responseType: "manager",
          answers: managerAnswers,
          submit: false
        });

        if (saved) {
          setManagerDirty(false);
        }
      } finally {
        setIsSavingManager(false);
      }
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [managerDirty, selectedManagerAssignment, managerAnswers, isSubmittingManager, saveResponse]);

  const selfErrors = requiredQuestionErrors(selfAssignment, selfAnswers);
  const managerErrors = requiredQuestionErrors(selectedManagerAssignment, managerAnswers);

  const submitSelfReview = async () => {
    if (!selfAssignment) {
      return;
    }

    if (Object.keys(selfErrors).length > 0) {
      showToast("error", "Complete all required self review fields before submitting.");
      return;
    }

    setIsSubmittingSelf(true);

    try {
      const saved = await saveResponse({
        assignment: selfAssignment,
        responseType: "self",
        answers: selfAnswers,
        submit: true
      });

      if (saved) {
        setSelfDirty(false);
      }
    } finally {
      setIsSubmittingSelf(false);
    }
  };

  const submitManagerReview = async () => {
    if (!selectedManagerAssignment) {
      return;
    }

    if (Object.keys(managerErrors).length > 0) {
      showToast("error", "Complete all required manager review fields before submitting.");
      return;
    }

    setIsSubmittingManager(true);

    try {
      const saved = await saveResponse({
        assignment: selectedManagerAssignment,
        responseType: "manager",
        answers: managerAnswers,
        submit: true
      });

      if (saved) {
        setManagerDirty(false);
      }
    } finally {
      setIsSubmittingManager(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Performance"
        description="Track active review cycles, complete self reviews, and submit manager feedback."
        actions={
          canManagePerformance ? (
            <Link className="button button-subtle" href="/performance/admin">
              Performance admin
            </Link>
          ) : null
        }
      />

      {overviewQuery.isLoading ? performanceSkeleton() : null}

      {!overviewQuery.isLoading && overviewQuery.errorMessage ? (
        <section className="settings-layout">
          <EmptyState
            title="Performance data unavailable"
            description={overviewQuery.errorMessage}
            ctaLabel="Retry"
            ctaHref="/performance"
          />
          <button type="button" className="button button-accent" onClick={overviewQuery.refresh}>
            Retry now
          </button>
        </section>
      ) : null}

      {!overviewQuery.isLoading && !overviewQuery.errorMessage ? (
        <section className="settings-layout" aria-label="Performance overview">
          <article className="settings-card">
            <h2 className="section-title">Active Cycle</h2>
            {activeCycle ? (
              <>
                <div className="performance-cycle-header">
                  <div>
                    <p className="section-title">{activeCycle.name}</p>
                    <p className="settings-card-description">
                      {activeCycle.type} review cycle
                    </p>
                  </div>
                  <StatusBadge tone={toneForReviewCycleStatus(activeCycle.status)}>
                    {labelForReviewCycleStatus(activeCycle.status)}
                  </StatusBadge>
                </div>
                <div className="performance-cycle-meta">
                  <p title={formatDateTimeTooltip(activeCycle.startDate)}>
                    Start: <span className="numeric">{formatRelativeTime(activeCycle.startDate)}</span>
                  </p>
                  <p title={formatDateTimeTooltip(activeCycle.endDate)}>
                    End: <span className="numeric">{formatRelativeTime(activeCycle.endDate)}</span>
                  </p>
                  <p
                    title={
                      activeCycle.selfReviewDeadline
                        ? formatDateTimeTooltip(activeCycle.selfReviewDeadline)
                        : "--"
                    }
                  >
                    Self deadline:{" "}
                    <span className="numeric">
                      {activeCycle.selfReviewDeadline
                        ? formatRelativeTime(activeCycle.selfReviewDeadline)
                        : "--"}
                    </span>
                  </p>
                  <p
                    title={
                      activeCycle.managerReviewDeadline
                        ? formatDateTimeTooltip(activeCycle.managerReviewDeadline)
                        : "--"
                    }
                  >
                    Manager deadline:{" "}
                    <span className="numeric">
                      {activeCycle.managerReviewDeadline
                        ? formatRelativeTime(activeCycle.managerReviewDeadline)
                        : "--"}
                    </span>
                  </p>
                </div>
              </>
            ) : (
              <EmptyState
                title="No active cycle"
                description="No active performance cycle is currently running."
                ctaLabel={canManagePerformance ? "Open admin" : "Back to dashboard"}
                ctaHref={canManagePerformance ? "/performance/admin" : "/dashboard"}
              />
            )}
          </article>

          <article className="settings-card">
            <div className="performance-form-header">
              <h2 className="section-title">Self Review</h2>
              {isSavingSelf ? (
                <StatusBadge tone="processing">Autosaving...</StatusBadge>
              ) : selfDirty ? (
                <StatusBadge tone="pending">Unsaved changes</StatusBadge>
              ) : (
                <StatusBadge tone="draft">Saved</StatusBadge>
              )}
            </div>

            {!selfAssignment ? (
              <EmptyState
                title="No self review assigned"
                description="You do not have an active self review assignment right now."
                ctaLabel="Back to dashboard"
                ctaHref="/dashboard"
              />
            ) : (
              <>
                <div className="performance-assignment-meta">
                  <p>
                    Reviewer: <span>{selfAssignment.reviewerName}</span>
                  </p>
                  <p title={selfAssignment.dueAt ? formatDateTimeTooltip(selfAssignment.dueAt) : "--"}>
                    Due:{" "}
                    <span className="numeric">
                      {selfAssignment.dueAt ? formatRelativeTime(selfAssignment.dueAt) : "--"}
                    </span>
                  </p>
                  <StatusBadge tone={toneForReviewAssignmentStatus(selfAssignment.status)}>
                    {labelForReviewAssignmentStatus(selfAssignment.status)}
                  </StatusBadge>
                </div>

                {selfAssignment.templateSections.map((section) => (
                  <section key={section.id} className="performance-section-card">
                    <div className="performance-section-header">
                      <div>
                        <h3 className="section-title">{section.title}</h3>
                        <p className="settings-card-description">{section.description}</p>
                      </div>
                      <p className="numeric">
                        Avg score:{" "}
                        {sectionScoreSummary(
                          selfAnswers,
                          section.questions.map((question) => question.id)
                        )}
                      </p>
                    </div>

                    <div className="performance-question-list">
                      {section.questions.map((question) => (
                        <article key={question.id} className="performance-question-card">
                          <div className="performance-question-header">
                            <p className="form-label">{question.title}</p>
                            {question.required ? (
                              <span className="performance-required">Required</span>
                            ) : (
                              <span className="settings-card-description">Optional</span>
                            )}
                          </div>
                          <p className="settings-card-description">{question.prompt}</p>

                          {question.type === "rating" ? (
                            <RatingCircles
                              id={`self-${question.id}`}
                              value={selfAnswers[question.id]?.rating ?? null}
                              onChange={(ratingValue) => {
                                setSelfAnswers((currentAnswers) => ({
                                  ...currentAnswers,
                                  [question.id]: {
                                    rating: ratingValue,
                                    text: currentAnswers[question.id]?.text ?? null
                                  }
                                }));
                                setSelfDirty(true);
                              }}
                            />
                          ) : (
                            <textarea
                              className={
                                selfErrors[question.id]
                                  ? "form-input form-input-error"
                                  : "form-input"
                              }
                              rows={4}
                              maxLength={question.maxLength ?? 4000}
                              value={selfAnswers[question.id]?.text ?? ""}
                              onChange={(event) => {
                                const nextText = event.currentTarget.value;

                                setSelfAnswers((currentAnswers) => ({
                                  ...currentAnswers,
                                  [question.id]: {
                                    rating: currentAnswers[question.id]?.rating ?? null,
                                    text: nextText
                                  }
                                }));
                                setSelfDirty(true);
                              }}
                            />
                          )}

                          {selfErrors[question.id] ? (
                            <p className="form-field-error">{selfErrors[question.id]}</p>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  </section>
                ))}

                <div className="settings-actions">
                  <button
                    type="button"
                    className="button button-accent"
                    disabled={isSubmittingSelf}
                    onClick={() => {
                      void submitSelfReview();
                    }}
                  >
                    {isSubmittingSelf ? "Submitting..." : "Submit self review"}
                  </button>
                </div>
              </>
            )}
          </article>

          <article className="settings-card">
            <h2 className="section-title">Manager Reviews</h2>
            {managerAssignments.length === 0 ? (
              <EmptyState
                title="No manager reviews assigned"
                description="You currently have no direct report reviews assigned in active cycles."
                ctaLabel="Back to dashboard"
                ctaHref="/dashboard"
              />
            ) : (
              <>
                <section className="data-table-container" aria-label="Manager review assignments">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Department</th>
                        <th>Country</th>
                        <th>Status</th>
                        <th>Due</th>
                        <th className="table-action-column">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {managerAssignments.map((assignment) => (
                        <tr
                          key={assignment.id}
                          className={
                            selectedManagerAssignmentId === assignment.id
                              ? "data-table-row performance-row-active"
                              : "data-table-row"
                          }
                        >
                          <td>{assignment.employeeName}</td>
                          <td>{assignment.employeeDepartment ?? "--"}</td>
                          <td>
                            <p className="country-chip">
                              <span>{countryFlagFromCode(assignment.employeeCountryCode)}</span>
                              <span>{countryNameFromCode(assignment.employeeCountryCode)}</span>
                            </p>
                          </td>
                          <td>
                            <StatusBadge tone={toneForReviewAssignmentStatus(assignment.status)}>
                              {labelForReviewAssignmentStatus(assignment.status)}
                            </StatusBadge>
                          </td>
                          <td title={assignment.dueAt ? formatDateTimeTooltip(assignment.dueAt) : "--"}>
                            {assignment.dueAt ? formatRelativeTime(assignment.dueAt) : "--"}
                          </td>
                          <td className="table-row-action-cell">
                            <button
                              type="button"
                              className="table-row-action"
                              onClick={() => setSelectedManagerAssignmentId(assignment.id)}
                            >
                              {selectedManagerAssignmentId === assignment.id ? "Selected" : "Review"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>

                {selectedManagerAssignment ? (
                  <section className="performance-manager-grid">
                    <article className="settings-card performance-side-card">
                      <h3 className="section-title">Self Review (Read-only)</h3>
                      {selectedManagerAssignment.selfResponse ? (
                        selectedManagerAssignment.templateSections.map((section) => (
                          <section key={`${selectedManagerAssignment.id}-self-${section.id}`}>
                            <p className="form-label">{section.title}</p>
                            <ul className="performance-read-list">
                              {section.questions.map((question) => {
                                const answer =
                                  selectedManagerAssignment.selfResponse?.answers[question.id];

                                return (
                                  <li key={`${selectedManagerAssignment.id}-self-${question.id}`}>
                                    <p>{question.title}</p>
                                    {question.type === "rating" ? (
                                      <RatingCircles
                                        id={`self-read-${question.id}`}
                                        value={answer?.rating ?? null}
                                        onChange={() => undefined}
                                        readOnly
                                      />
                                    ) : (
                                      <p className="settings-card-description">
                                        {answer?.text?.trim() || "--"}
                                      </p>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          </section>
                        ))
                      ) : (
                        <EmptyState
                          title="Self review not submitted"
                          description="This employee has not submitted their self review yet."
                          ctaLabel="Back to top"
                          ctaHref="/performance"
                        />
                      )}
                    </article>

                    <article className="settings-card performance-side-card">
                      <div className="performance-form-header">
                        <h3 className="section-title">Manager Review</h3>
                        {isSavingManager ? (
                          <StatusBadge tone="processing">Autosaving...</StatusBadge>
                        ) : managerDirty ? (
                          <StatusBadge tone="pending">Unsaved changes</StatusBadge>
                        ) : (
                          <StatusBadge tone="draft">Saved</StatusBadge>
                        )}
                      </div>

                      {selectedManagerAssignment.templateSections.map((section) => (
                        <section key={`${selectedManagerAssignment.id}-manager-${section.id}`}>
                          <div className="performance-section-header">
                            <div>
                              <h4 className="section-title">{section.title}</h4>
                              <p className="settings-card-description">{section.description}</p>
                            </div>
                            <p className="numeric">
                              Avg score:{" "}
                              {sectionScoreSummary(
                                managerAnswers,
                                section.questions.map((question) => question.id)
                              )}
                            </p>
                          </div>

                          <div className="performance-question-list">
                            {section.questions.map((question) => (
                              <article key={`${selectedManagerAssignment.id}-${question.id}`} className="performance-question-card">
                                <div className="performance-question-header">
                                  <p className="form-label">{question.title}</p>
                                  {question.required ? (
                                    <span className="performance-required">Required</span>
                                  ) : (
                                    <span className="settings-card-description">Optional</span>
                                  )}
                                </div>
                                <p className="settings-card-description">{question.prompt}</p>

                                {question.type === "rating" ? (
                                  <RatingCircles
                                    id={`manager-${question.id}`}
                                    value={managerAnswers[question.id]?.rating ?? null}
                                    onChange={(ratingValue) => {
                                      setManagerAnswers((currentAnswers) => ({
                                        ...currentAnswers,
                                        [question.id]: {
                                          rating: ratingValue,
                                          text: currentAnswers[question.id]?.text ?? null
                                        }
                                      }));
                                      setManagerDirty(true);
                                    }}
                                  />
                                ) : (
                                  <textarea
                                    className={
                                      managerErrors[question.id]
                                        ? "form-input form-input-error"
                                        : "form-input"
                                    }
                                    rows={4}
                                    maxLength={question.maxLength ?? 4000}
                                    value={managerAnswers[question.id]?.text ?? ""}
                                    onChange={(event) => {
                                      const nextText = event.currentTarget.value;

                                      setManagerAnswers((currentAnswers) => ({
                                        ...currentAnswers,
                                        [question.id]: {
                                          rating: currentAnswers[question.id]?.rating ?? null,
                                          text: nextText
                                        }
                                      }));
                                      setManagerDirty(true);
                                    }}
                                  />
                                )}

                                {managerErrors[question.id] ? (
                                  <p className="form-field-error">{managerErrors[question.id]}</p>
                                ) : null}
                              </article>
                            ))}
                          </div>
                        </section>
                      ))}

                      <div className="settings-actions">
                        <button
                          type="button"
                          className="button button-accent"
                          disabled={isSubmittingManager}
                          onClick={() => {
                            void submitManagerReview();
                          }}
                        >
                          {isSubmittingManager ? "Submitting..." : "Submit manager review"}
                        </button>
                      </div>
                    </article>
                  </section>
                ) : null}
              </>
            )}
          </article>

          <article className="settings-card">
            <h2 className="section-title">Past Reviews</h2>
            <section className="data-table-container" aria-label="Past performance reviews">
              {pastAssignments.length === 0 ? (
                <EmptyState
                  title="No completed reviews yet"
                  description="Completed review cycles will appear here."
                  ctaLabel="Back to dashboard"
                  ctaHref="/dashboard"
                />
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>
                        <button
                          type="button"
                          className="table-sort-trigger"
                          onClick={() =>
                            setPastSortDirection((current) => (current === "asc" ? "desc" : "asc"))
                          }
                        >
                          Cycle
                          <span className="numeric">{pastSortDirection === "asc" ? "↑" : "↓"}</span>
                        </button>
                      </th>
                      <th>Reviewer</th>
                      <th>Status</th>
                      <th>Updated</th>
                      <th className="table-action-column">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pastAssignments.map((assignment) => (
                      <tr key={`past-${assignment.id}`} className="data-table-row">
                        <td>{assignment.cycleName}</td>
                        <td>{assignment.reviewerName}</td>
                        <td>
                          <StatusBadge tone={toneForReviewAssignmentStatus(assignment.status)}>
                            {labelForReviewAssignmentStatus(assignment.status)}
                          </StatusBadge>
                        </td>
                        <td title={formatDateTimeTooltip(assignment.updatedAt)}>
                          {formatRelativeTime(assignment.updatedAt)}
                        </td>
                        <td className="table-row-action-cell">
                          <button
                            type="button"
                            className="table-row-action"
                            onClick={() => {
                              showToast("info", `Cycle: ${assignment.cycleName}`);
                            }}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </article>
        </section>
      ) : null}

      {toasts.length > 0 ? (
        <section className="toast-region" aria-live="polite" aria-label="Performance toasts">
          {toasts.map((toast) => (
            <article key={toast.id} className={`toast-message toast-message-${toast.variant}`}>
              <p>{toast.message}</p>
              <button
                type="button"
                className="toast-dismiss"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss toast"
              >
                Dismiss
              </button>
            </article>
          ))}
        </section>
      ) : null}
    </>
  );
}
