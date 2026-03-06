"use client";

import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type FormEvent,
  useState
} from "react";
import { z } from "zod";

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required."),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters."),
    confirmPassword: z.string().min(1, "Please confirm your new password.")
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"]
  });

type ChangePasswordValues = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

type ChangePasswordField = keyof ChangePasswordValues;

type FieldErrors = Partial<Record<ChangePasswordField, string>>;

type TouchedFields = Record<ChangePasswordField, boolean>;

const INITIAL_VALUES: ChangePasswordValues = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: ""
};

const INITIAL_TOUCHED: TouchedFields = {
  currentPassword: false,
  newPassword: false,
  confirmPassword: false
};

const ALL_TOUCHED: TouchedFields = {
  currentPassword: true,
  newPassword: true,
  confirmPassword: true
};

function getValidationErrors(
  values: ChangePasswordValues,
  touched: TouchedFields
): FieldErrors {
  const result = changePasswordSchema.safeParse(values);

  if (result.success) {
    return {};
  }

  const fieldErrors = result.error.flatten().fieldErrors;

  return {
    currentPassword: touched.currentPassword
      ? fieldErrors.currentPassword?.[0]
      : undefined,
    newPassword: touched.newPassword
      ? fieldErrors.newPassword?.[0]
      : undefined,
    confirmPassword: touched.confirmPassword
      ? fieldErrors.confirmPassword?.[0]
      : undefined
  };
}

function hasAnyError(errors: FieldErrors): boolean {
  return Boolean(
    errors.currentPassword || errors.newPassword || errors.confirmPassword
  );
}

export default function ChangePasswordPage() {
  const router = useRouter();

  const [values, setValues] =
    useState<ChangePasswordValues>(INITIAL_VALUES);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<TouchedFields>(INITIAL_TOUCHED);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleFieldChange =
    (field: ChangePasswordField) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextValues = {
        ...values,
        [field]: event.currentTarget.value
      };

      setValues(nextValues);

      if (touched[field]) {
        setErrors(getValidationErrors(nextValues, touched));
      }

      if (submitError) {
        setSubmitError(null);
      }
    };

  const handleFieldBlur = (field: ChangePasswordField) => () => {
    const nextTouched = {
      ...touched,
      [field]: true
    };

    setTouched(nextTouched);
    setErrors(getValidationErrors(values, nextTouched));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setSubmitError(null);
    setTouched(ALL_TOUCHED);

    const validationErrors = getValidationErrors(values, ALL_TOUCHED);
    setErrors(validationErrors);

    if (hasAnyError(validationErrors)) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/v1/me/password", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword
        })
      });

      const result: {
        data: unknown;
        error: { code: string; message: string } | null;
        meta: { timestamp: string };
      } = await response.json();

      if (!response.ok || result.error) {
        setSubmitError(
          result.error?.message ?? "Unable to change password. Please try again."
        );
        setIsSubmitting(false);
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setSubmitError("Something went wrong. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <main className="standalone-page auth-page">
      <section
        className="standalone-card auth-card"
        aria-label="Change password form"
      >
        <header className="auth-card-header">
          <h1 className="page-title">Change Your Password</h1>
          <p className="page-description">
            You must change your temporary password before continuing.
          </p>
        </header>

        <form className="auth-form" noValidate onSubmit={handleSubmit}>
          <label className="form-field" htmlFor="currentPassword">
            <span className="form-label">Current password</span>
            <input
              id="currentPassword"
              name="currentPassword"
              className={
                errors.currentPassword
                  ? "form-input form-input-error"
                  : "form-input"
              }
              type="password"
              autoComplete="current-password"
              value={values.currentPassword}
              onChange={handleFieldChange("currentPassword")}
              onBlur={handleFieldBlur("currentPassword")}
              aria-invalid={Boolean(errors.currentPassword)}
              aria-describedby={
                errors.currentPassword ? "currentPassword-error" : undefined
              }
              disabled={isSubmitting}
            />
            {errors.currentPassword ? (
              <p
                id="currentPassword-error"
                className="form-field-error"
                role="alert"
              >
                {errors.currentPassword}
              </p>
            ) : null}
          </label>

          <label className="form-field" htmlFor="newPassword">
            <span className="form-label">New password</span>
            <input
              id="newPassword"
              name="newPassword"
              className={
                errors.newPassword
                  ? "form-input form-input-error"
                  : "form-input"
              }
              type="password"
              autoComplete="new-password"
              value={values.newPassword}
              onChange={handleFieldChange("newPassword")}
              onBlur={handleFieldBlur("newPassword")}
              aria-invalid={Boolean(errors.newPassword)}
              aria-describedby={
                errors.newPassword ? "newPassword-error" : undefined
              }
              disabled={isSubmitting}
            />
            {errors.newPassword ? (
              <p
                id="newPassword-error"
                className="form-field-error"
                role="alert"
              >
                {errors.newPassword}
              </p>
            ) : null}
          </label>

          <label className="form-field" htmlFor="confirmPassword">
            <span className="form-label">Confirm new password</span>
            <input
              id="confirmPassword"
              name="confirmPassword"
              className={
                errors.confirmPassword
                  ? "form-input form-input-error"
                  : "form-input"
              }
              type="password"
              autoComplete="new-password"
              value={values.confirmPassword}
              onChange={handleFieldChange("confirmPassword")}
              onBlur={handleFieldBlur("confirmPassword")}
              aria-invalid={Boolean(errors.confirmPassword)}
              aria-describedby={
                errors.confirmPassword ? "confirmPassword-error" : undefined
              }
              disabled={isSubmitting}
            />
            {errors.confirmPassword ? (
              <p
                id="confirmPassword-error"
                className="form-field-error"
                role="alert"
              >
                {errors.confirmPassword}
              </p>
            ) : null}
          </label>

          {submitError ? (
            <p className="form-submit-error" role="alert">
              {submitError}
            </p>
          ) : null}

          <button
            type="submit"
            className="button button-accent auth-submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Changing password..." : "Change Password"}
          </button>
        </form>
      </section>
    </main>
  );
}
