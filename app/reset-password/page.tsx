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

type PageState = "loading" | "ready" | "session_error";

/**
 * Parse the hash fragment that Supabase sends after verifying an invite/recovery link.
 *
 * Supabase redirects here as:
 *   /reset-password#access_token=…&refresh_token=…&type=recovery
 *
 * The @supabase/ssr browser client is configured for PKCE flow and does NOT
 * process hash fragments, so we extract the tokens manually.
 */
function extractTokensFromHash(): {
  accessToken: string;
  refreshToken: string;
} | null {
  if (typeof window === "undefined") return null;

  const hash = window.location.hash;
  if (!hash || hash.length < 2) return null;

  const params = new URLSearchParams(hash.substring(1));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (accessToken && refreshToken) {
    return { accessToken, refreshToken };
  }

  return null;
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFirstTimeSetup, setIsFirstTimeSetup] = useState(false);
  const [pageState, setPageState] = useState<PageState>("loading");

  useEffect(() => {
    const initSession = async () => {
      const supabase = createSupabaseBrowserClient();

      /* ── Step 1: Try to establish a session from the URL ──────────── */

      // Supabase sends tokens in the hash fragment (#access_token=…)
      const hashTokens = extractTokensFromHash();
      if (hashTokens) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: hashTokens.accessToken,
          refresh_token: hashTokens.refreshToken
        });

        if (sessionError) {
          setPageState("session_error");
          return;
        }

        // Clean up the hash from the URL so it's not visible
        window.history.replaceState(null, "", window.location.pathname);
      }

      /* ── Step 2: Verify we have a valid session ──────────────────── */

      const { data: userData } = await supabase.auth.getUser();

      if (!userData?.user?.id) {
        // No hash tokens AND no existing session — link is broken/expired
        setPageState("session_error");
        return;
      }

      /* ── Step 3: Check if first-time setup or password reset ─────── */

      const { data: profile } = await supabase
        .from("profiles")
        .select("account_setup_at")
        .eq("id", userData.user.id)
        .maybeSingle();

      if (profile && !profile.account_setup_at) {
        setIsFirstTimeSetup(true);
      }

      setPageState("ready");
    };

    initSession().catch(() => {
      setPageState("session_error");
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

  /* ── Loading state ──────────────────────────────────────────────── */
  if (pageState === "loading") {
    return (
      <main className="standalone-page auth-page">
        <section className="standalone-card auth-card" aria-label="Setting up">
          <header className="auth-card-header">
            <h1 className="page-title">Crew Hub</h1>
            <p className="page-description">Verifying your link…</p>
          </header>
        </section>
      </main>
    );
  }

  /* ── Error state (expired / invalid link) ───────────────────────── */
  if (pageState === "session_error") {
    return (
      <main className="standalone-page auth-page">
        <section className="standalone-card auth-card" aria-label="Link expired">
          <header className="auth-card-header">
            <h1 className="page-title">Crew Hub</h1>
            <p className="page-description">
              This link has expired or is invalid. Please ask your admin to send a new invite.
            </p>
          </header>
          <Link href="/login" className="button button-accent auth-submit">
            Back to sign in
          </Link>
        </section>
      </main>
    );
  }

  /* ── Ready state: show the password form ────────────────────────── */
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
