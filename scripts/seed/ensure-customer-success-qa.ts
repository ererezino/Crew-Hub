import { randomBytes } from "node:crypto";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const CUSTOMER_SUCCESS_FIXTURES = [
  {
    email: "cs.qa.amara@accrue.test",
    fullName: "Amara Nwosu",
    title: "Customer Success Specialist",
    countryCode: "NG",
    timezone: "Africa/Lagos",
    weekendShiftHours: "8"
  },
  {
    email: "cs.qa.kojo@accrue.test",
    fullName: "Kojo Asare",
    title: "Customer Success Associate",
    countryCode: "GH",
    timezone: "Africa/Accra",
    weekendShiftHours: "4"
  },
  {
    email: "cs.qa.njeri@accrue.test",
    fullName: "Njeri Kamau",
    title: "Customer Success Associate",
    countryCode: "KE",
    timezone: "Africa/Nairobi",
    weekendShiftHours: "3"
  },
  {
    email: "cs.qa.laila@accrue.test",
    fullName: "Laila Yusuf",
    title: "Customer Success Specialist",
    countryCode: "NG",
    timezone: "Africa/Lagos",
    weekendShiftHours: "8"
  },
  {
    email: "cs.qa.kwame@accrue.test",
    fullName: "Kwame Boateng",
    title: "Customer Success Associate",
    countryCode: "GH",
    timezone: "Africa/Accra",
    weekendShiftHours: "8"
  }
] as const;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function createServiceRoleClient(): SupabaseClient {
  const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const productionRef = process.env.PRODUCTION_SUPABASE_PROJECT_REF;

  if (!projectRef || projectRef === productionRef || projectRef === "xmeruhyybvyosqxfleiu") {
    throw new Error("Customer Success QA fixtures cannot be created in production.");
  }

  return createClient(supabaseUrl, requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

async function listUsersByEmail(client: SupabaseClient): Promise<Map<string, User>> {
  const usersByEmail = new Map<string, User>();

  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      throw new Error(`Unable to list auth users: ${error.message}`);
    }

    for (const user of data.users) {
      if (user.email) {
        usersByEmail.set(user.email.toLowerCase(), user);
      }
    }

    if (data.users.length < 200) {
      return usersByEmail;
    }
  }
}

async function ensureAuthUser(
  client: SupabaseClient,
  usersByEmail: Map<string, User>,
  fixture: (typeof CUSTOMER_SUCCESS_FIXTURES)[number]
): Promise<string> {
  const emailKey = fixture.email.toLowerCase();
  const existingUser = usersByEmail.get(emailKey);
  if (existingUser) {
    return existingUser.id;
  }

  const { data, error } = await client.auth.admin.createUser({
    email: fixture.email,
    password: randomBytes(24).toString("base64url"),
    email_confirm: true,
    user_metadata: {
      full_name: fixture.fullName,
      qa_fixture: "customer-success-scheduling"
    }
  });

  if (error || !data.user) {
    throw new Error(
      `Unable to create auth user for ${fixture.email}: ${error?.message ?? "unknown error"}`
    );
  }

  usersByEmail.set(emailKey, data.user);
  return data.user.id;
}

async function main() {
  const client = createServiceRoleClient();
  const { data: anchor, error: anchorError } = await client
    .from("profiles")
    .select("id, org_id")
    .eq("email", "people.finance@accrue.test")
    .is("deleted_at", null)
    .single();

  if (anchorError || !anchor) {
    throw new Error("QA tenant anchor profile people.finance@accrue.test was not found.");
  }

  const usersByEmail = await listUsersByEmail(client);

  for (const fixture of CUSTOMER_SUCCESS_FIXTURES) {
    const userId = await ensureAuthUser(client, usersByEmail, fixture);
    const { data: existingProfile, error: existingProfileError } = await client
      .from("profiles")
      .select("org_id")
      .eq("id", userId)
      .maybeSingle();

    if (existingProfileError) {
      throw new Error(`Unable to inspect profile for ${fixture.email}: ${existingProfileError.message}`);
    }
    if (existingProfile && existingProfile.org_id !== anchor.org_id) {
      throw new Error(`Refusing to move ${fixture.email} from another organization.`);
    }

    const { error: profileError } = await client.from("profiles").upsert({
      id: userId,
      org_id: anchor.org_id,
      email: fixture.email,
      full_name: fixture.fullName,
      roles: ["EMPLOYEE"],
      department: "Customer Success",
      title: fixture.title,
      country_code: fixture.countryCode,
      timezone: fixture.timezone,
      employment_type: "contractor",
      payroll_mode: "contractor_usd_no_withholding",
      primary_currency: "USD",
      manager_id: anchor.id,
      status: "active",
      schedule_type: "weekend_primary",
      weekend_shift_hours: fixture.weekendShiftHours,
      notification_preferences: {},
      deleted_at: null
    }, { onConflict: "id" });

    if (profileError) {
      throw new Error(`Unable to upsert profile for ${fixture.email}: ${profileError.message}`);
    }
  }

  console.log(`Ensured ${CUSTOMER_SUCCESS_FIXTURES.length} Customer Success QA profiles.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
