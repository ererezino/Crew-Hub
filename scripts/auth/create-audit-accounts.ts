/**
 * Creates test accounts for multi-role audit: TEAM_LEAD, HR_ADMIN-only, FINANCE_ADMIN-only.
 * Also sets ops.associate to new_hire persona (recent start_date + active onboarding).
 *
 * Usage:
 *   npx tsx scripts/auth/create-audit-accounts.ts
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

const AUDIT_ACCOUNTS = [
  {
    email: "teamlead@accrue.test",
    fullName: "Kofi Mensah",
    title: "Engineering Team Lead",
    department: "Engineering",
    roles: ["TEAM_LEAD"],
    countryCode: "GH",
    timezone: "Africa/Accra"
  },
  {
    email: "hradmin@accrue.test",
    fullName: "Fatima Bello",
    title: "HR Administrator",
    department: "People",
    roles: ["HR_ADMIN"],
    countryCode: "NG",
    timezone: "Africa/Lagos"
  },
  {
    email: "financeadmin@accrue.test",
    fullName: "David Kamau",
    title: "Finance Administrator",
    department: "Finance",
    roles: ["FINANCE_ADMIN"],
    countryCode: "KE",
    timezone: "Africa/Nairobi"
  },
  {
    email: "financeapprover@accrue.test",
    fullName: "Amina Osei",
    title: "Chief Financial Officer",
    department: "Finance",
    roles: ["FINANCE_APPROVER"],
    countryCode: "GH",
    timezone: "Africa/Accra"
  }
];

async function main() {
  loadLocalEnvFiles();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim();
  const authSecret = process.env.AUTH_SYSTEM_SECRET!.trim();

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Get org_id from existing seed user
  const { data: orgProfile } = await admin
    .from("profiles")
    .select("org_id")
    .eq("email", "coo@accrue.test")
    .single();

  if (!orgProfile) {
    throw new Error("Could not find org from coo@accrue.test profile");
  }

  const orgId = orgProfile.org_id;
  const results: Array<{ email: string; roles: string[]; totpSecret: string }> = [];

  for (const account of AUDIT_ACCOUNTS) {
    console.log(`\n--- Creating ${account.email} (${account.roles.join(", ")}) ---`);

    // Check if already exists
    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .eq("email", account.email)
      .maybeSingle();

    let userId: string;

    if (existing) {
      console.log("  Profile exists, updating roles...");
      userId = existing.id;
      await admin
        .from("profiles")
        .update({ roles: account.roles })
        .eq("id", userId);
    } else {
      // Create auth user
      const password = "AuditTest2026!";
      const { data: authData, error: authError } = await admin.auth.admin.createUser({
        email: account.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: account.fullName }
      });

      if (authError || !authData.user) {
        console.error(`  Failed to create auth user: ${authError?.message}`);
        continue;
      }

      userId = authData.user.id;
      console.log(`  Created auth user: ${userId}`);

      // Create profile
      const { error: profileError } = await admin.from("profiles").upsert(
        {
          id: userId,
          org_id: orgId,
          email: account.email,
          full_name: account.fullName,
          title: account.title,
          department: account.department,
          roles: account.roles,
          country_code: account.countryCode,
          timezone: account.timezone,
          status: "active",
          employment_type: "full_time",
          payroll_mode: "contractor_usd_no_withholding",
          primary_currency: "USD",
          start_date: "2025-06-01",
          account_setup_at: new Date().toISOString()
        },
        { onConflict: "id" }
      );

      if (profileError) {
        console.error(`  Failed to create profile: ${profileError.message}`);
        continue;
      }
      console.log("  Profile created.");
    }

    // Reset password for sign-in
    const password = deriveSystemPassword(userId, authSecret);
    await admin.auth.admin.updateUserById(userId, { password });

    // Delete existing MFA factors
    const { data: factorsData } = await admin.auth.admin.mfa.listFactors({ userId });
    for (const factor of factorsData?.factors ?? []) {
      await admin.auth.admin.mfa.deleteFactor({ userId, id: factor.id });
    }

    // Sign in as the user
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { error: signInError } = await userClient.auth.signInWithPassword({
      email: account.email,
      password
    });

    if (signInError) {
      console.error(`  Sign-in failed: ${signInError.message}`);
      continue;
    }

    // Enroll TOTP
    const { data: enrollData, error: enrollError } = await userClient.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Crew Hub ${account.email} audit`
    });

    if (enrollError || !enrollData) {
      console.error(`  MFA enroll failed: ${enrollError?.message}`);
      continue;
    }

    const uri = enrollData.totp.uri;
    const secretMatch = uri.match(/secret=([A-Z2-7]+)/i);
    if (!secretMatch) {
      console.error(`  Could not extract TOTP secret from URI`);
      continue;
    }

    const totpSecret = secretMatch[1]!;
    const totpCode = generateTOTP(totpSecret);

    // Challenge + verify
    const { data: challengeData, error: challengeError } = await userClient.auth.mfa.challenge({
      factorId: enrollData.id
    });

    if (challengeError || !challengeData) {
      console.error(`  MFA challenge failed: ${challengeError?.message}`);
      continue;
    }

    const { error: verifyError } = await userClient.auth.mfa.verify({
      factorId: enrollData.id,
      challengeId: challengeData.id,
      code: totpCode
    });

    if (verifyError) {
      console.error(`  MFA verify failed: ${verifyError.message}`);
      continue;
    }

    // Mark account setup complete
    await admin
      .from("profiles")
      .update({ account_setup_at: new Date().toISOString() })
      .eq("id", userId);

    console.log(`  MFA enrolled. TOTP secret: ${totpSecret}`);
    results.push({ email: account.email, roles: account.roles, totpSecret });
  }

  // Now set up ops.associate as new_hire persona
  console.log("\n--- Configuring ops.associate@accrue.test as new_hire persona ---");
  const today = new Date();
  const recentStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 5);

  const { data: opsProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("email", "ops.associate@accrue.test")
    .single();

  if (opsProfile) {
    // Set start_date to 5 days ago for new_hire persona
    await admin
      .from("profiles")
      .update({ start_date: recentStart.toISOString().split("T")[0] })
      .eq("id", opsProfile.id);

    // Check if there's an active onboarding instance
    const { data: onboardingInstance } = await admin
      .from("onboarding_instances")
      .select("id, status")
      .eq("employee_id", opsProfile.id)
      .eq("status", "active")
      .maybeSingle();

    if (onboardingInstance) {
      console.log("  Active onboarding instance exists. New hire persona should be active.");
    } else {
      console.log("  No active onboarding instance. Creating one...");
      // Get a template
      const { data: template } = await admin
        .from("onboarding_templates")
        .select("id")
        .limit(1)
        .maybeSingle();

      if (template) {
        await admin.from("onboarding_instances").insert({
          employee_id: opsProfile.id,
          org_id: orgId,
          template_id: template.id,
          status: "active",
          start_date: recentStart.toISOString().split("T")[0]
        });
        console.log("  Created onboarding instance.");
      } else {
        console.log("  No onboarding template found. New hire persona may not trigger.");
      }
    }

    console.log(`  Updated start_date to ${recentStart.toISOString().split("T")[0]}`);
  }

  console.log("\n=== AUDIT ACCOUNTS SUMMARY ===");
  for (const r of results) {
    console.log(`${r.email} [${r.roles.join(", ")}] TOTP: ${r.totpSecret}`);
  }
  console.log("\nExisting accounts (already enrolled):");
  console.log("coo@accrue.test [SUPER_ADMIN] TOTP: QTN6WMAR3WVBF2SXOHJV65MYLHTV76ZA");
  console.log("eng.manager@accrue.test [MANAGER] TOTP: YHGQBWHWAK7E6J3MC7AND5KMOB7FCNAT");
  console.log("engineer1@accrue.test [EMPLOYEE] TOTP: U5AG52MSKZPK2BBRSKTSBM43QEWQTERE");
  console.log("people.finance@accrue.test [HR_ADMIN,FINANCE_ADMIN] TOTP: TCYU4422EEYTXNPNEDIEL3HIFPMG4XIG");
  console.log("ops.associate@accrue.test [EMPLOYEE/new_hire] TOTP: X32MWZA5F5KKIV33N5YZZLFSGCEUW6ZX");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
