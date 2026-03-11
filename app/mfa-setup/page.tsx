"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function MfaSetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<"start" | "verify" | "done">("start");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await fetch("/api/auth/sign-out", { method: "POST" });
      window.location.href = "/login";
    } catch {
      setSigningOut(false);
    }
  };

  const startEnrollment = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/me/mfa", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enroll" })
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error?.message ?? "Failed to start MFA enrollment.");
        return;
      }

      setQrCode(data.data.qrCode);
      setFactorId(data.data.factorId);
      setStep("verify");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (code.length !== 6) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/me/mfa", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", factorId, code })
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error?.message ?? "Verification failed.");
        return;
      }

      setStep("done");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const goToDashboard = () => {
    router.replace("/dashboard");
    router.refresh();
  };

  useEffect(() => {
    let cancelled = false;

    const checkSession = async () => {
      try {
        const response = await fetch("/api/v1/me/mfa", {
          method: "GET",
          credentials: "include"
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          if (!cancelled) {
            setError(
              payload?.error?.message ??
                "Your setup session expired. Open a fresh setup link and try again."
            );
          }
          return;
        }

        if (!cancelled) {
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError("Unable to verify your session. Refresh and try again.");
        }
      } finally {
        if (!cancelled) {
          setSessionChecked(true);
        }
      }
    };

    void checkSession();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="standalone-page auth-page">
      <section
        className="standalone-card auth-card mfa-setup-card"
        style={{ maxWidth: 440, margin: "60px auto", padding: 32 }}
        aria-label="MFA setup"
      >
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: "var(--text-primary)" }}>
          Set Up Your Authenticator
        </h1>

        {step === "start" && (
          <>
            <p style={{ color: "var(--text-secondary)", marginBottom: 20 }}>
              Crew Hub uses authenticator codes to keep your account secure.
              Set up an app like Google Authenticator or Authy to continue.
            </p>
            <button
              className="button button-cta"
              style={{ width: "100%" }}
              onClick={startEnrollment}
              disabled={loading || !sessionChecked || !!error}
            >
              {loading ? "Setting up..." : "Set Up Authenticator"}
            </button>
          </>
        )}

        {step === "verify" && qrCode && (
          <>
            <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
              Scan this QR code with your authenticator app, then enter the
              6-digit code below.
            </p>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginBottom: 20,
                background: "white",
                padding: 20,
                borderRadius: 8,
                border: "1px solid var(--border-subtle)"
              }}
            >
              <img
                src={qrCode}
                alt="Scan this QR code with your authenticator app"
                width={200}
                height={200}
                style={{ display: "block" }}
              />
            </div>
            <label className="form-field" htmlFor="mfa-code">
              <span className="form-label">Verification Code</span>
              <input
                id="mfa-code"
                className="form-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                  if (error) setError(null);
                }}
                placeholder="000000"
                disabled={loading}
              />
            </label>
            <button
              className="button button-cta"
              style={{ width: "100%", marginTop: 12 }}
              onClick={verifyCode}
              disabled={loading || code.length !== 6}
            >
              {loading ? "Verifying..." : "Verify & Enable"}
            </button>
          </>
        )}

        {step === "done" && (
          <>
            <p
              style={{
                color: "var(--color-success)",
                fontWeight: 600,
                marginBottom: 16
              }}
            >
              Your authenticator is set up!
            </p>
            <p style={{ color: "var(--text-secondary)", marginBottom: 20 }}>
              You will enter your email and a 6-digit code from your authenticator
              app each time you sign in.
            </p>
            <button
              className="button button-cta"
              style={{ width: "100%" }}
              onClick={goToDashboard}
            >
              Continue to Dashboard
            </button>
          </>
        )}

        {error && (
          <p className="form-submit-error" role="alert" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}

        <div
          style={{
            marginTop: 24,
            paddingTop: 16,
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 13,
            color: "var(--text-secondary)"
          }}
        >
          <Link
            href="/support"
            style={{ color: "var(--color-accent)", textDecoration: "none" }}
          >
            Help & Support
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: 13,
              padding: 0
            }}
          >
            {signingOut ? "Signing out..." : "Sign out"}
          </button>
        </div>
      </section>
    </main>
  );
}
