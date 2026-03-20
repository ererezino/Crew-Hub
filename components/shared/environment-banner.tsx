"use client";

import { useEffect, useState } from "react";

const PRODUCTION_PROJECT_REF = "xmeruhyybvyosqxfleiu";

export function isNonProductionSupabaseUrl(supabaseUrl: string | null | undefined): boolean {
  return !(supabaseUrl ?? "").includes(PRODUCTION_PROJECT_REF);
}

export function resolveEnvironmentBannerLabel({
  supabaseUrl,
  vercelEnv,
  hostname
}: {
  supabaseUrl?: string | null;
  vercelEnv?: string | null;
  hostname?: string | null;
}): string | null {
  if (!isNonProductionSupabaseUrl(supabaseUrl)) {
    return null;
  }

  if (vercelEnv === "preview") return "PREVIEW";

  if (!hostname) {
    return null;
  }

  return hostname === "localhost" || hostname === "127.0.0.1" ? "LOCAL" : "STAGING";
}

export function EnvironmentBanner() {
  const [label] = useState<string | null>(() =>
    resolveEnvironmentBannerLabel({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV,
      hostname: typeof window === "undefined" ? null : window.location.hostname
    })
  );

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
      {`${label} ENVIRONMENT - Not production`}
    </div>
  );
}
