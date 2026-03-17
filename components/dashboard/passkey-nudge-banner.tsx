"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, X } from "lucide-react";

import { getModuleState } from "../../lib/feature-state";

const DISMISSED_KEY = "crewhub-passkey-nudge-dismissed";
const passkeysEnabled = getModuleState("passkeys") === "LIVE";

/**
 * Dashboard banner nudging existing users to add a passkey.
 *
 * - Only shown when passkeys feature is LIVE
 * - Only shown when the user has TOTP but no passkeys
 * - Dismissible per-device (localStorage)
 */
export function PasskeyNudgeBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!passkeysEnabled) return;

    /* Check if previously dismissed */
    if (typeof window !== "undefined" && window.localStorage.getItem(DISMISSED_KEY)) return;

    /* Fetch MFA status to determine if user has passkeys */
    fetch("/api/v1/me/mfa")
      .then((res) => res.json())
      .then((json: { data?: { enrolled?: boolean; passkeyCount?: number } }) => {
        const enrolled = json.data?.enrolled ?? false;
        const passkeyCount = json.data?.passkeyCount ?? 0;

        /* Show nudge only if TOTP enrolled but no passkey */
        if (enrolled && passkeyCount === 0) {
          setVisible(true);
        }
      })
      .catch(() => {
        /* Silent — don't block the dashboard */
      });
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISSED_KEY, new Date().toISOString());
    } catch {
      /* localStorage may be full — ignore */
    }
  }, []);

  if (!visible) return null;

  return (
    <div
      className="dashboard-nudge-banner"
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "12px 16px",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 8,
        marginBottom: "var(--space-4)",
        fontSize: 14,
        lineHeight: 1.5
      }}
    >
      <ShieldCheck size={20} style={{ flexShrink: 0, color: "var(--color-accent)" }} />
      <div style={{ flex: 1 }}>
        <p style={{ margin: 0, fontWeight: 600, color: "var(--text-primary)" }}>
          Sign in faster with a passkey
        </p>
        <p style={{ margin: "2px 0 0", color: "var(--text-secondary)", fontSize: 13 }}>
          Skip typing codes every time your session expires.
          We recommend saving your passkey in <strong>1Password</strong> so it syncs across devices.
        </p>
      </div>
      <Link
        href="/settings?tab=security"
        className="button button-accent"
        style={{ flexShrink: 0, fontSize: 13, padding: "6px 14px" }}
      >
        Add passkey
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss passkey nudge"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 4,
          color: "var(--text-muted)",
          flexShrink: 0
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
