"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PageHeader } from "../../../../../../components/shared/page-header";
import {
  LEARNING_COURSE_CONTENT_TYPES,
  LEARNING_COURSE_DIFFICULTIES,
  LEARNING_COURSE_RECURRENCES,
  type LearningCourseMutationResponse
} from "../../../../../../types/learning";

type NewCourseFormState = {
  title: string;
  description: string;
  category: string;
  contentType: (typeof LEARNING_COURSE_CONTENT_TYPES)[number];
  contentUrl: string;
  durationMinutes: string;
  difficulty: string;
  passingScore: string;
  recurrence: string;
  isMandatory: boolean;
  allowRetake: boolean;
  isPublished: boolean;
};

type NewCourseFormErrors = Partial<Record<keyof NewCourseFormState, string>> & {
  form?: string;
};

const defaultFormState: NewCourseFormState = {
  title: "",
  description: "",
  category: "",
  contentType: "document",
  contentUrl: "",
  durationMinutes: "",
  difficulty: "",
  passingScore: "",
  recurrence: "",
  isMandatory: false,
  allowRetake: true,
  isPublished: false
};

function validateForm(values: NewCourseFormState): NewCourseFormErrors {
  const errors: NewCourseFormErrors = {};

  if (!values.title.trim()) {
    errors.title = "Course title is required.";
  } else if (values.title.trim().length > 200) {
    errors.title = "Course title is too long.";
  }

  if (values.description.trim().length > 4000) {
    errors.description = "Description is too long.";
  }

  if (values.category.trim().length > 60) {
    errors.category = "Category is too long.";
  }

  if (!LEARNING_COURSE_CONTENT_TYPES.includes(values.contentType)) {
    errors.contentType = "Select a valid content type.";
  }

  if (values.contentUrl.trim().length > 0) {
    try {
      new URL(values.contentUrl.trim());
    } catch {
      errors.contentUrl = "Content URL must be valid.";
    }
  }

  if (values.durationMinutes.trim().length > 0) {
    const parsedDuration = Number(values.durationMinutes);

    if (!Number.isInteger(parsedDuration) || parsedDuration < 0 || parsedDuration > 6000) {
      errors.durationMinutes = "Duration must be a whole number between 0 and 6000.";
    }
  }

  if (values.difficulty.trim().length > 0 && !LEARNING_COURSE_DIFFICULTIES.includes(values.difficulty as (typeof LEARNING_COURSE_DIFFICULTIES)[number])) {
    errors.difficulty = "Select a valid difficulty.";
  }

  if (values.passingScore.trim().length > 0) {
    const parsedPassingScore = Number(values.passingScore);

    if (!Number.isInteger(parsedPassingScore) || parsedPassingScore < 0 || parsedPassingScore > 100) {
      errors.passingScore = "Passing score must be a whole number from 0 to 100.";
    }
  }

  if (values.recurrence.trim().length > 0 && !LEARNING_COURSE_RECURRENCES.includes(values.recurrence as (typeof LEARNING_COURSE_RECURRENCES)[number])) {
    errors.recurrence = "Select a valid recurrence option.";
  }

  return errors;
}

function hasErrors(errors: NewCourseFormErrors): boolean {
  return Object.values(errors).some((value) => Boolean(value));
}

