/**
 * Script safety guards — prevents accidental production mutations.
 *
 * Usage:
 *   import { assertSafety } from "./lib/safety.mjs";
 *   assertSafety({ seedOnly: true });                   // blocks production entirely
 *   assertSafety({ requireEnv: true, requireConfirm: true }); // requires --env=production --confirm
 */

const PRODUCTION_PROJECT_REF = "xmeruhyybvyosqxfleiu";
const PRODUCTION_ORG_ID = "0c0e516f-5896-4f3b-a163-42e8460e5faa";

function getProjectRef(supabaseUrl) {
  try {
    return new URL(supabaseUrl).hostname.split(".")[0];
  } catch {
    return null;
  }
}

function parseFlags() {
  const args = process.argv.slice(2);
  const flags = {};
  for (const arg of args) {
    const [key, val] = arg.replace(/^--/, "").split("=");
    flags[key] = val ?? true;
  }
  return flags;
}

/**
 * @param {object} opts
 * @param {boolean} [opts.seedOnly]        — if true, script is blocked from production entirely
 * @param {boolean} [opts.requireEnv]      — if true, --env=production required for production
 * @param {boolean} [opts.requireConfirm]  — if true, --confirm required for production
 * @param {boolean} [opts.requireOrgId]    — if true, org ID is checked after client creation
 * @returns {{ isProduction: boolean, projectRef: string, flags: object }}
 */
export function assertSafety(opts = {}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    console.error("ABORT: Missing NEXT_PUBLIC_SUPABASE_URL.");
    process.exit(1);
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("ABORT: Missing SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const projectRef = getProjectRef(supabaseUrl);
  if (!projectRef) {
    console.error("ABORT: Cannot parse project ref from NEXT_PUBLIC_SUPABASE_URL.");
    process.exit(1);
  }

  const isProduction = projectRef === PRODUCTION_PROJECT_REF;
  const flags = parseFlags();

  // Seed scripts: unconditionally blocked from production
  if (opts.seedOnly && isProduction) {
    console.error("ABORT: Seed scripts cannot run against production.");
    console.error(`Detected production project ref: ${PRODUCTION_PROJECT_REF}`);
    console.error("This script is for staging/local environments only.");
    process.exit(1);
  }

  // Destructive scripts: require explicit --env=production
  if (opts.requireEnv && isProduction && flags.env !== "production") {
    console.error(`ABORT: Detected production Supabase project (${PRODUCTION_PROJECT_REF}).`);
    console.error("Pass --env=production to confirm this is intentional.");
    process.exit(1);
  }

  // Destructive scripts: require --confirm
  if (opts.requireConfirm && isProduction && !flags.confirm) {
    console.error("ABORT: Destructive operation on production requires --confirm flag.");
    console.error("Review dry-run output first, then re-run with --confirm.");
    process.exit(1);
  }

  return { isProduction, projectRef, flags };
}

/**
 * After creating a Supabase client, verify org ID matches expected production org.
 * Call this only for scripts that target production.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 */
export async function assertOrgId(client) {
  const { data, error } = await client
    .from("orgs")
    .select("id")
    .limit(2);

  if (error) {
    console.error(`ABORT: Failed to query orgs table: ${error.message}`);
    process.exit(1);
  }
  if (!data || data.length !== 1) {
    console.error(`ABORT: Expected exactly 1 org, found ${data?.length ?? 0}.`);
    process.exit(1);
  }
  if (data[0].id !== PRODUCTION_ORG_ID) {
    console.error(`ABORT: Org ID mismatch. Expected ${PRODUCTION_ORG_ID}, got ${data[0].id}.`);
    console.error("Wrong database — check your environment.");
    process.exit(1);
  }
}

export { PRODUCTION_PROJECT_REF, PRODUCTION_ORG_ID };
