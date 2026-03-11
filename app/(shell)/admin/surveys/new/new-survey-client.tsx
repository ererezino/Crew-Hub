"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { PageHeader } from "../../../../../components/shared/page-header";
import type {
  SurveyMutationResponse,
  SurveyQuestionType,
  SurveyType
} from "../../../../../types/surveys";

type QuestionFormValue = {
  id: string;
  text: string;
  type: SurveyQuestionType;
  required: boolean;
  scale: string;
  optionsText: string;
};

type SurveyFormValues = {
  title: string;
  description: string;
  type: SurveyType;
  isAnonymous: boolean;
  minResponsesForResults: string;
  status: "draft" | "active";
  startDate: string;
  endDate: string;
  recurrence: "" | "weekly" | "monthly" | "quarterly";
  departments: string;
  employmentTypes: string;
  countries: string;
  questions: QuestionFormValue[];
};

function createQuestionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `q_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  }

  return `q_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function parseCommaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function buildDefaultQuestion(type: SurveyQuestionType = "rating"): QuestionFormValue {
  return {
    id: createQuestionId(),
    text: "",
    type,
    required: true,
    scale: "10",
    optionsText: type === "likert" ? "strongly_disagree,disagree,neutral,agree,strongly_agree" : ""
  };
}

const DEFAULT_FORM: SurveyFormValues = {
  title: "",
  description: "",
  type: "engagement",
  isAnonymous: true,
  minResponsesForResults: "5",
  status: "draft",
  startDate: "",
  endDate: "",
  recurrence: "",
  departments: "",
  employmentTypes: "",
  countries: "",
  questions: [buildDefaultQuestion("rating"), buildDefaultQuestion("text")]
};

