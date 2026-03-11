"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { PageHeader } from "../../../../../../components/shared/page-header";
import { toSentenceCase } from "../../../../../../lib/format-labels";
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

function hasErrors(errors: NewCourseFormErrors): boolean {
  return Object.values(errors).some((value) => Boolean(value));
}

export function NewLearningCourseClient() {
  const t = useTranslations('newLearningCourse');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [values, setValues] = useState<NewCourseFormState>(defaultFormState);
  const [errors, setErrors] = useState<NewCourseFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  const validateForm = useMemo(
    () =>
      (formValues: NewCourseFormState): NewCourseFormErrors => {
        const result: NewCourseFormErrors = {};

        if (!formValues.title.trim()) {
          result.title = t('errorTitleRequired');
        } else if (formValues.title.trim().length > 200) {
          result.title = t('errorTitleTooLong');
        }

        if (formValues.description.trim().length > 4000) {
          result.description = t('errorDescriptionTooLong');
        }

        if (formValues.category.trim().length > 60) {
          result.category = t('errorCategoryTooLong');
        }

        if (!LEARNING_COURSE_CONTENT_TYPES.includes(formValues.contentType)) {
          result.contentType = t('errorContentType');
        }

        if (formValues.contentUrl.trim().length > 0) {
          try {
            new URL(formValues.contentUrl.trim());
          } catch {
            result.contentUrl = t('errorContentUrl');
          }
        }

        if (formValues.durationMinutes.trim().length > 0) {
          const parsedDuration = Number(formValues.durationMinutes);

          if (!Number.isInteger(parsedDuration) || parsedDuration < 0 || parsedDuration > 6000) {
            result.durationMinutes = t('errorDuration');
          }
        }

        if (formValues.difficulty.trim().length > 0 && !LEARNING_COURSE_DIFFICULTIES.includes(formValues.difficulty as (typeof LEARNING_COURSE_DIFFICULTIES)[number])) {
          result.difficulty = t('errorDifficulty');
        }

        if (formValues.passingScore.trim().length > 0) {
          const parsedPassingScore = Number(formValues.passingScore);

          if (!Number.isInteger(parsedPassingScore) || parsedPassingScore < 0 || parsedPassingScore > 100) {
            result.passingScore = t('errorPassingScore');
          }
        }

        if (formValues.recurrence.trim().length > 0 && !LEARNING_COURSE_RECURRENCES.includes(formValues.recurrence as (typeof LEARNING_COURSE_RECURRENCES)[number])) {
          result.recurrence = t('errorRecurrence');
        }

        return result;
      },
    [t]
  );

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
          form: payload.error?.message ?? t('errorUnableToCreate')
        });
        return;
      }

      setValues(defaultFormState);
      setSubmitMessage(t('courseCreated'));
      router.push("/admin/learning");
      router.refresh();
    } catch (error) {
      setErrors({
        form: error instanceof Error ? error.message : t('errorUnableToCreate')
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
      />

      <section className="compensation-layout" aria-label={t('formAriaLabel')}>
        <article className="settings-card">
          <form className="settings-form-grid" onSubmit={handleSubmit}>
            <label className="settings-field">
              <span className="settings-field-label">{t('labelTitle')}</span>
              <input
                className="settings-input"
                value={values.title}
                onChange={(event) => setValues((currentValue) => ({ ...currentValue, title: event.target.value }))}
                placeholder={t('placeholderTitle')}
              />
            </label>
            {errors.title ? <p className="form-field-error">{errors.title}</p> : null}

            <label className="settings-field">
              <span className="settings-field-label">{t('labelDescription')}</span>
              <textarea
                className="settings-textarea"
                value={values.description}
                onChange={(event) => setValues((currentValue) => ({ ...currentValue, description: event.target.value }))}
                placeholder={t('placeholderDescription')}
              />
            </label>
            {errors.description ? <p className="form-field-error">{errors.description}</p> : null}

            <label className="settings-field">
              <span className="settings-field-label">{t('labelCategory')}</span>
              <input
                className="settings-input"
                value={values.category}
                onChange={(event) => setValues((currentValue) => ({ ...currentValue, category: event.target.value }))}
                placeholder={t('placeholderCategory')}
              />
            </label>
            {errors.category ? <p className="form-field-error">{errors.category}</p> : null}

            <label className="settings-field">
              <span className="settings-field-label">{t('labelContentType')}</span>
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
                    {toSentenceCase(type)}
                  </option>
                ))}
              </select>
            </label>
            {errors.contentType ? <p className="form-field-error">{errors.contentType}</p> : null}

            <label className="settings-field">
              <span className="settings-field-label">{t('labelContentUrl')}</span>
              <input
                className="settings-input"
                value={values.contentUrl}
                onChange={(event) => setValues((currentValue) => ({ ...currentValue, contentUrl: event.target.value }))}
                placeholder={t('placeholderContentUrl')}
              />
            </label>
            {errors.contentUrl ? <p className="form-field-error">{errors.contentUrl}</p> : null}

            <label className="settings-field">
              <span className="settings-field-label">{t('labelDuration')}</span>
              <input
                type="number"
                min={0}
                max={6000}
                className="settings-input numeric"
                value={values.durationMinutes}
                onChange={(event) => setValues((currentValue) => ({ ...currentValue, durationMinutes: event.target.value }))}
                placeholder={t('placeholderDuration')}
              />
            </label>
            {errors.durationMinutes ? <p className="form-field-error">{errors.durationMinutes}</p> : null}

            <label className="settings-field">
              <span className="settings-field-label">{t('labelDifficulty')}</span>
              <select
                className="settings-input"
                value={values.difficulty}
                onChange={(event) => setValues((currentValue) => ({ ...currentValue, difficulty: event.target.value }))}
              >
                <option value="">{t('notSet')}</option>
                {LEARNING_COURSE_DIFFICULTIES.map((difficulty) => (
                  <option key={difficulty} value={difficulty}>
                    {difficulty}
                  </option>
                ))}
              </select>
            </label>
            {errors.difficulty ? <p className="form-field-error">{errors.difficulty}</p> : null}

            <label className="settings-field">
              <span className="settings-field-label">{t('labelPassingScore')}</span>
              <input
                type="number"
                min={0}
                max={100}
                className="settings-input numeric"
                value={values.passingScore}
                onChange={(event) => setValues((currentValue) => ({ ...currentValue, passingScore: event.target.value }))}
                placeholder={t('placeholderPassingScore')}
              />
            </label>
            {errors.passingScore ? <p className="form-field-error">{errors.passingScore}</p> : null}

            <label className="settings-field">
              <span className="settings-field-label">{t('labelRecurrence')}</span>
              <select
                className="settings-input"
                value={values.recurrence}
                onChange={(event) => setValues((currentValue) => ({ ...currentValue, recurrence: event.target.value }))}
              >
                <option value="">{t('notRecurring')}</option>
                {LEARNING_COURSE_RECURRENCES.map((recurrence) => (
                  <option key={recurrence} value={recurrence}>
                    {toSentenceCase(recurrence)}
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
              <span>{t('mandatoryCourse')}</span>
            </label>

            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={values.allowRetake}
                onChange={(event) =>
                  setValues((currentValue) => ({ ...currentValue, allowRetake: event.target.checked }))
                }
              />
              <span>{t('allowRetakes')}</span>
            </label>

            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={values.isPublished}
                onChange={(event) =>
                  setValues((currentValue) => ({ ...currentValue, isPublished: event.target.checked }))
                }
              />
              <span>{t('publishImmediately')}</span>
            </label>

            {errors.form ? <p className="form-field-error">{errors.form}</p> : null}

            <div className="settings-actions">
              <Link href="/admin/learning" className="button">
                {tCommon('cancel')}
              </Link>
              <button type="submit" className="button button-accent" disabled={isSubmitting}>
                {isSubmitting ? t('creating') : t('createCourse')}
              </button>
            </div>

            {submitMessage ? <p className="settings-card-description">{submitMessage}</p> : null}
          </form>
        </article>
      </section>
    </>
  );
}
