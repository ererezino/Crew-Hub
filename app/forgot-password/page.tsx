"use client";

import Link from "next/link";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { z } from "zod";

import { createSupabaseBrowserClient } from "../../lib/supabase/client";

const emailSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Enter a valid email address")
});

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setEmail(event.currentTarget.value);
    if (error) setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const parsed = emailSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid email");
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createSupabaseBrowserClient();
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
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <main className="standalone-page auth-page">
        <section className="standalone-card auth-card" aria-label="Check your email">
          <header className="auth-card-header">
            <h1 className="page-title">Check your email</h1>
            <p className="page-description">
              If an account exists for <strong>{email}</strong>, we sent a password reset link.
              Check your inbox and follow the instructions.
            </p>
          </header>
          <Link href="/login" className="button button-accent auth-submit">
            Back to sign in
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="standalone-page auth-page">
      <section className="standalone-card auth-card" aria-label="Reset your password">
        <header className="auth-card-header">
          <h1 className="page-title">Crew Hub</h1>
          <p className="page-description">
            Enter your email address and we will send you a link to reset your password.
          </p>
        </header>

        <form className="auth-form" noValidate onSubmit={handleSubmit}>
          <label className="form-field" htmlFor="email">
            <span className="form-label">Email</span>
            <input
              id="email"
              name="email"
              className={error ? "form-input form-input-error" : "form-input"}
              type="email"
              autoComplete="email"
              value={email}
              onChange={handleChange}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "email-error" : undefined}
              disabled={isSubmitting}
            />
            {error ? (
              <p id="email-error" className="form-field-error" role="alert">
                {error}
              </p>
            ) : null}
          </label>

          <button type="submit" className="button button-accent auth-submit" disabled={isSubmitting}>
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
