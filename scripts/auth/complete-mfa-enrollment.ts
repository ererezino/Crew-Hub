/**
 * Programmatically completes MFA enrollment for a seed user.
 *
 * Usage:
 *   npx tsx scripts/auth/complete-mfa-enrollment.ts --email coo@accrue.test
 *
 * Returns the TOTP secret so it can be used for future sign-ins.
 */
import { createHmac } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

function loadLocalEnvFiles(): void {
  const loadEnvFile = (process as NodeJS.Process & {
    loadEnvFile?: (path?: string) => void;
  }).loadEnvFile;

  if (typeof loadEnvFile === "function") {
    loadEnvFile(".env.local");
    loadEnvFile(".env");
  }
}

function deriveSystemPassword(userId: string, authSecret: string): string {
  return createHmac("sha256", authSecret).update(userId).digest("base64url");
}

function generateTOTP(secret: string): string {
  // Decode base32 secret
  const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const secretBytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of secret.toUpperCase()) {
    const index = base32Chars.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      secretBytes.push((value >>> bits) & 0xff);
    }
  }

  const key = Buffer.from(secretBytes);

  // TOTP: HMAC-SHA1 with 30-second time step
  const time = Math.floor(Date.now() / 1000 / 30);
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeUInt32BE(0, 0);
  timeBuffer.writeUInt32BE(time, 4);

  const hmac = createHmac("sha1", key).update(timeBuffer).digest();

  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    (((hmac[offset]! & 0x7f) << 24) |
      ((hmac[offset + 1]! & 0xff) << 16) |
      ((hmac[offset + 2]! & 0xff) << 8) |
      (hmac[offset + 3]! & 0xff)) %
    1000000;

  return code.toString().padStart(6, "0");
}

async function main() {
  loadLocalEnvFiles();

  const args = process.argv.slice(2);
  let email = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--email") {
      email = args[i + 1] || "";
      i++;
    }
  }

  if (!email) {
    throw new Error("Usage: --email <email>");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
  const authSecret = process.env.AUTH_SYSTEM_SECRET!.trim();

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // 1. Get user profile
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,email")
    .eq("email", email)
    .maybeSingle();

  if (profileError || !profile) {
    throw new Error(`No profile found for ${email}: ${profileError?.message}`);
  }

  const userId = profile.id;

  // 2. Delete all existing MFA factors
  const { data: factorsData } = await admin.auth.admin.mfa.listFactors({ userId });
  const factors = factorsData?.factors ?? [];

  for (const factor of factors) {
    await admin.auth.admin.mfa.deleteFactor({ userId, id: factor.id });
  }

  // 3. Reset password so we can sign in
  const password = deriveSystemPassword(userId, authSecret);
  await admin.auth.admin.updateUserById(userId, { password });

  // 4. Sign in as the user with a fresh client
  const userClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(), {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { error: signInError } = await userClient.auth.signInWithPassword({
    email,
    password
  });

  if (signInError) {
    throw new Error(`Sign-in failed: ${signInError.message}`);
  }

  // 5. Enroll TOTP
  const { data: enrollData, error: enrollError } = await userClient.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Crew Hub ${email} auto-enrolled`
  });

  if (enrollError || !enrollData) {
    throw new Error(`MFA enroll failed: ${enrollError?.message}`);
  }

  // 6. Extract secret from URI
  const uri = enrollData.totp.uri;
  const secretMatch = uri.match(/secret=([A-Z2-7]+)/i);
  if (!secretMatch) {
    throw new Error(`Could not extract secret from URI: ${uri}`);
  }

  const secret = secretMatch[1]!;
  const totpCode = generateTOTP(secret);

  // 7. Challenge + verify
  const { data: challengeData, error: challengeError } = await userClient.auth.mfa.challenge({
    factorId: enrollData.id
  });

  if (challengeError || !challengeData) {
    throw new Error(`MFA challenge failed: ${challengeError?.message}`);
  }

  const { error: verifyError } = await userClient.auth.mfa.verify({
    factorId: enrollData.id,
    challengeId: challengeData.id,
    code: totpCode
  });

  if (verifyError) {
    throw new Error(`MFA verify failed: ${verifyError.message}`);
  }

  // 8. Mark account as set up
  await admin
    .from("profiles")
    .update({ account_setup_at: new Date().toISOString() })
    .eq("id", userId);

  console.log(
    JSON.stringify(
      {
        email,
        userId,
        factorId: enrollData.id,
        totpSecret: secret,
        status: "enrolled_and_verified"
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