export function NewLearningCourseClient() {
  const router = useRouter();

  const [values, setValues] = useState<NewCourseFormState>(defaultFormState);
  const [errors, setErrors] = useState<NewCourseFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateForm(values);
    setErrors(nextErrors);
    setSubmitMessage(null);

    if (hasErrors(nextErrors)) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/v1/learning/courses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: values.title,
          description: values.description || undefined,
          category: values.category || undefined,
          contentType: values.contentType,
          contentUrl: values.contentUrl || undefined,
          durationMinutes: values.durationMinutes || undefined,
          difficulty: values.difficulty || undefined,
          passingScore: values.passingScore || undefined,
          recurrence: values.recurrence || undefined,
          isMandatory: values.isMandatory,
          allowRetake: values.allowRetake,
          isPublished: values.isPublished
        })
      });

      const payload = (await response.json()) as LearningCourseMutationResponse;

      if (!response.ok || !payload.data?.course) {
        setErrors({
          form: payload.error?.message ?? "Unable to create learning course."
        });
        return;
      }

      setValues(defaultFormState);
      setSubmitMessage("Learning course created.");
      router.push("/admin/learning");
      router.refresh();
    } catch (error) {
      setErrors({
        form: error instanceof Error ? error.message : "Unable to create learning course."
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="New Learning Course"
        description="Create and publish a course in Crew Hub learning management."
      />

      <section className="compensation-layout" aria-label="Create learning course form">
        <article className="settings-card">
          <form className="settings-form-grid" onSubmit={handleSubmit}>
            <label className="settings-field">
              <span className="settings-field-label">Title</span>
              <input
                className="settings-input"
                value={values.title}
                onChange={(event) => setValues((currentValue) => ({ ...currentValue, title: event.target.value }))}
                placeholder="Information Security Essentials"
              />
            </label>
            {errors.title ? <p className="form-field-error">{errors.title}</p> : null}

            <label className="settings-field">
              <span className="settings-field-label">Description</span>
              <textarea
                className="settings-textarea"
                value={values.description}
                onChange={(event) => setValues((currentValue) => ({ ...currentValue, description: event.target.value }))}
                placeholder="Required annual security refresher for all employees."
              />
            </label>
            {errors.description ? <p className="form-field-error">{errors.description}</p> : null}

            <label className="settings-field">
              <span className="settings-field-label">Category</span>
              <input
                className="settings-input"
                value={values.category}
                onChange={(event) => setValues((currentValue) => ({ ...currentValue, category: event.target.value }))}
                placeholder="security"
              />
            </label>
            {errors.category ? <p className="form-field-error">{errors.category}</p> : null}

            <label className="settings-field">
              <span className="settings-field-label">Content type</span>
              <select
                className="settings-input"
                value={values.contentType}
                onChange={(event) =>
                  setValues((currentValue) => ({
                    ...currentValue,
                    contentType: event.target.value as (typeof LEARNING_COURSE_CONTENT_TYPES)[number]
                  }))
                }
              >
                {LEARNING_COURSE_CONTENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            {errors.contentType ? <p className="form-field-error">{errors.contentType}</p> : null}

            <label className="settings-field">
              <span className="settings-field-label">Content URL</span>
              <input
                className="settings-input"
                value={values.contentUrl}
                onChange={(event) => setValues((currentValue) => ({ ...currentValue, contentUrl: event.target.value }))}
                placeholder="https://example.com/course"
              />
            </label>
            {errors.contentUrl ? <p className="form-field-error">{errors.contentUrl}</p> : null}

            <label className="settings-field">
              <span className="settings-field-label">Duration (minutes)</span>
              <input
                type="number"
                min={0}
                max={6000}
                className="settings-input numeric"
                value={values.durationMinutes}
                onChange={(event) => setValues((currentValue) => ({ ...currentValue, durationMinutes: event.target.value }))}
                placeholder="60"
              />
            </label>
            {errors.durationMinutes ? <p className="form-field-error">{errors.durationMinutes}</p> : null}

            <label className="settings-field">
              <span className="settings-field-label">Difficulty</span>
              <select
                className="settings-input"
                value={values.difficulty}
                onChange={(event) => setValues((currentValue) => ({ ...currentValue, difficulty: event.target.value }))}
              >
                <option value="">Not set</option>
                {LEARNING_COURSE_DIFFICULTIES.map((difficulty) => (
                  <option key={difficulty} value={difficulty}>
                    {difficulty}
                  </option>
                ))}
              </select>
            </label>
            {errors.difficulty ? <p className="form-field-error">{errors.difficulty}</p> : null}

            <label className="settings-field">
              <span className="settings-field-label">Passing score</span>
              <input
                type="number"
                min={0}
                max={100}
                className="settings-input numeric"
                value={values.passingScore}
                onChange={(event) => setValues((currentValue) => ({ ...currentValue, passingScore: event.target.value }))}
                placeholder="80"
              />
            </label>
            {errors.passingScore ? <p className="form-field-error">{errors.passingScore}</p> : null}

            <label className="settings-field">
              <span className="settings-field-label">Recurrence</span>
              <select
                className="settings-input"
                value={values.recurrence}
                onChange={(event) => setValues((currentValue) => ({ ...currentValue, recurrence: event.target.value }))}
              >
                <option value="">Not recurring</option>
                {LEARNING_COURSE_RECURRENCES.map((recurrence) => (
                  <option key={recurrence} value={recurrence}>
                    {recurrence.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            {errors.recurrence ? <p className="form-field-error">{errors.recurrence}</p> : null}

            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={values.isMandatory}
                onChange={(event) =>
                  setValues((currentValue) => ({ ...currentValue, isMandatory: event.target.checked }))
                }
              />
              <span>Mandatory course</span>
            </label>

            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={values.allowRetake}
                onChange={(event) =>
                  setValues((currentValue) => ({ ...currentValue, allowRetake: event.target.checked }))
                }
              />
              <span>Allow retakes</span>
            </label>

            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={values.isPublished}
                onChange={(event) =>
                  setValues((currentValue) => ({ ...currentValue, isPublished: event.target.checked }))
                }
              />
              <span>Publish immediately</span>
            </label>

            {errors.form ? <p className="form-field-error">{errors.form}</p> : null}

            <div className="settings-actions">
              <Link href="/admin/learning" className="button">
                Cancel
              </Link>
              <button type="submit" className="button button-accent" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create course"}
              </button>
            </div>

            {submitMessage ? <p className="settings-card-description">{submitMessage}</p> : null}
          </form>
        </article>
      </section>
    </>
  );
}
