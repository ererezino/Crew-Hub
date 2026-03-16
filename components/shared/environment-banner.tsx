"use client";

import { useEffect, useState } from "react";

const PRODUCTION_PROJECT_REF = "xmeruhyybvyosqxfleiu";

/**
 * Derive the environment label purely from build-time env vars (stable
 * across SSR and CSR) and, for the LOCAL vs STAGING distinction, defer
 * to a client-only effect so SSR and hydration always agree.
 */
function isNonProduction(): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return !supabaseUrl.includes(PRODUCTION_PROJECT_REF);
}

function getStaticLabel(): string | null {
  if (!isNonProduction()) return null;
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;
  if (vercelEnv === "preview") return "PREVIEW";
  // LOCAL vs STAGING is resolved client-side to avoid hydration mismatch
  return null;
}

export function EnvironmentBanner() {
  const staticLabel = getStaticLabel();
  const [label, setLabel] = useState<string | null>(staticLabel);

  // Resolve LOCAL vs STAGING after mount (window is available)
  useEffect(() => {
    if (!isNonProduction()) return;
    if (staticLabel) return; // already resolved (e.g. PREVIEW)

    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      setLabel("LOCAL");
    } else {
      setLabel("STAGING");
    }
  }, [staticLabel]);

  useEffect(() => {
    if (!label) return;
    const original = document.title;
    document.title = `[${label}] ${original}`;
    return () => {
      document.title = original;
    };
  }, [label]);

  useEffect(() => {
    if (!label) return;
    document.documentElement.style.setProperty("--env-banner-height", "24px");
    return () => {
      document.documentElement.style.removeProperty("--env-banner-height");
    };
  }, [label]);

  if (!label) return null;

  return (
    <div
      role="status"
      aria-label={`${label} environment`}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 24,
        zIndex: 99999,
        background: "#f59e0b",
        color: "#000",
        textAlign: "center",
        fontSize: "12px",
        fontWeight: 700,
        fontFamily: "system-ui, sans-serif",
        padding: "3px 0",
        letterSpacing: "0.05em",
        pointerEvents: "none",
      }}
    >
      {`${label} ENVIRONMENT — Not production`}
    </div>
  );
}
