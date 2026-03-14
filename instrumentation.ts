const REQUIRED_ENV_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY"
];

function validateEnvironment() {
  const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);

  if (missing.length > 0) {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        message: "Missing required environment variables",
        missing
      })
    );
    // Don't crash — Vercel preview deployments may have partial env
    // But log loudly so operators notice
  }
}

const PRODUCTION_PROJECT_REF = "xmeruhyybvyosqxfleiu";

function enforceEnvironmentIsolation() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const isProductionSupabase = supabaseUrl.includes(PRODUCTION_PROJECT_REF);
  const isProductionHost = process.env.VERCEL_ENV === "production";

  if (!isProductionHost && isProductionSupabase) {
    throw new Error(
      "FATAL: Non-production host is configured against production Supabase project " +
        `(${PRODUCTION_PROJECT_REF}). This is a misconfiguration. ` +
        "Set NEXT_PUBLIC_SUPABASE_URL to the staging project."
    );
  }
}

// ---------------------------------------------------------------------------
// Schema compatibility check
// ---------------------------------------------------------------------------
// Verifies that required database columns/tables exist before the app serves
// requests. Prevents incidents where code is deployed before migrations.
//
// Add entries here when a migration adds columns that the app depends on at
// the session/auth layer (i.e., columns whose absence breaks ALL users).
// ---------------------------------------------------------------------------

const REQUIRED_SCHEMA: { table: string; column: string }[] = [
  { table: "profiles", column: "team_lead_id" },
  { table: "profiles", column: "manager_id" }
];

async function verifySchemaCompatibility() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) return; // env validation already logged

  const failures: string[] = [];

  for (const { table, column } of REQUIRED_SCHEMA) {
    try {
      const url = `${supabaseUrl}/rest/v1/${table}?select=${column}&limit=0`;
      const resp = await fetch(url, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`
        }
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        if (body.includes("does not exist") || resp.status === 400) {
          failures.push(`${table}.${column}`);
        }
      }
    } catch {
      // Network error — don't block startup, but log
      console.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "warn",
          message: `Schema check skipped (network error): ${table}.${column}`
        })
      );
    }
  }

  if (failures.length > 0) {
    const msg =
      `FATAL: Required database columns are missing: ${failures.join(", ")}. ` +
      "The migration has not been applied. Run pending migrations before deploying.";

    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        message: msg,
        missingColumns: failures
      })
    );

    // In production, crash hard to prevent serving broken responses.
    // In dev/preview, log but don't crash (migration may be in progress).
    if (process.env.VERCEL_ENV === "production") {
      throw new Error(msg);
    }
  }
}

export async function register() {
  validateEnvironment();
  enforceEnvironmentIsolation();
  await verifySchemaCompatibility();

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = (await import("@sentry/nextjs")).captureRequestError;