export function NewSurveyClient() {
  const router = useRouter();
  const t = useTranslations('newSurvey');

  const [formValues, setFormValues] = useState<SurveyFormValues>(DEFAULT_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  const validationErrors = useMemo(() => {
    const errors: Record<string, string> = {};

    if (formValues.title.trim().length === 0) {
      errors.title = t('titleRequired');
    }

    const minResponses = Number.parseInt(formValues.minResponsesForResults, 10);

    if (!Number.isInteger(minResponses) || minResponses < 1 || minResponses > 100) {
      errors.minResponsesForResults = t('minResponsesError');
    }

    if (formValues.startDate && formValues.endDate && formValues.endDate < formValues.startDate) {
      errors.endDate = t('endDateError');
    }

    if (formValues.questions.length === 0) {
      errors.questions = t('questionsRequired');
    }

    formValues.questions.forEach((question, index) => {
      if (question.text.trim().length === 0) {
        errors[`questions.${index}.text`] = t('promptRequired');
      }

      if (question.type === "rating") {
        const scaleValue = Number.parseInt(question.scale, 10);

        if (!Number.isInteger(scaleValue) || scaleValue < 2 || scaleValue > 10) {
          errors[`questions.${index}.scale`] = t('scaleMaxError');
        }
      }

      if (question.type === "select" || question.type === "likert") {
        const options = parseCommaSeparated(question.optionsText);

        if (options.length === 0) {
          errors[`questions.${index}.optionsText`] = t('optionsRequired');
        }
      }
    });

    return errors;
  }, [formValues, t]);

  const hasValidationErrors = Object.keys(validationErrors).length > 0;

  const updateQuestion = (
    index: number,
    updater: (question: QuestionFormValue) => QuestionFormValue
  ) => {
    setFormValues((currentValue) => ({
      ...currentValue,
      questions: currentValue.questions.map((question, questionIndex) =>
        questionIndex === index ? updater(question) : question
      )
    }));
  };

  const addQuestion = (type: SurveyQuestionType) => {
    setFormValues((currentValue) => ({
      ...currentValue,
      questions: [...currentValue.questions, buildDefaultQuestion(type)]
    }));
  };

  const removeQuestion = (index: number) => {
    setFormValues((currentValue) => ({
      ...currentValue,
      questions: currentValue.questions.filter((_, questionIndex) => questionIndex !== index)
    }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);
    setSubmitMessage(null);

    if (hasValidationErrors) {
      setSubmitError(t('validationError'));
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        title: formValues.title.trim(),
        description: formValues.description.trim() || undefined,
        type: formValues.type,
        isAnonymous: formValues.isAnonymous,
        minResponsesForResults: Number.parseInt(formValues.minResponsesForResults, 10),
        targetAudience: {
          departments: parseCommaSeparated(formValues.departments),
          employmentTypes: parseCommaSeparated(formValues.employmentTypes),
          countries: parseCommaSeparated(formValues.countries).map((country) => country.toUpperCase())
        },
        status: formValues.status,
        startDate: formValues.startDate || undefined,
        endDate: formValues.endDate || undefined,
        recurrence: formValues.recurrence || undefined,
        questions: formValues.questions.map((question) => ({
          id: question.id,
          text: question.text.trim(),
          type: question.type,
          required: question.required,
          scale:
            question.type === "rating" ? Number.parseInt(question.scale, 10) : undefined,
          options:
            question.type === "select" || question.type === "likert"
              ? parseCommaSeparated(question.optionsText)
              : undefined
        }))
      };

      const response = await fetch("/api/v1/surveys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const body = (await response.json()) as SurveyMutationResponse;

      if (!response.ok || !body.data?.survey) {
        setSubmitError(body.error?.message ?? t('errorCreate'));
        return;
      }

      setSubmitMessage(t('successCreate'));
      router.push("/admin/surveys");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t('errorCreate'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Link href="/admin/surveys" className="button">
            {t('backToAdmin')}
          </Link>
        }
      />

      <form className="settings-layout" onSubmit={handleSubmit}>
        <article className="settings-card">
          <h2 className="section-title">{t('detailsTitle')}</h2>

          <label className="form-field">
            <span className="form-label">{t('titleLabel')}</span>
            <input
              type="text"
              className={`form-input ${validationErrors.title ? "form-input-error" : ""}`}
              value={formValues.title}
              onChange={(event) =>
                setFormValues((currentValue) => ({
                  ...currentValue,
                  title: event.currentTarget.value
                }))
              }
            />
            {validationErrors.title ? <p className="form-field-error">{validationErrors.title}</p> : null}
          </label>

          <label className="form-field">
            <span className="form-label">{t('descriptionLabel')}</span>
            <textarea
              className="form-input"
              rows={4}
              value={formValues.description}
              onChange={(event) =>
                setFormValues((currentValue) => ({
                  ...currentValue,
                  description: event.currentTarget.value
                }))
              }
            />
          </label>

          <div className="audit-filters">
            <label className="form-field">
              <span className="form-label">{t('typeLabel')}</span>
              <select
                className="form-input"
                value={formValues.type}
                onChange={(event) =>
                  setFormValues((currentValue) => ({
                    ...currentValue,
                    type: event.currentTarget.value as SurveyType
                  }))
                }
              >
                <option value="engagement">{t('typeEngagement')}</option>
                <option value="pulse">{t('typePulse')}</option>
                <option value="onboarding">{t('typeOnboarding')}</option>
                <option value="exit">{t('typeExit')}</option>
                <option value="custom">{t('typeCustom')}</option>
              </select>
            </label>

            <label className="form-field">
              <span className="form-label">{t('statusLabel')}</span>
              <select
                className="form-input"
                value={formValues.status}
                onChange={(event) =>
                  setFormValues((currentValue) => ({
                    ...currentValue,
                    status: event.currentTarget.value as "draft" | "active"
                  }))
                }
              >
                <option value="draft">{t('statusDraft')}</option>
                <option value="active">{t('statusActive')}</option>
              </select>
            </label>

            <label className="form-field">
              <span className="form-label">{t('minResponsesLabel')}</span>
              <input
                type="number"
                min={1}
                max={100}
                className={`form-input numeric ${
                  validationErrors.minResponsesForResults ? "form-input-error" : ""
                }`}
                value={formValues.minResponsesForResults}
                onChange={(event) =>
                  setFormValues((currentValue) => ({
                    ...currentValue,
                    minResponsesForResults: event.currentTarget.value
                  }))
                }
              />
              {validationErrors.minResponsesForResults ? (
                <p className="form-field-error">{validationErrors.minResponsesForResults}</p>
              ) : null}
            </label>
          </div>

          <div className="audit-filters">
            <label className="form-field">
              <span className="form-label">{t('startDateLabel')}</span>
              <input
                type="date"
                className="form-input"
                value={formValues.startDate}
                onChange={(event) =>
                  setFormValues((currentValue) => ({
                    ...currentValue,
                    startDate: event.currentTarget.value
                  }))
                }
              />
            </label>

            <label className="form-field">
              <span className="form-label">{t('endDateLabel')}</span>
              <input
                type="date"
                className={`form-input ${validationErrors.endDate ? "form-input-error" : ""}`}
                value={formValues.endDate}
                onChange={(event) =>
                  setFormValues((currentValue) => ({
                    ...currentValue,
                    endDate: event.currentTarget.value
                  }))
                }
              />
              {validationErrors.endDate ? <p className="form-field-error">{validationErrors.endDate}</p> : null}
            </label>

            <label className="form-field">
              <span className="form-label">{t('recurrenceLabel')}</span>
              <select
                className="form-input"
                value={formValues.recurrence}
                onChange={(event) =>
                  setFormValues((currentValue) => ({
                    ...currentValue,
                    recurrence: event.currentTarget.value as SurveyFormValues["recurrence"]
                  }))
                }
              >
                <option value="">{t('recurrenceNone')}</option>
                <option value="weekly">{t('recurrenceWeekly')}</option>
                <option value="monthly">{t('recurrenceMonthly')}</option>
                <option value="quarterly">{t('recurrenceQuarterly')}</option>
              </select>
            </label>
          </div>

          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={formValues.isAnonymous}
              onChange={(event) =>
                setFormValues((currentValue) => ({
                  ...currentValue,
                  isAnonymous: event.currentTarget.checked
                }))
              }
            />
            <span>{t('anonymousLabel')}</span>
          </label>
        </article>

        <article className="settings-card">
          <h2 className="section-title">{t('audienceTitle')}</h2>
          <p className="settings-card-description">
            {t('audienceDescription')}
          </p>

          <div className="audit-filters">
            <label className="form-field">
              <span className="form-label">{t('departmentsLabel')}</span>
              <input
                type="text"
                className="form-input"
                placeholder={t('departmentsPlaceholder')}
                value={formValues.departments}
                onChange={(event) =>
                  setFormValues((currentValue) => ({
                    ...currentValue,
                    departments: event.currentTarget.value
                  }))
                }
              />
            </label>

            <label className="form-field">
              <span className="form-label">{t('employmentTypesLabel')}</span>
              <input
                type="text"
                className="form-input"
                placeholder={t('employmentTypesPlaceholder')}
                value={formValues.employmentTypes}
                onChange={(event) =>
                  setFormValues((currentValue) => ({
                    ...currentValue,
                    employmentTypes: event.currentTarget.value
                  }))
                }
              />
            </label>

            <label className="form-field">
              <span className="form-label">{t('countriesLabel')}</span>
              <input
                type="text"
                className="form-input"
                placeholder={t('countriesPlaceholder')}
                value={formValues.countries}
                onChange={(event) =>
                  setFormValues((currentValue) => ({
                    ...currentValue,
                    countries: event.currentTarget.value
                  }))
                }
              />
            </label>
          </div>
        </article>

        <article className="settings-card">
          <header className="announcements-section-header">
            <div>
              <h2 className="section-title">{t('questionsTitle')}</h2>
              <p className="settings-card-description">
                {t('questionsDescription')}
              </p>
            </div>
            <div className="documents-row-actions" style={{ opacity: 1, transform: "none", pointerEvents: "auto" }}>
              <button type="button" className="button" onClick={() => addQuestion("rating")}>
                {t('addRating')}
              </button>
              <button type="button" className="button" onClick={() => addQuestion("text")}>
                {t('addText')}
              </button>
              <button type="button" className="button" onClick={() => addQuestion("select")}>
                {t('addSelect')}
              </button>
              <button type="button" className="button" onClick={() => addQuestion("likert")}>
                {t('addLikert')}
              </button>
            </div>
          </header>

          {validationErrors.questions ? <p className="form-field-error">{validationErrors.questions}</p> : null}

          {formValues.questions.map((question, index) => (
            <article key={question.id} className="timeoff-balance-card">
              <header className="announcement-item-header">
                <h3 className="section-title">{t('questionNumber', { number: index + 1 })}</h3>
                <button
                  type="button"
                  className="table-row-action"
                  onClick={() => removeQuestion(index)}
                  disabled={formValues.questions.length <= 1}
                >
                  {t('removeQuestion')}
                </button>
              </header>

              <label className="form-field">
                <span className="form-label">{t('promptLabel')}</span>
                <input
                  type="text"
                  className={`form-input ${validationErrors[`questions.${index}.text`] ? "form-input-error" : ""}`}
                  value={question.text}
                  onChange={(event) =>
                    updateQuestion(index, (currentQuestion) => ({
                      ...currentQuestion,
                      text: event.currentTarget.value
                    }))
                  }
                />
                {validationErrors[`questions.${index}.text`] ? (
                  <p className="form-field-error">{validationErrors[`questions.${index}.text`]}</p>
                ) : null}
              </label>

              <div className="audit-filters">
                <label className="form-field">
                  <span className="form-label">{t('questionTypeLabel')}</span>
                  <select
                    className="form-input"
                    value={question.type}
                    onChange={(event) =>
                      updateQuestion(index, (currentQuestion) => {
                        const nextType = event.currentTarget.value as SurveyQuestionType;

                        return {
                          ...currentQuestion,
                          type: nextType,
                          scale: nextType === "rating" ? currentQuestion.scale || "10" : "",
                          optionsText:
                            nextType === "likert"
                              ? currentQuestion.optionsText ||
                                "strongly_disagree,disagree,neutral,agree,strongly_agree"
                              : nextType === "select"
                                ? currentQuestion.optionsText
                                : ""
                        };
                      })
                    }
                  >
                    <option value="rating">{t('questionTypeRating')}</option>
                    <option value="text">{t('questionTypeText')}</option>
                    <option value="select">{t('questionTypeSelect')}</option>
                    <option value="likert">{t('questionTypeLikert')}</option>
                  </select>
                </label>

                {question.type === "rating" ? (
                  <label className="form-field">
                    <span className="form-label">{t('scaleMaxLabel')}</span>
                    <input
                      type="number"
                      min={2}
                      max={10}
                      className={`form-input numeric ${
                        validationErrors[`questions.${index}.scale`] ? "form-input-error" : ""
                      }`}
                      value={question.scale}
                      onChange={(event) =>
                        updateQuestion(index, (currentQuestion) => ({
                          ...currentQuestion,
                          scale: event.currentTarget.value
                        }))
                      }
                    />
                    {validationErrors[`questions.${index}.scale`] ? (
                      <p className="form-field-error">{validationErrors[`questions.${index}.scale`]}</p>
                    ) : null}
                  </label>
                ) : null}

                <label className="settings-checkbox" style={{ alignSelf: "end" }}>
                  <input
                    type="checkbox"
                    checked={question.required}
                    onChange={(event) =>
                      updateQuestion(index, (currentQuestion) => ({
                        ...currentQuestion,
                        required: event.currentTarget.checked
                      }))
                    }
                  />
                  <span>{t('requiredLabel')}</span>
                </label>
              </div>

              {(question.type === "select" || question.type === "likert") ? (
                <label className="form-field">
                  <span className="form-label">{t('optionsLabel')}</span>
                  <input
                    type="text"
                    className={`form-input ${
                      validationErrors[`questions.${index}.optionsText`] ? "form-input-error" : ""
                    }`}
                    value={question.optionsText}
                    onChange={(event) =>
                      updateQuestion(index, (currentQuestion) => ({
                        ...currentQuestion,
                        optionsText: event.currentTarget.value
                      }))
                    }
                  />
                  {validationErrors[`questions.${index}.optionsText`] ? (
                    <p className="form-field-error">{validationErrors[`questions.${index}.optionsText`]}</p>
                  ) : null}
                </label>
              ) : null}
            </article>
          ))}
        </article>

        {submitError ? <p className="form-submit-error">{submitError}</p> : null}
        {submitMessage ? <p className="settings-feedback">{submitMessage}</p> : null}

        <div className="settings-actions">
          <button type="submit" className="button button-accent" disabled={isSubmitting}>
            {isSubmitting ? t('creating') : t('createSurvey')}
          </button>
        </div>
      </form>
    </>
  );
}
