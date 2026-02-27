"use client";

import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type FormEvent,
  useState
} from "react";
import { z } from "zod";

import { createSupabaseBrowserClient } from "../../lib/supabase/client";

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Enter a valid email address"),
  password: z
    .string()
    .min(1, "Password is required")
    .min(8, "Password must be at least 8 characters")
});

type LoginValues = z.infer<typeof loginSchema>;
type LoginField = keyof LoginValues;
type LoginErrors = Partial<Record<LoginField, string>>;

type TouchedFields = Record<LoginField, boolean>;

const INITIAL_VALUES: LoginValues = {
  email: "",
  password: ""
};

const INITIAL_TOUCHED: TouchedFields = {
  email: false,
  password: false
};

const ALL_TOUCHED: TouchedFields = {
  email: true,
  password: true
};

function getValidationErrors(values: LoginValues, touched: TouchedFields): LoginErrors {
  const parsedValues = loginSchema.safeParse(values);

  if (parsedValues.success) {
    return {};
  }

  const fieldErrors = parsedValues.error.flatten().fieldErrors;

  return {
    email: touched.email ? fieldErrors.email?.[0] : undefined,
    password: touched.password ? fieldErrors.password?.[0] : undefined
  };
}

function hasAnyError(errors: LoginErrors): boolean {
  return Boolean(errors.email || errors.password);
}

function getRedirectTarget(): string {
  if (typeof window === "undefined") {
    return "/dashboard";
  }

  const redirectTo = new URLSearchParams(window.location.search).get("redirectTo");
  return redirectTo && redirectTo.startsWith("/") ? redirectTo : "/dashboard";
}

export default function LoginPage() {
  const router = useRouter();

  const [values, setValues] = useState<LoginValues>(INITIAL_VALUES);
  const [errors, setErrors] = useState<LoginErrors>({});
  const [touched, setTouched] = useState<TouchedFields>(INITIAL_TOUCHED);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleFieldChange =
    (field: LoginField) => (event: ChangeEvent<HTMLInputElement>) => {
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

  const handleFieldBlur =
    (field: LoginField) => () => {
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

    let supabase;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      setSubmitError("Authentication is not configured. Check Supabase environment variables.");
      setIsSubmitting(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: values.email.trim(),
      password: values.password
    });

    if (error) {
      setSubmitError(error.message);
      setIsSubmitting(false);
      return;
    }

    const nextPath = getRedirectTarget();
    router.replace(nextPath);
    router.refresh();
  };

  return (
    <main className="standalone-page auth-page">
      <section className="standalone-card auth-card" aria-label="Crew Hub login form">
        <header className="auth-card-header">
          <h1 className="page-title">Crew Hub</h1>
          <p className="page-description">Sign in to continue to your workspace.</p>
        </header>

        <form className="auth-form" noValidate onSubmit={handleSubmit}>
          <label className="form-field" htmlFor="email">
            <span className="form-label">Email</span>
            <input
              id="email"
              name="email"
              className={errors.email ? "form-input form-input-error" : "form-input"}
              type="email"
              autoComplete="email"
              value={values.email}
              onChange={handleFieldChange("email")}
              onBlur={handleFieldBlur("email")}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "email-error" : undefined}
              disabled={isSubmitting}
            />
            {errors.email ? (
              <p id="email-error" className="form-field-error" role="alert">
                {errors.email}
              </p>
            ) : null}
          </label>

          <label className="form-field" htmlFor="password">
            <span className="form-label">Password</span>
            <input
              id="password"
              name="password"
              className={errors.password ? "form-input form-input-error" : "form-input"}
              type="password"
              autoComplete="current-password"
              value={values.password}
              onChange={handleFieldChange("password")}
              onBlur={handleFieldBlur("password")}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? "password-error" : undefined}
              disabled={isSubmitting}
            />
            {errors.password ? (
              <p id="password-error" className="form-field-error" role="alert">
                {errors.password}
              </p>
            ) : null}
          </label>

          {submitError ? (
            <p className="form-submit-error" role="alert">
              {submitError}
            </p>
          ) : null}

          <button type="submit" className="button button-accent auth-submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
