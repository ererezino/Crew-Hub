"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
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
  const [isFirstTimeSetup, setIsFirstTimeSetup] = useState(false);

  /* Detect whether this is first-time account setup or a password reset */
  useEffect(() => {
    const checkSetupStatus = async () => {
      const supabase = createSupabaseBrowserClient();
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user?.id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("account_setup_at")
          .eq("id", userData.user.id)
          .maybeSingle();

        if (profile && !profile.account_setup_at) {
          setIsFirstTimeSetup(true);
        }
      }
    };

    checkSetupStatus().catch(() => {
      /* If check fails, default to reset wording */
    });
  }, []);

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

      /* Mark account as set up — so the People page shows "Active" */
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user?.id) {
        await supabase
          .from("profiles")
          .update({ account_setup_at: new Date().toISOString() })
          .eq("id", sessionData.session.user.id)
          .is("account_setup_at", null);
      }

      router.replace("/login");
    } catch {
      setError("Something went wrong. Please try again.");
      setIsSubmitting(false);
    }
  };

  const heading = isFirstTimeSetup ? "Set up your account" : "Reset your password";
  const description = isFirstTimeSetup
    ? "Create a password to get started with Crew Hub."
    : "Choose a new password for your account.";
  const passwordLabel = isFirstTimeSetup ? "Password" : "New password";
  const submitLabel = isFirstTimeSetup ? "Create account" : "Update password";
  const submittingLabel = isFirstTimeSetup ? "Setting up..." : "Updating...";

  return (
    <main className="standalone-page auth-page">
      <section className="standalone-card auth-card" aria-label={heading}>
        <header className="auth-card-header">
          <h1 className="page-title">Crew Hub</h1>
          <p className="page-description">{description}</p>
        </header>

        <form className="auth-form" noValidate onSubmit={handleSubmit}>
          <label className="form-field" htmlFor="password">
            <span className="form-label">{passwordLabel}</span>
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
            {isSubmitting ? submittingLabel : submitLabel}
          </button>
        </form>

        <p className="auth-footer-link">
          <Link href="/login">Back to sign in</Link>
        </p>
      </section>
    </main>
  );
}
