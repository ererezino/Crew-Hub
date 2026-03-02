"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

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

  const [formValues, setFormValues] = useState<SurveyFormValues>(DEFAULT_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  const validationErrors = useMemo(() => {
    const errors: Record<string, string> = {};

    if (formValues.title.trim().length === 0) {
      errors.title = "Survey title is required.";
    }

    const minResponses = Number.parseInt(formValues.minResponsesForResults, 10);

    if (!Number.isInteger(minResponses) || minResponses < 1 || minResponses > 100) {
      errors.minResponsesForResults = "Minimum responses must be between 1 and 100.";
    }

    if (formValues.startDate && formValues.endDate && formValues.endDate < formValues.startDate) {
      errors.endDate = "End date cannot be earlier than start date.";
    }

    if (formValues.questions.length === 0) {
      errors.questions = "Add at least one question.";
    }

    formValues.questions.forEach((question, index) => {
      if (question.text.trim().length === 0) {
        errors[`questions.${index}.text`] = "Question text is required.";
      }

      if (question.type === "rating") {
        const scaleValue = Number.parseInt(question.scale, 10);

        if (!Number.isInteger(scaleValue) || scaleValue < 2 || scaleValue > 10) {
          errors[`questions.${index}.scale`] = "Rating scale must be between 2 and 10.";
        }
      }

      if (question.type === "select" || question.type === "likert") {
        const options = parseCommaSeparated(question.optionsText);

        if (options.length === 0) {
          errors[`questions.${index}.optionsText`] = "Provide at least one option.";
        }
      }
    });

    return errors;
  }, [formValues]);

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
      setSubmitError("Fix validation errors before creating this survey.");
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
        setSubmitError(body.error?.message ?? "Unable to create survey.");
        return;
      }

      setSubmitMessage("Survey created successfully.");
      router.push("/admin/surveys");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to create survey.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="New Survey"
        description="Build a question set, configure audience targeting, and save as draft or active."
        actions={
          <Link href="/admin/surveys" className="button">
            Back to survey admin
          </Link>
        }
      />

      <form className="settings-layout" onSubmit={handleSubmit}>
        <article className="settings-card">
          <h2 className="section-title">Survey details</h2>

          <label className="form-field">
            <span className="form-label">Title *</span>
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
            <span className="form-label">Description</span>
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
              <span className="form-label">Type</span>
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
                <option value="engagement">Engagement</option>
                <option value="pulse">Pulse</option>
                <option value="onboarding">Onboarding</option>
                <option value="exit">Exit</option>
                <option value="custom">Custom</option>
              </select>
            </label>

            <label className="form-field">
              <span className="form-label">Status</span>
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
                <option value="draft">Draft</option>
                <option value="active">Active</option>
              </select>
            </label>

            <label className="form-field">
              <span className="form-label">Minimum responses *</span>
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
              <span className="form-label">Start date</span>
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
              <span className="form-label">End date</span>
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
              <span className="form-label">Recurrence</span>
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
                <option value="">No recurrence</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
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
            <span>Anonymous responses</span>
          </label>
        </article>

        <article className="settings-card">
          <h2 className="section-title">Audience filters</h2>
          <p className="settings-card-description">
            Leave filters empty to target all employees. Use comma-separated values.
          </p>

          <div className="audit-filters">
            <label className="form-field">
              <span className="form-label">Departments</span>
              <input
                type="text"
                className="form-input"
                placeholder="Engineering, Operations"
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
              <span className="form-label">Employment types</span>
              <input
                type="text"
                className="form-input"
                placeholder="contractor, full_time"
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
              <span className="form-label">Countries</span>
              <input
                type="text"
                className="form-input"
                placeholder="NG, GH, KE"
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
              <h2 className="section-title">Questions</h2>
              <p className="settings-card-description">
                Build rating, text, select, and likert questions.
              </p>
            </div>
            <div className="documents-row-actions" style={{ opacity: 1, transform: "none", pointerEvents: "auto" }}>
              <button type="button" className="button" onClick={() => addQuestion("rating")}>
                Add rating
              </button>
              <button type="button" className="button" onClick={() => addQuestion("text")}>
                Add text
              </button>
              <button type="button" className="button" onClick={() => addQuestion("select")}>
                Add select
              </button>
              <button type="button" className="button" onClick={() => addQuestion("likert")}>
                Add likert
              </button>
            </div>
          </header>

          {validationErrors.questions ? <p className="form-field-error">{validationErrors.questions}</p> : null}

          {formValues.questions.map((question, index) => (
            <article key={question.id} className="timeoff-balance-card">
              <header className="announcement-item-header">
                <h3 className="section-title">Question {index + 1}</h3>
                <button
                  type="button"
                  className="table-row-action"
                  onClick={() => removeQuestion(index)}
                  disabled={formValues.questions.length <= 1}
                >
                  Remove
                </button>
              </header>

              <label className="form-field">
                <span className="form-label">Prompt *</span>
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
                  <span className="form-label">Type</span>
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
                    <option value="rating">Rating</option>
                    <option value="text">Text</option>
                    <option value="select">Select</option>
                    <option value="likert">Likert</option>
                  </select>
                </label>

                {question.type === "rating" ? (
                  <label className="form-field">
                    <span className="form-label">Scale max</span>
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
                  <span>Required</span>
                </label>
              </div>

              {(question.type === "select" || question.type === "likert") ? (
                <label className="form-field">
                  <span className="form-label">Options (comma-separated)</span>
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
            {isSubmitting ? "Saving..." : "Create survey"}
          </button>
        </div>
      </form>
    </>
  );
}
