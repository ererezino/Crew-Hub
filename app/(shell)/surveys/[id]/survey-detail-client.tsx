"use client";

import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useSurveyDetail } from "../../../../hooks/use-surveys";
import { toSentenceCase } from "../../../../lib/format-labels";
import type {
  SurveyAnswerValue,
  SurveyAnswers,
  SurveyQuestionDefinition,
  SurveyResponseMutationResponse
} from "../../../../types/surveys";

function surveyDetailSkeleton() {
  return (
    <section className="timeoff-skeleton-layout" aria-hidden="true">
      <div className="table-skeleton">
        <div className="table-skeleton-header" />
        {Array.from({ length: 4 }, (_, index) => (
          <div key={`survey-detail-skeleton-${index}`} className="table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

function buildInitialAnswers(questions: SurveyQuestionDefinition[]): SurveyAnswers {
  const answers: SurveyAnswers = {};

  for (const question of questions) {
    if (question.type === "text") {
      answers[question.id] = "";
      continue;
    }

    answers[question.id] = null;
  }

  return answers;
}

function normalizeStringAnswer(value: SurveyAnswerValue): string {
  if (typeof value === "string") {
    return value;
  }

  return "";
}

function normalizeNumberAnswer(value: SurveyAnswerValue): string {
  if (typeof value === "number") {
    return String(value);
  }

  return "";
}

function validateAnswers(
  questions: SurveyQuestionDefinition[],
  answers: SurveyAnswers
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const question of questions) {
    const value = answers[question.id] ?? null;

    if (question.required && (value === null || value === "")) {
      errors[question.id] = "This question is required.";
      continue;
    }

    if (value === null || value === "") {
      continue;
    }

    if (question.type === "rating") {
      if (typeof value !== "number") {
        errors[question.id] = "Rating must be a number.";
        continue;
      }

      const maxScale = question.scale ?? 10;

      if (value < 1 || value > maxScale) {
        errors[question.id] = `Rating must be between 1 and ${maxScale}.`;
      }
    }

    if ((question.type === "select" || question.type === "likert") && typeof value !== "string") {
      errors[question.id] = "Select a valid option.";
    }

    if (question.type === "text" && typeof value !== "string") {
      errors[question.id] = "Response must be text.";
    }
  }

  return errors;
}

export function SurveyDetailClient({ surveyId }: { surveyId: string }) {
  const detailQuery = useSurveyDetail(surveyId);
  const survey = detailQuery.data?.survey;

  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  useEffect(() => {
    if (!survey?.id) {
      return;
    }

    setAnswers(buildInitialAnswers(survey.questions));
    setTouched({});
    setSubmitError(null);
    setSubmitSuccess(false);
  }, [survey?.id, survey?.questions]);

  const validationErrors = useMemo(
    () => (survey ? validateAnswers(survey.questions, answers) : {}),
    [survey, answers]
  );

  const visibleErrors = useMemo(() => {
    const entries = Object.entries(validationErrors).filter(([questionId]) => touched[questionId]);
    return Object.fromEntries(entries);
  }, [touched, validationErrors]);

  const missingSurvey = !detailQuery.isLoading && (!survey || !survey.id);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!survey) {
      return;
    }

    const nextTouched: Record<string, boolean> = {};

    for (const question of survey.questions) {
      nextTouched[question.id] = true;
    }

    setTouched(nextTouched);
    setSubmitError(null);

    if (Object.keys(validationErrors).length > 0) {
      setSubmitError("Complete all required fields before submitting.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/v1/surveys/${survey.id}/respond`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ answers })
      });

      const payload = (await response.json()) as SurveyResponseMutationResponse;

      if (!response.ok || !payload.data?.response) {
        setSubmitError(payload.error?.message ?? "Unable to submit survey response.");
        return;
      }

      setSubmitSuccess(true);
      detailQuery.refresh();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to submit survey response.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title={survey?.title && survey.title.length > 0 ? survey.title : "Survey"}
        description="Share candid feedback to help improve team operations in Crew Hub."
      />

      {detailQuery.isLoading ? surveyDetailSkeleton() : null}

      {!detailQuery.isLoading && detailQuery.errorMessage ? (
        <section className="error-state">
          <EmptyState
            title="Survey is unavailable"
            description={detailQuery.errorMessage}
            ctaLabel="Back to surveys"
            ctaHref="/surveys"
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => detailQuery.refresh()}
          >
            Retry
          </button>
        </section>
      ) : null}

      {!detailQuery.isLoading && !detailQuery.errorMessage && missingSurvey ? (
        <EmptyState
          title="Survey not found"
          description="This survey may have been archived or you may not have access."
          ctaLabel="Back to surveys"
          ctaHref="/surveys"
        />
      ) : null}

      {!detailQuery.isLoading && !detailQuery.errorMessage && survey?.id ? (
        submitSuccess || detailQuery.data?.hasResponded ? (
          <EmptyState
            title="Response submitted"
            description="Thanks for sharing feedback. You can return to your survey queue."
            ctaLabel="Back to surveys"
            ctaHref="/surveys"
          />
        ) : (
          <form className="settings-layout" onSubmit={handleSubmit}>
            <article className="settings-card">
              <header className="announcement-item-header">
                <div>
                  <h2 className="section-title">{survey.title}</h2>
                  <p className="settings-card-description">
                    {survey.description || "No description provided."}
                  </p>
                </div>
                <div className="announcement-item-status">
                  <StatusBadge tone="info">{toSentenceCase(survey.type)}</StatusBadge>
                  <StatusBadge tone="pending">{survey.questions.length} questions</StatusBadge>
                </div>
              </header>
            </article>

            {survey.questions.map((question, index) => {
              const fieldError = visibleErrors[question.id];
              const value = answers[question.id] ?? null;

              return (
                <article key={question.id} className="settings-card">
                  <label className="form-field" htmlFor={`survey-question-${question.id}`}>
                    <span className="form-label">
                      {index + 1}. {question.text}
                      {question.required ? " *" : ""}
                    </span>

                    {question.type === "rating" ? (
                      <input
                        id={`survey-question-${question.id}`}
                        type="number"
                        className={`form-input numeric ${fieldError ? "form-input-error" : ""}`}
                        min={1}
                        max={question.scale ?? 10}
                        value={normalizeNumberAnswer(value)}
                        onBlur={() =>
                          setTouched((currentValue) => ({
                            ...currentValue,
                            [question.id]: true
                          }))
                        }
                        onChange={(event) => {
                          const nextValue = event.currentTarget.value;

                          setAnswers((currentValue) => ({
                            ...currentValue,
                            [question.id]: nextValue.length === 0 ? null : Number.parseInt(nextValue, 10)
                          }));
                        }}
                      />
                    ) : null}

                    {question.type === "text" ? (
                      <textarea
                        id={`survey-question-${question.id}`}
                        className={`form-input ${fieldError ? "form-input-error" : ""}`}
                        rows={4}
                        value={normalizeStringAnswer(value)}
                        onBlur={() =>
                          setTouched((currentValue) => ({
                            ...currentValue,
                            [question.id]: true
                          }))
                        }
                        onChange={(event) => {
                          const nextValue = event.currentTarget.value;

                          setAnswers((currentValue) => ({
                            ...currentValue,
                            [question.id]: nextValue
                          }));
                        }}
                      />
                    ) : null}

                    {(question.type === "select" || question.type === "likert") ? (
                      <select
                        id={`survey-question-${question.id}`}
                        className={`form-input ${fieldError ? "form-input-error" : ""}`}
                        value={normalizeStringAnswer(value)}
                        onBlur={() =>
                          setTouched((currentValue) => ({
                            ...currentValue,
                            [question.id]: true
                          }))
                        }
                        onChange={(event) => {
                          const nextValue = event.currentTarget.value;

                          setAnswers((currentValue) => ({
                            ...currentValue,
                            [question.id]: nextValue.length > 0 ? nextValue : null
                          }));
                        }}
                      >
                        <option value="">Select an option</option>
                        {question.options.map((option) => (
                          <option key={`${question.id}-${option}`} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </label>

                  {fieldError ? <p className="form-field-error">{fieldError}</p> : null}
                </article>
              );
            })}

            {submitError ? <p className="form-submit-error">{submitError}</p> : null}

            <div className="settings-actions">
              <button type="submit" className="button button-accent" disabled={isSubmitting}>
                {isSubmitting ? "Submitting..." : "Submit response"}
              </button>
            </div>
          </form>
        )
      ) : null}
    </>
  );
}
