"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

function normalizeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/mfa-setup";
  }

  return next;
}

function AuthContinuePageContent() {
  const searchParams = useSearchParams();

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const otpType = searchParams.get("type");
  const next = normalizeNextPath(searchParams.get("next"));

  const hasValidPayload = useMemo(() => {
    if (code) return true;
    return Boolean(tokenHash && otpType);
  }, [code, tokenHash, otpType]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleContinue = async () => {
    if (!hasValidPayload) {
      setError("This setup link is invalid. Ask your admin for a new invite.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const verifyUrl = new URL("/api/auth/callback/verify", window.location.origin);
      verifyUrl.searchParams.set("next", next);
      if (code) {
        verifyUrl.searchParams.set("code", code);
      } else if (tokenHash && otpType) {
        verifyUrl.searchParams.set("token_hash", tokenHash);
        verifyUrl.searchParams.set("type", otpType);
      }

      // Use full-page navigation so auth cookies from callback verification
      // are committed in the same redirect chain.
      window.location.assign(verifyUrl.toString());
      return;
    } catch {
      setError("Unable to continue setup right now. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="standalone-page auth-page">
      <section className="standalone-card auth-card" style={{ maxWidth: 440, margin: "60px auto", padding: 32 }}>
        <h1 className="auth-brand" style={{ marginBottom: 8 }}>
          Continue Account Setup
        </h1>
        <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
          Click continue to complete your secure sign-in setup.
        </p>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>
          We require this confirmation so automated link previews cannot consume your one-time setup link.
        </p>

        {error ? (
          <p className="form-submit-error" role="alert" style={{ marginBottom: 12 }}>
            {error}
          </p>
        ) : null}

        <button
          className="button button-cta"
          style={{ width: "100%" }}
          onClick={handleContinue}
          disabled={submitting || !hasValidPayload}
        >
          {submitting ? "Continuing..." : "Continue Setup"}
        </button>
      </section>
    </main>
  );
}

export default function AuthContinuePage() {
  return (
    <Suspense>
      <AuthContinuePageContent />
    </Suspense>
  );
}
