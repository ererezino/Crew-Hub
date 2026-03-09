"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  type ChangeEvent,
  type FormEvent,
  Suspense,
  useCallback,
  useRef,
  useState
} from "react";
import { z } from "zod";

import { OtpInput } from "../../components/shared/otp-input";

const emailSchema = z.string().trim().min(1).email();

type LoginStep = "email" | "code";

function getRedirectTarget(): string {
  if (typeof window === "undefined") {
    return "/dashboard";
  }

  const redirectTo = new URLSearchParams(window.location.search).get("redirectTo");
  return redirectTo && redirectTo.startsWith("/") ? redirectTo : "/dashboard";
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const INVITE_ERROR_MESSAGES: Record<string, string> = {
  invite_expired:
    "This invite link has expired or is invalid. Please ask your admin to send a new one.",
  auth_error:
    "We couldn't verify your link. Please ask your admin to resend the invite.",
  account_disabled:
    "Your account has been disabled. Contact your admin for help."
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlError = searchParams.get("error");
  const inviteBanner = urlError ? INVITE_ERROR_MESSAGES[urlError] ?? null : null;

  const [step, setStep] = useState<LoginStep>("email");
  const [email, setEmail] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const acceptedEmailRef = useRef<string>("");
  const checkingRef = useRef(false);

  const handleEmailChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.currentTarget.value;
      setEmail(next);

      if (step === "code" && next.trim().toLowerCase() !== acceptedEmailRef.current) {
        setStep("email");
        setTotpCode("");
        setSubmitError(null);
      }

      if (submitError) {
        setSubmitError(null);
      }
    },
    [step, submitError]
  );

  const handleTotpChange = useCallback(
    (code: string) => {
      setTotpCode(code);
      if (submitError) setSubmitError(null);
    },
    [submitError]
  );

  /* Email check — runs silently, no loading indicators */
  const checkEmail = useCallback(async () => {
    const trimmed = email.trim();
    if (!emailSchema.safeParse(trimmed).success) return;
    if (checkingRef.current) return;

    checkingRef.current = true;

    try {
      const res = await fetch("/api/v1/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed })
      });

      if (res.ok) {
        const json = (await res.json()) as { data?: { emailAccepted?: boolean } | null };
        if (json.data?.emailAccepted) {
          acceptedEmailRef.current = trimmed.toLowerCase();
          setStep("code");
        }
      }
    } catch {
      /* silent */
    } finally {
      checkingRef.current = false;
    }
  }, [email]);

  /* Full sign-in */
  const signIn = useCallback(async () => {
    if (totpCode.length !== 6) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch("/api/v1/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), totpCode })
      });

      const json = (await res.json()) as { error: { message?: string } | null };

      if (!res.ok) {
        setSubmitError(json.error?.message ?? "Unable to sign in. Please try again.");
        setIsSubmitting(false);
        return;
      }

      /* Audit — fire and forget */
      fetch("/api/v1/audit/login", { method: "POST", keepalive: true }).catch(() => undefined);

      router.replace(getRedirectTarget());
      router.refresh();
    } catch {
      setSubmitError("Unable to sign in. Please try again.");
      setIsSubmitting(false);
    }
  }, [email, totpCode, router]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step === "email") {
      void checkEmail();
    } else {
      void signIn();
    }
  };

  return (
    <main className="standalone-page auth-page">
      <section className="standalone-card auth-card" aria-label="Crew Hub login form">
        <header className="auth-card-header">
          <h1 className="auth-brand">Crew Hub</h1>
          <p className="auth-greeting">{getGreeting()}, crewmember</p>
        </header>

        {inviteBanner ? (
          <p className="form-submit-error" role="alert" style={{ marginBottom: 16 }}>
            {inviteBanner}
          </p>
        ) : null}

        <form className="auth-form" noValidate onSubmit={handleSubmit}>
          <label className="form-field" htmlFor="email">
            <span className="form-label">Email</span>
            <input
              id="email"
              name="email"
              className="form-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={handleEmailChange}
              disabled={isSubmitting}
            />
          </label>

          {step === "code" ? (
            <div className="form-field">
              <span className="form-label">Enter your 6-digit authenticator code</span>
              <OtpInput
                value={totpCode}
                onChange={handleTotpChange}
                disabled={isSubmitting}
                hasError={Boolean(submitError)}
              />
            </div>
          ) : null}

          {submitError ? (
            <p className="form-submit-error" role="alert">
              {submitError}
            </p>
          ) : null}

          <button type="submit" className="button button-cta auth-submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="auth-footer-link auth-footer-hint">
          Lost access? Contact your admin.
        </p>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
