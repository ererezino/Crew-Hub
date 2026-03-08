"use client";

import Link from "next/link";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { z } from "zod";

import { createSupabaseBrowserClient } from "../../lib/supabase/client";

const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .email("Enter a valid email address");

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [touched, setTouched] = useState(false);

  function validate(value: string, isTouched: boolean): string | null {
    if (!isTouched) return null;
    const result = emailSchema.safeParse(value);
    return result.success ? null : result.error.issues[0].message;
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value;
    setEmail(value);
    if (touched) {
      setFieldError(validate(value, true));
    }
    if (error) setError(null);
  };

  const handleBlur = () => {
    setTouched(true);
    setFieldError(validate(email, true));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setTouched(true);

    const validationError = validate(email, true);
    setFieldError(validationError);
    if (validationError) return;

    setIsSubmitting(true);

    let supabase;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      setError("Authentication is not configured. Check Supabase environment variables.");
      setIsSubmitting(false);
      return;
    }

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: `${window.location.origin}/reset-password` }
    );

    if (resetError) {
      setError(resetError.message);
      setIsSubmitting(false);
      return;
    }

    setIsSuccess(true);
    setIsSubmitting(false);
  };

  if (isSuccess) {
    return (
      <main className="standalone-page auth-page">
        <section className="standalone-card auth-card" aria-label="Check your email">
          <header className="auth-card-header">
            <h1 className="page-title text-h1">Crew Hub</h1>
            <p className="page-description">
              If an account exists for <strong>{email.trim()}</strong>, you will
              receive a password reset link shortly. Check your inbox.
            </p>
          </header>

          <p className="auth-footer-link">
            <Link href="/login">Back to sign in</Link>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="standalone-page auth-page">
      <section className="standalone-card auth-card" aria-label="Forgot password">
        <header className="auth-card-header">
          <h1 className="page-title text-h1">Crew Hub</h1>
          <p className="page-description">
            Enter your email and we will send you a link to reset your password.
          </p>
        </header>

        <form className="auth-form" noValidate onSubmit={handleSubmit}>
          <label className="form-field" htmlFor="email">
            <span className="form-label">Email</span>
            <input
              id="email"
              name="email"
              className={fieldError ? "form-input form-input-error" : "form-input"}
              type="email"
              autoComplete="email"
              value={email}
              onChange={handleChange}
              onBlur={handleBlur}
              aria-invalid={Boolean(fieldError)}
              aria-describedby={fieldError ? "email-error" : undefined}
              disabled={isSubmitting}
            />
            {fieldError ? (
              <p id="email-error" className="form-field-error" role="alert">
                {fieldError}
              </p>
            ) : null}
          </label>

          {error ? (
            <p className="form-submit-error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="button button-cta auth-submit" disabled={isSubmitting}>
            {isSubmitting ? "Sending..." : "Send reset link"}
          </button>
        </form>

        <p className="auth-footer-link">
          <Link href="/login">Back to sign in</Link>
        </p>
      </section>
    </main>
  );
}
