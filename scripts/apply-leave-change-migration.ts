/**
 * One-off: apply 20260609120000_leave_change_requests.sql to the Supabase project in the
 * loaded env (.env.local = staging) via the Supabase Management API.
 *
 * Requires SUPABASE_ACCESS_TOKEN (a personal access token from
 * supabase.com > Account > Access Tokens). The service-role key alone cannot run DDL.
 *
 * Run: node --env-file=.env.local --import tsx scripts/apply-leave-change-migration.ts
 * Prod is refused unless --confirm-production is passed.
 */
import { readFileSync } from "node:fs";

const PROD_REF = "xmeruhyybvyosqxfleiu";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const ref = new URL(url).hostname.split(".")[0];
const flags = process.argv.slice(2).join(" ");
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!token) {
  console.error("Missing SUPABASE_ACCESS_TOKEN. Generate one at supabase.com > Account > Access Tokens,");
  console.error("then re-run: SUPABASE_ACCESS_TOKEN=<token> node --env-file=.env.local --import tsx scripts/apply-leave-change-migration.ts");
  process.exit(1);
}

if (ref === PROD_REF && !flags.includes("--confirm-production")) {
  console.error(`ABORT: target is PRODUCTION (${ref}). Refusing without --confirm-production.`);
  process.exit(1);
}

async function run() {
  const path = "supabase/migrations/20260609120000_leave_change_requests.sql";
  const sql = readFileSync(path, "utf8");

  console.log(`Target Supabase ref: ${ref}${ref === PROD_REF ? " (PRODUCTION)" : " (staging/other)"}`);
  console.log(`Applying ${path} via Management API…\n`);

  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ query: sql })
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`FAILED (${res.status}): ${text}`);
    process.exit(1);
  }

  console.log("=== Migration applied successfully ===");
  console.log(text.slice(0, 400));
}

run().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
