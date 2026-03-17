"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { getModuleState } from "../../lib/feature-state";

type SetupStep = "start" | "verify" | "done" | "passkey-prompt" | "passkey-info";

const passkeysEnabled = getModuleState("passkeys") === "LIVE";

export default function MfaSetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<SetupStep>("start");
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

  const handlePasskeyEnroll = useCallback(async () => {
    if (!passkeysEnabled) return;
    setLoading(true);
    setError(null);

    try {
      /* Dynamic import — only loaded when passkeys are active */
      const { createSupabaseBrowserClient } = await import("../../lib/supabase/client");
      const supabase = createSupabaseBrowserClient();
      const wa = supabase.auth.mfa.webauthn;

      const result = await wa.register({
        friendlyName: "Crew Hub Passkey",
        webauthn: {
          rpId: window.location.hostname,
          rpOrigins: [window.location.origin]
        }
      });

      if (result.error) {
        setError(
          result.error instanceof Error
            ? result.error.message
            : "Unable to register passkey. Try again or skip for now."
        );
        return;
      }

      goToDashboard();
    } catch {
      setError("Passkey registration was cancelled or failed. You can try again or skip.");
    } finally {
      setLoading(false);
    }
  }, []);

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

  const heading =
    step === "passkey-prompt" || step === "passkey-info"
      ? "Make Future Sign-Ins Faster"
      : "Set Up Your Authenticator";

  return (
    <main className="standalone-page auth-page">
      <section
        className="standalone-card auth-card mfa-setup-card"
        style={{ maxWidth: 440, margin: "60px auto", padding: 32 }}
        aria-label="MFA setup"
      >
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: "var(--text-primary)" }}>
          {heading}
        </h1>

        {/* ── Step 1: Start ── */}
        {step === "start" && (
          <>
            <p style={{ color: "var(--text-secondary)", marginBottom: 20 }}>
              Crew Hub uses authenticator codes to keep your account secure.
              We recommend using <strong>1Password</strong>, our company-standard credential manager,
              to scan the QR code. Your codes will auto-fill on every sign-in.
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

        {/* ── Step 2: Verify TOTP ── */}
        {step === "verify" && qrCode && (
          <>
            <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
              Scan this QR code with <strong>1Password</strong> or your authenticator app,
              then enter the 6-digit code below.
            </p>
            <p style={{ color: "var(--text-muted)", marginBottom: 12, fontSize: 13 }}>
              If you already have older Crew Hub entries in your authenticator app,
              remove them and use the newest one. Keep your phone time on automatic.
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

        {/* ── Step 3: OTP Success → transition to passkey prompt or dashboard ── */}
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
            {passkeysEnabled ? (
              <>
                <p style={{ color: "var(--text-secondary)", marginBottom: 20 }}>
                  Great — your account is now secured with authenticator codes.
                  Next, you can add a passkey to make future sign-ins even faster.
                </p>
                <button
                  className="button button-cta"
                  style={{ width: "100%" }}
                  onClick={() => setStep("passkey-prompt")}
                >
                  Continue
                </button>
              </>
            ) : (
              <>
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
          </>
        )}

        {/* ── Step 4: Passkey enrollment prompt ── */}
        {step === "passkey-prompt" && (
          <>
            <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
              Your session expires after 45 minutes of inactivity for security.
              Adding a passkey means signing back in takes <strong>one tap</strong> — no codes needed.
            </p>

            <div
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: 16,
                marginBottom: 20,
                fontSize: 13,
                lineHeight: 1.5
              }}
            >
              <p style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
                We recommend 1Password
              </p>
              <p style={{ color: "var(--text-secondary)", margin: 0 }}>
                When prompted, choose &ldquo;Save in 1Password&rdquo; to store your passkey.
                It syncs across all your devices so you can sign in from anywhere.
              </p>
            </div>

            <button
              className="button button-cta"
              style={{ width: "100%", marginBottom: 8 }}
              onClick={handlePasskeyEnroll}
              disabled={loading}
            >
              {loading ? "Setting up passkey..." : "Add a Passkey"}
            </button>
            <button
              className="button"
              style={{ width: "100%", marginBottom: 8 }}
              onClick={goToDashboard}
            >
              I&apos;ll do this later
            </button>
            <button
              type="button"
              onClick={() => setStep("passkey-info")}
              style={{
                background: "none",
                border: "none",
                color: "var(--color-accent)",
                cursor: "pointer",
                fontSize: 13,
                padding: 0,
                width: "100%",
                textAlign: "center"
              }}
            >
              What&apos;s a passkey?
            </button>
          </>
        )}

        {/* ── Step 4b: Passkey info / more info ── */}
        {step === "passkey-info" && (
          <>
            <div
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: 16,
                marginBottom: 20,
                fontSize: 13,
                lineHeight: 1.7,
                color: "var(--text-secondary)"
              }}
            >
              <p style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
                What&apos;s a passkey?
              </p>
              <p style={{ marginBottom: 12 }}>
                A passkey lets you sign in with your fingerprint, face, or device screen lock —
                no codes needed. It&apos;s faster and more secure than typing a 6-digit code.
              </p>

              <p style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
                Why do sessions expire?
              </p>
              <p style={{ marginBottom: 12 }}>
                Crew Hub handles sensitive HR, payroll, and employee data.
                Sessions expire after 45 minutes of inactivity and 12 hours maximum
                to protect your team&apos;s information. Passkeys make signing back in
                quick and painless.
              </p>

              <p style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
                Setting up with 1Password
              </p>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                <li style={{ marginBottom: 6 }}>
                  Your authenticator code is already saved if you scanned the QR with 1Password
                </li>
                <li style={{ marginBottom: 6 }}>
                  When prompted to create a passkey, choose &ldquo;Save in 1Password&rdquo; —
                  your passkey syncs across all your devices
                </li>
                <li>
                  Need help? Ask your admin or check 1Password&apos;s setup guide
                </li>
              </ul>
            </div>

            <button
              className="button button-cta"
              style={{ width: "100%", marginBottom: 8 }}
              onClick={handlePasskeyEnroll}
              disabled={loading}
            >
              {loading ? "Setting up passkey..." : "Add a Passkey"}
            </button>
            <button
              className="button"
              style={{ width: "100%" }}
              onClick={goToDashboard}
            >
              I&apos;ll do this later
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
