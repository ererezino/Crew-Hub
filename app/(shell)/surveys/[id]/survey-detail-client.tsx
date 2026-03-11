"use client";

import { useTranslations } from "next-intl";
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
  answers: SurveyAnswers,
  t: (key: string, params?: Record<string, unknown>) => string
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const question of questions) {
    const value = answers[question.id] ?? null;

    if (question.required && (value === null || value === "")) {
      errors[question.id] = t("requiredError");
      continue;
    }

    if (value === null || value === "") {
      continue;
    }

    if (question.type === "rating") {
      if (typeof value !== "number") {
        errors[question.id] = t("ratingMustBeNumber");
        continue;
      }

      const maxScale = question.scale ?? 10;

      if (value < 1 || value > maxScale) {
        errors[question.id] = t("ratingRange", { max: maxScale });
      }
    }

    if ((question.type === "select" || question.type === "likert") && typeof value !== "string") {
      errors[question.id] = t("selectValidOption");
    }

    if (question.type === "text" && typeof value !== "string") {
      errors[question.id] = t("textRequired");
    }
  }

  return errors;
}

export function SurveyDetailClient({ surveyId }: { surveyId: string }) {
  const t = useTranslations('surveyDetail');
  const tCommon = useTranslations('common');
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
    () => (survey ? validateAnswers(survey.questions, answers, t as (key: string, params?: Record<string, unknown>) => string) : {}),
    [survey, answers, t]
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
      setSubmitError(t('completeRequired'));
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
        setSubmitError(payload.error?.message ?? t('unableToSubmit'));
        return;
      }

      setSubmitSuccess(true);
      detailQuery.refresh();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t('unableToSubmit'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title={survey?.title && survey.title.length > 0 ? survey.title : t('fallbackTitle')}
        description={t('description')}
      />

      {detailQuery.isLoading ? surveyDetailSkeleton() : null}

      {!detailQuery.isLoading && detailQuery.errorMessage ? (
        <>
          <EmptyState
            title={t('unavailable')}
            description={detailQuery.errorMessage}
            ctaLabel={t('backToSurveys')}
            ctaHref="/surveys"
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => detailQuery.refresh()}
          >
            {tCommon('retry')}
          </button>
        </>
      ) : null}

      {!detailQuery.isLoading && !detailQuery.errorMessage && missingSurvey ? (
        <EmptyState
          title={t('notFound')}
          description={t('notFoundDescription')}
          ctaLabel={t('backToSurveys')}
          ctaHref="/surveys"
        />
      ) : null}

      {!detailQuery.isLoading && !detailQuery.errorMessage && survey?.id ? (
        submitSuccess || detailQuery.data?.hasResponded ? (
          <EmptyState
            title={t('responseSubmitted')}
            description={t('responseSubmittedDescription')}
            ctaLabel={t('backToSurveys')}
            ctaHref="/surveys"
          />
        ) : (
          <form className="settings-layout" onSubmit={handleSubmit}>
            <article className="settings-card">
              <header className="announcement-item-header">
                <div>
                  <h2 className="section-title">{survey.title}</h2>
                  <p className="settings-card-description">
                    {survey.description || t('noDescription')}
                  </p>
                </div>
                <div className="announcement-item-status">
                  <StatusBadge tone="info">{toSentenceCase(survey.type)}</StatusBadge>
                  <StatusBadge tone="pending">{t('questionCount', { count: survey.questions.length })}</StatusBadge>
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
                        <option value="">{t('selectOption')}</option>
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
                {isSubmitting ? t('submitting') : t('submitResponse')}
              </button>
            </div>
          </form>
        )
      ) : null}
    </>
  );
}
