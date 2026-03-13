/**
 * One-time migration script: set system-derived passwords for all existing users.
 *
 * Run with: node scripts/migrate-passwords.mjs
 *
 * After running, all users can authenticate via the email + TOTP login flow.
 * Users who already have TOTP enrolled can log in immediately.
 * Users without TOTP need an admin to resend their invite.
 */

import { assertSafety } from "./lib/safety.mjs";
assertSafety({ requireEnv: true, requireConfirm: true });

import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AUTH_SYSTEM_SECRET = process.env.AUTH_SYSTEM_SECRET;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !AUTH_SYSTEM_SECRET) {
  console.error(
    "Missing env vars. Ensure NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and AUTH_SYSTEM_SECRET are set."
  );
  console.error("Run with: node --env-file=.env.local scripts/migrate-passwords.mjs");
  process.exit(1);
}

function deriveSystemPassword(userId) {
  return createHmac("sha256", AUTH_SYSTEM_SECRET).update(userId).digest("base64url");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
  console.log("Fetching all users from auth.users...\n");

  const { data: usersResponse, error: listError } =
    await supabase.auth.admin.listUsers({ perPage: 1000 });

  if (listError) {
    console.error("Failed to list users:", listError.message);
    process.exit(1);
  }

  const users = usersResponse?.users ?? [];
  console.log(`Found ${users.length} user(s).\n`);

  let updated = 0;
  let failed = 0;

  for (const user of users) {
    const systemPassword = deriveSystemPassword(user.id);

    const { error: updateError } = await supabase.auth.admin.updateUserById(
      user.id,
      { password: systemPassword }
    );

    if (updateError) {
      console.error(`  ✗ ${user.email} (${user.id}): ${updateError.message}`);
      failed += 1;
    } else {
      console.log(`  ✓ ${user.email} (${user.id})`);
      updated += 1;
    }
  }

  console.log(`\nDone. Updated: ${updated}, Failed: ${failed}`);
}

main();
