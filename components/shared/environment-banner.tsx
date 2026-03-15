"use client";

import { useEffect } from "react";

const PRODUCTION_PROJECT_REF = "xmeruhyybvyosqxfleiu";

function getEnvironmentLabel(): string | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (supabaseUrl.includes(PRODUCTION_PROJECT_REF)) return null;

  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;
  if (vercelEnv === "preview") return "PREVIEW";
  if (typeof window !== "undefined" && window.location.hostname === "localhost") return "LOCAL";
  return "STAGING";
}

export function EnvironmentBanner() {
  const label = getEnvironmentLabel();

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
