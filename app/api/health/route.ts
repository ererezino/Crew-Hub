import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "../../../lib/supabase/service-role";

type HealthStatus = "healthy" | "degraded" | "unhealthy";

type HealthCheck = {
  status: HealthStatus;
  version: string;
  uptime: number;
  timestamp: string;
  checks: {
    database: { status: HealthStatus; latencyMs: number | null };
    environment: { status: HealthStatus; missing: string[] };
  };
};

const REQUIRED_ENV_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY"
];

const OPTIONAL_ENV_VARS = [
  "RESEND_API_KEY",
  "RESEND_FROM",
  "PAYMENT_ENCRYPTION_KEY",
  "CRON_SECRET",
  "SENTRY_DSN"
];

const startTime = Date.now();

export async function GET() {
  const missingRequired = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
  const missingOptional = OPTIONAL_ENV_VARS.filter((v) => !process.env[v]);

  let dbStatus: HealthStatus = "unhealthy";
  let dbLatency: number | null = null;

  try {
    const dbStart = Date.now();
    const supabase = createSupabaseServiceRoleClient();
    const { error } = await supabase
      .from("orgs")
      .select("id")
      .limit(1)
      .maybeSingle();

    dbLatency = Date.now() - dbStart;
    dbStatus = error ? "degraded" : "healthy";
  } catch {
    dbStatus = "unhealthy";
  }

  const envStatus: HealthStatus =
    missingRequired.length > 0 ? "unhealthy" : "healthy";

  const overallStatus: HealthStatus =
    dbStatus === "unhealthy" || envStatus === "unhealthy"
      ? "unhealthy"
      : dbStatus === "degraded"
        ? "degraded"
        : "healthy";

  const health: HealthCheck = {
    status: overallStatus,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    checks: {
      database: { status: dbStatus, latencyMs: dbLatency },
      environment: {
        status: envStatus,
        missing: [
          ...missingRequired.map((v) => `${v} (required)`),
          ...missingOptional.map((v) => `${v} (optional)`)
        ]
      }
    }
  };

  const statusCode = overallStatus === "healthy" ? 200 : 503;

  return NextResponse.json(health, { status: statusCode });
}
