import { createHmac } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { extractSupabaseProjectRef } from "../../lib/supabase/project-ref";

type CliOptions = {
  email: string;
  appUrl: string;
  allowProdProject: boolean;
  expectedProjectRef: string | null;
};

function loadLocalEnvFiles(): void {
  const loadEnvFile = (process as NodeJS.Process & {
    loadEnvFile?: (path?: string) => void;
  }).loadEnvFile;

  if (typeof loadEnvFile === "function") {
    loadEnvFile(".env.local");
    loadEnvFile(".env");
  }
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    email: "",
    appUrl: process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000",
    allowProdProject: false,
    expectedProjectRef: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === "--email") {
      options.email = (argv[index + 1] || "").trim();
      index += 1;
      continue;
    }

    if (current === "--app-url") {
      options.appUrl = (argv[index + 1] || "").trim();
      index += 1;
      continue;
    }

    if (current === "--expected-project-ref") {
      const value = (argv[index + 1] || "").trim().toLowerCase();
      options.expectedProjectRef = value || null;
      index += 1;
      continue;
    }

    if (current === "--allow-prod-project") {
      options.allowProdProject = true;
      continue;
    }
  }

  if (!options.email) {
    throw new Error("Missing required --email option.");
  }

  return options;
}

function deriveSystemPassword(userId: string, authSecret: string): string {
  return createHmac("sha256", authSecret).update(userId).digest("base64url");
}

function normalizeAppUrl(appUrl: string): string {
  const parsed = new URL(appUrl);
  const normalized = parsed.toString();
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

async function main() {
  loadLocalEnvFiles();
  const options = parseArgs(process.argv.slice(2));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const authSecret = process.env.AUTH_SYSTEM_SECRET?.trim();

  if (!supabaseUrl || !serviceRoleKey || !authSecret) {
    throw new Error(
      "Missing required env vars. Ensure NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and AUTH_SYSTEM_SECRET are set."
    );
  }

  const currentProjectRef = extractSupabaseProjectRef(supabaseUrl);
  if (!currentProjectRef) {
    throw new Error("Unable to parse Supabase project ref from NEXT_PUBLIC_SUPABASE_URL.");
  }

  if (options.expectedProjectRef && options.expectedProjectRef !== currentProjectRef) {
    throw new Error(
      `Project mismatch. Expected '${options.expectedProjectRef}', but current env points to '${currentProjectRef}'.`
    );
  }

  const productionProjectRef =
    process.env.PRODUCTION_SUPABASE_PROJECT_REF?.trim().toLowerCase() || "";
  const isProductionProject =
    productionProjectRef.length > 0 && currentProjectRef === productionProjectRef;

  if (isProductionProject && !options.allowProdProject) {
    throw new Error(
      "Refusing to mutate auth on production Supabase project from this script. Re-run with --allow-prod-project only if intentional."
    );
  }

  const appUrl = normalizeAppUrl(options.appUrl);
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,email")
    .eq("email", options.email)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Profile lookup failed: ${profileError.message}`);
  }

  if (!profile?.id || !profile?.email) {
    throw new Error(`No profile found for ${options.email}.`);
  }

  const userId = profile.id;
  const { data: factorsData, error: listError } = await admin.auth.admin.mfa.listFactors({
    userId
  });

  if (listError) {
    throw new Error(`Unable to list MFA factors: ${listError.message}`);
  }

  const totpFactors = (factorsData?.factors ?? []).filter(
    (factor) => factor.factor_type === "totp"
  );

  for (const factor of totpFactors) {
    const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({
      userId,
      id: factor.id
    });
    if (deleteError) {
      throw new Error(`Unable to delete factor ${factor.id}: ${deleteError.message}`);
    }
  }

  const { error: passwordError } = await admin.auth.admin.updateUserById(userId, {
    password: deriveSystemPassword(userId, authSecret)
  });

  if (passwordError) {
    throw new Error(`Unable to reset system password: ${passwordError.message}`);
  }

  const { error: profileUpdateError } = await admin
    .from("profiles")
    .update({ account_setup_at: null })
    .eq("id", userId);

  if (profileUpdateError) {
    throw new Error(`Unable to clear account setup state: ${profileUpdateError.message}`);
  }

  const redirectTo = `${appUrl}/api/auth/callback?next=/mfa-setup`;
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: options.email,
    options: { redirectTo }
  });

  if (linkError || !linkData?.properties) {
    throw new Error(`Unable to generate recovery link: ${linkError?.message ?? "Unknown error"}`);
  }

  const setupLink = linkData.properties.hashed_token
    ? `${appUrl}/api/auth/callback?token_hash=${encodeURIComponent(
      linkData.properties.hashed_token
    )}&type=recovery&next=%2Fmfa-setup`
    : linkData.properties.action_link;

  if (!setupLink) {
    throw new Error("Recovery link generation did not return a setup link.");
  }

  console.log(
    JSON.stringify(
      {
        email: options.email,
        userId,
        projectRef: currentProjectRef,
        removedFactors: totpFactors.length,
        setupLink
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
