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

export async function register() {
  validateEnvironment();

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = (await import("@sentry/nextjs")).captureRequestError;
