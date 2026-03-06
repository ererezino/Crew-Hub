"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { z } from "zod";

import { createSupabaseBrowserClient } from "../../lib/supabase/client";

const passwordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string()
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"]
  });

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    const parsed = passwordSchema.safeParse({ password, confirmPassword });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string") errs[key] = issue.message;
      }
      setFieldErrors(errs);
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password
      });

      if (updateError) {
        setError(updateError.message);
        setIsSubmitting(false);
        return;
      }

      router.replace("/login");
    } catch {
      setError("Something went wrong. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <main className="standalone-page auth-page">
      <section className="standalone-card auth-card" aria-label="Set new password">
        <header className="auth-card-header">
          <h1 className="page-title">Crew Hub</h1>
          <p className="page-description">Choose a new password for your account.</p>
        </header>

        <form className="auth-form" noValidate onSubmit={handleSubmit}>
          <label className="form-field" htmlFor="password">
            <span className="form-label">New password</span>
            <input
              id="password"
              name="password"
              className={fieldErrors.password ? "form-input form-input-error" : "form-input"}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setPassword(e.currentTarget.value);
                if (error) setError(null);
              }}
              disabled={isSubmitting}
            />
            {fieldErrors.password ? (
              <p className="form-field-error" role="alert">{fieldErrors.password}</p>
            ) : null}
          </label>

          <label className="form-field" htmlFor="confirmPassword">
            <span className="form-label">Confirm password</span>
            <input
              id="confirmPassword"
              name="confirmPassword"
              className={fieldErrors.confirmPassword ? "form-input form-input-error" : "form-input"}
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setConfirmPassword(e.currentTarget.value);
                if (error) setError(null);
              }}
              disabled={isSubmitting}
            />
            {fieldErrors.confirmPassword ? (
              <p className="form-field-error" role="alert">{fieldErrors.confirmPassword}</p>
            ) : null}
          </label>

          {error ? (
            <p className="form-submit-error" role="alert">{error}</p>
          ) : null}

          <button type="submit" className="button button-accent auth-submit" disabled={isSubmitting}>
            {isSubmitting ? "Updating..." : "Update password"}
          </button>
        </form>

        <p className="auth-footer-link">
          <Link href="/login">Back to sign in</Link>
        </p>
      </section>
    </main>
  );
}
