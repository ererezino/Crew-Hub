import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

type SeedRole =
  | "EMPLOYEE"
  | "MANAGER"
  | "HR_ADMIN"
  | "FINANCE_ADMIN"
  | "SUPER_ADMIN";

type SeedStatus = "active" | "inactive" | "onboarding" | "offboarding";

type SeedMember = {
  key: string;
  fullName: string;
  email: string;
  title: string;
  department:
    | "Engineering"
    | "Operations"
    | "Compliance"
    | "Marketing"
    | "Business Development"
    | "Finance";
  countryCode: "NG" | "GH" | "KE" | "ZA" | "CA";
  timezone: string;
  roles: SeedRole[];
  managerKey: string | null;
  status: SeedStatus;
};

type SeedAnnouncement = {
  title: string;
  body: string;
  isPinned: boolean;
  authorKey: SeedMember["key"];
};

type SeedDocumentCategory =
  | "policy"
  | "contract"
  | "id_document"
  | "tax_form"
  | "compliance"
  | "payroll_statement"
  | "other";

type SeedDocument = {
  title: string;
  description: string;
  category: SeedDocumentCategory;
  ownerKey: SeedMember["key"] | null;
  createdByKey: SeedMember["key"];
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  expiryOffsetDays: number | null;
  countryCode: SeedMember["countryCode"] | null;
  versionCount: number;
};

const SEED_MEMBERS: SeedMember[] = [
  {
    key: "coo",
    fullName: "Amina Okafor",
    email: "coo@accrue.test",
    title: "Chief Operating Officer",
    department: "Business Development",
    countryCode: "NG",
    timezone: "Africa/Lagos",
    roles: ["SUPER_ADMIN"],
    managerKey: null,
    status: "active"
  },
  {
    key: "ceo",
    fullName: "Tunde Adeyemi",
    email: "ceo@accrue.test",
    title: "Chief Executive Officer",
    department: "Marketing",
    countryCode: "NG",
    timezone: "Africa/Lagos",
    roles: ["SUPER_ADMIN"],
    managerKey: "coo",
    status: "active"
  },
  {
    key: "head_people_finance",
    fullName: "Chioma Nwosu",
    email: "people.finance@accrue.test",
    title: "Head of People & Finance",
    department: "Finance",
    countryCode: "NG",
    timezone: "Africa/Lagos",
    roles: ["HR_ADMIN", "FINANCE_ADMIN"],
    managerKey: "coo",
    status: "active"
  },
  {
    key: "eng_manager",
    fullName: "Samuel Okeke",
    email: "eng.manager@accrue.test",
    title: "Engineering Manager",
    department: "Engineering",
    countryCode: "NG",
    timezone: "Africa/Lagos",
    roles: ["MANAGER"],
    managerKey: "coo",
    status: "active"
  },
  {
    key: "ops_manager",
    fullName: "Wanjiku Mwangi",
    email: "ops.manager@accrue.test",
    title: "Operations Manager",
    department: "Operations",
    countryCode: "KE",
    timezone: "Africa/Nairobi",
    roles: ["MANAGER"],
    managerKey: "coo",
    status: "active"
  },
  {
    key: "engineer_1",
    fullName: "Ifeanyi Eze",
    email: "engineer1@accrue.test",
    title: "Software Engineer",
    department: "Engineering",
    countryCode: "NG",
    timezone: "Africa/Lagos",
    roles: ["EMPLOYEE"],
    managerKey: "eng_manager",
    status: "active"
  },
  {
    key: "ops_associate",
    fullName: "Abena Owusu",
    email: "ops.associate@accrue.test",
    title: "Operations Associate",
    department: "Operations",
    countryCode: "GH",
    timezone: "Africa/Accra",
    roles: ["EMPLOYEE"],
    managerKey: "ops_manager",
    status: "onboarding"
  },
  {
    key: "engineer_2",
    fullName: "Brian Otieno",
    email: "engineer2@accrue.test",
    title: "Software Engineer",
    department: "Engineering",
    countryCode: "KE",
    timezone: "Africa/Nairobi",
    roles: ["EMPLOYEE"],
    managerKey: "eng_manager",
    status: "active"
  },
  {
    key: "compliance_officer",
    fullName: "Lerato Dlamini",
    email: "compliance@accrue.test",
    title: "Compliance Officer",
    department: "Compliance",
    countryCode: "ZA",
    timezone: "Africa/Johannesburg",
    roles: ["EMPLOYEE"],
    managerKey: "ops_manager",
    status: "active"
  },
  {
    key: "engineer_3",
    fullName: "Noah Patel",
    email: "engineer3@accrue.test",
    title: "Software Engineer",
    department: "Engineering",
    countryCode: "CA",
    timezone: "America/Toronto",
    roles: ["EMPLOYEE"],
    managerKey: "eng_manager",
    status: "onboarding"
  }
];

const SEED_ANNOUNCEMENTS: SeedAnnouncement[] = [
  {
    title: "Crew Hub rollout update",
    body: "Crew Hub is now the default hub for internal employee operations. Use it for announcements, settings, and upcoming workflow modules.",
    isPinned: true,
    authorKey: "coo"
  },
  {
    title: "Monthly all-hands schedule",
    body: "The monthly all-hands now runs on the first Wednesday of each month at 3:00 PM WAT. Calendar invites have been updated.",
    isPinned: false,
    authorKey: "ceo"
  },
  {
    title: "People ops office hours",
    body: "People and Finance office hours are open every Friday from 11:00 AM to 1:00 PM WAT for onboarding and policy questions.",
    isPinned: false,
    authorKey: "head_people_finance"
  }
];

const SEED_DOCUMENTS: SeedDocument[] = [
  {
    title: "Remote Work Policy",
    description: "Shared policy for distributed work expectations and communication cadence.",
    category: "policy",
    ownerKey: null,
    createdByKey: "head_people_finance",
    fileName: "remote-work-policy.pdf",
    mimeType: "application/pdf",
    sizeBytes: 184_220,
    expiryOffsetDays: 18,
    countryCode: "NG",
    versionCount: 2
  },
  {
    title: "Code of Conduct",
    description: "Company-wide standards on behavior, reporting channels, and accountability.",
    category: "policy",
    ownerKey: null,
    createdByKey: "coo",
    fileName: "code-of-conduct.pdf",
    mimeType: "application/pdf",
    sizeBytes: 142_900,
    expiryOffsetDays: null,
    countryCode: null,
    versionCount: 1
  },
  {
    title: "Ifeanyi Eze Passport",
    description: "Primary ID document for payroll and compliance processing.",
    category: "id_document",
    ownerKey: "engineer_1",
    createdByKey: "engineer_1",
    fileName: "ifeanyi-passport.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 492_040,
    expiryOffsetDays: 240,
    countryCode: "NG",
    versionCount: 1
  },
  {
    title: "Ifeanyi Eze Tax Form",
    description: "Annual contractor tax form for USD payments.",
    category: "tax_form",
    ownerKey: "engineer_1",
    createdByKey: "engineer_1",
    fileName: "ifeanyi-tax-form.pdf",
    mimeType: "application/pdf",
    sizeBytes: 231_004,
    expiryOffsetDays: 12,
    countryCode: "NG",
    versionCount: 2
  },
  {
    title: "Abena Owusu Tax Form",
    description: "Current contractor tax declaration for reimbursements and payroll records.",
    category: "tax_form",
    ownerKey: "ops_associate",
    createdByKey: "ops_associate",
    fileName: "abena-tax-form.pdf",
    mimeType: "application/pdf",
    sizeBytes: 188_210,
    expiryOffsetDays: 64,
    countryCode: "GH",
    versionCount: 1
  }
];

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function createServiceRoleClient(): SupabaseClient {
  const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

async function ensureOrg(client: SupabaseClient): Promise<{ id: string; name: string }> {
  const { data: existingOrg, error: existingOrgError } = await client
    .from("orgs")
    .select("id, name")
    .eq("name", "Accrue")
    .maybeSingle();

  if (existingOrgError) {
    throw new Error(`Unable to query orgs table: ${existingOrgError.message}`);
  }

  if (existingOrg) {
    return existingOrg;
  }

  const { data: createdOrg, error: createOrgError } = await client
    .from("orgs")
    .insert({ name: "Accrue" })
    .select("id, name")
    .single();

  if (createOrgError || !createdOrg) {
    throw new Error(`Unable to create org: ${createOrgError?.message ?? "unknown error"}`);
  }

  return createdOrg;
}

async function listUsersByEmail(client: SupabaseClient): Promise<Map<string, User>> {
  const usersByEmail = new Map<string, User>();
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });

    if (error) {
      throw new Error(`Unable to list auth users: ${error.message}`);
    }

    for (const user of data.users) {
      if (user.email) {
        usersByEmail.set(user.email.toLowerCase(), user);
      }
    }

    if (data.users.length < perPage) {
      break;
    }

    page += 1;
  }

  return usersByEmail;
}

async function ensureAuthUser(
  client: SupabaseClient,
  existingUsersByEmail: Map<string, User>,
  member: SeedMember,
  sharedPassword: string
): Promise<string> {
  const emailKey = member.email.toLowerCase();
  const existingUser = existingUsersByEmail.get(emailKey);

  if (existingUser) {
    return existingUser.id;
  }

  const { data, error } = await client.auth.admin.createUser({
    email: member.email,
    password: sharedPassword,
    email_confirm: true,
    user_metadata: {
      full_name: member.fullName
    }
  });

  if (error || !data.user) {
    throw new Error(`Unable to create auth user for ${member.email}: ${error?.message ?? "unknown error"}`);
  }

  existingUsersByEmail.set(emailKey, data.user);
  return data.user.id;
}

type ProfileRow = {
  id: string;
  org_id: string;
  email: string;
  full_name: string;
  roles: SeedRole[];
  department: SeedMember["department"];
  title: string;
  country_code: SeedMember["countryCode"];
  timezone: string;
  employment_type: "contractor";
  payroll_mode: "contractor_usd_no_withholding";
  primary_currency: "USD";
  manager_id: string | null;
  status: SeedStatus;
  notification_preferences: Record<string, never>;
};

async function upsertProfiles(client: SupabaseClient, rows: ProfileRow[]): Promise<void> {
  const { error } = await client.from("profiles").upsert(rows, { onConflict: "id" });

  if (error) {
    throw new Error(`Unable to upsert profiles: ${error.message}`);
  }
}

async function upsertSeedAnnouncements(
  client: SupabaseClient,
  orgId: string,
  userIdByKey: ReadonlyMap<string, string>
): Promise<void> {
  if (SEED_ANNOUNCEMENTS.length === 0) {
    return;
  }

  const announcementTitles = SEED_ANNOUNCEMENTS.map((announcement) => announcement.title);

  const { data: existingRows, error: existingRowsError } = await client
    .from("announcements")
    .select("id, title")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .in("title", announcementTitles);

  if (existingRowsError) {
    throw new Error(`Unable to query existing announcements: ${existingRowsError.message}`);
  }

  const existingIdByTitle = new Map(
    (existingRows ?? []).map((row) => [row.title, row.id] as const)
  );
  const announcementReadRows: Array<{
    announcement_id: string;
    user_id: string;
    read_at: string;
  }> = [];

  for (const announcement of SEED_ANNOUNCEMENTS) {
    const authorId = userIdByKey.get(announcement.authorKey);

    if (!authorId) {
      throw new Error(`Missing author user id for announcement ${announcement.title}`);
    }

    const existingAnnouncementId = existingIdByTitle.get(announcement.title);

    if (existingAnnouncementId) {
      const { data: updatedRow, error: updateError } = await client
        .from("announcements")
        .update({
          title: announcement.title,
          body: announcement.body,
          is_pinned: announcement.isPinned,
          created_by: authorId,
          deleted_at: null
        })
        .eq("id", existingAnnouncementId)
        .eq("org_id", orgId)
        .select("id")
        .single();

      if (updateError || !updatedRow) {
        throw new Error(`Unable to update announcement ${announcement.title}: ${updateError?.message ?? "unknown error"}`);
      }

      announcementReadRows.push({
        announcement_id: updatedRow.id,
        user_id: authorId,
        read_at: new Date().toISOString()
      });

      continue;
    }

    const { data: insertedRow, error: insertError } = await client
      .from("announcements")
      .insert({
        org_id: orgId,
        title: announcement.title,
        body: announcement.body,
        is_pinned: announcement.isPinned,
        created_by: authorId
      })
      .select("id")
      .single();

    if (insertError || !insertedRow) {
      throw new Error(`Unable to insert announcement ${announcement.title}: ${insertError?.message ?? "unknown error"}`);
    }

    announcementReadRows.push({
      announcement_id: insertedRow.id,
      user_id: authorId,
      read_at: new Date().toISOString()
    });
  }

  if (announcementReadRows.length > 0) {
    const { error: readUpsertError } = await client
      .from("announcement_reads")
      .upsert(announcementReadRows, { onConflict: "announcement_id,user_id" });

    if (readUpsertError) {
      throw new Error(`Unable to upsert announcement reads: ${readUpsertError.message}`);
    }
  }
}

function dateWithOffset(offsetDays: number): string {
  const baseDate = new Date();
  baseDate.setUTCDate(baseDate.getUTCDate() + offsetDays);
  return baseDate.toISOString().slice(0, 10);
}

function slugifyForPath(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function upsertSeedDocuments(
  client: SupabaseClient,
  orgId: string,
  userIdByKey: ReadonlyMap<string, string>
): Promise<void> {
  if (SEED_DOCUMENTS.length === 0) {
    return;
  }

  const documentTitles = SEED_DOCUMENTS.map((document) => document.title);

  const { data: existingRows, error: existingRowsError } = await client
    .from("documents")
    .select("id, title")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .in("title", documentTitles);

  if (existingRowsError) {
    throw new Error(`Unable to query existing documents: ${existingRowsError.message}`);
  }

  const existingIdByTitle = new Map(
    (existingRows ?? []).map((row) => [row.title, row.id] as const)
  );

  const versionRows: Array<{
    org_id: string;
    document_id: string;
    version: number;
    file_path: string;
    uploaded_by: string;
  }> = [];

  for (const document of SEED_DOCUMENTS) {
    const ownerUserId = document.ownerKey ? userIdByKey.get(document.ownerKey) ?? null : null;
    const createdByUserId = userIdByKey.get(document.createdByKey);

    if (!createdByUserId) {
      throw new Error(`Missing creator user id for document ${document.title}`);
    }

    if (document.ownerKey && !ownerUserId) {
      throw new Error(`Missing owner user id for document ${document.title}`);
    }

    const baseSlug = slugifyForPath(document.title);
    const latestVersion = Math.max(1, document.versionCount);
    const latestPath = `${orgId}/seed/${baseSlug}/v${latestVersion}-${document.fileName}`;
    const expiryDate =
      document.expiryOffsetDays === null ? null : dateWithOffset(document.expiryOffsetDays);
    const existingDocumentId = existingIdByTitle.get(document.title);

    let documentId: string;

    if (existingDocumentId) {
      const { data: updatedRow, error: updateError } = await client
        .from("documents")
        .update({
          owner_user_id: ownerUserId,
          category: document.category,
          title: document.title,
          description: document.description,
          file_path: latestPath,
          file_name: document.fileName,
          mime_type: document.mimeType,
          size_bytes: document.sizeBytes,
          expiry_date: expiryDate,
          country_code: document.countryCode,
          created_by: createdByUserId,
          deleted_at: null
        })
        .eq("id", existingDocumentId)
        .eq("org_id", orgId)
        .select("id")
        .single();

      if (updateError || !updatedRow) {
        throw new Error(`Unable to update document ${document.title}: ${updateError?.message ?? "unknown error"}`);
      }

      documentId = updatedRow.id;
    } else {
      const { data: insertedRow, error: insertError } = await client
        .from("documents")
        .insert({
          org_id: orgId,
          owner_user_id: ownerUserId,
          category: document.category,
          title: document.title,
          description: document.description,
          file_path: latestPath,
          file_name: document.fileName,
          mime_type: document.mimeType,
          size_bytes: document.sizeBytes,
          expiry_date: expiryDate,
          country_code: document.countryCode,
          created_by: createdByUserId
        })
        .select("id")
        .single();

      if (insertError || !insertedRow) {
        throw new Error(`Unable to insert document ${document.title}: ${insertError?.message ?? "unknown error"}`);
      }

      documentId = insertedRow.id;
    }

    for (let version = 1; version <= latestVersion; version += 1) {
      const versionPath = `${orgId}/seed/${baseSlug}/v${version}-${document.fileName}`;

      versionRows.push({
        org_id: orgId,
        document_id: documentId,
        version,
        file_path: versionPath,
        uploaded_by: createdByUserId
      });
    }
  }

  if (versionRows.length > 0) {
    const { error: versionUpsertError } = await client
      .from("document_versions")
      .upsert(versionRows, { onConflict: "document_id,version" });

    if (versionUpsertError) {
      throw new Error(`Unable to upsert document versions: ${versionUpsertError.message}`);
    }
  }
}

async function main() {
  const client = createServiceRoleClient();
  const sharedPassword = process.env.SEED_TEST_PASSWORD ?? "CrewHub123!";

  const org = await ensureOrg(client);
  const existingUsersByEmail = await listUsersByEmail(client);

  const userIdByKey = new Map<string, string>();

  for (const member of SEED_MEMBERS) {
    const userId = await ensureAuthUser(client, existingUsersByEmail, member, sharedPassword);
    userIdByKey.set(member.key, userId);
  }

  const managementRows: ProfileRow[] = [];
  const employeeRows: ProfileRow[] = [];

  for (const member of SEED_MEMBERS) {
    const userId = userIdByKey.get(member.key);

    if (!userId) {
      throw new Error(`Missing auth user id for ${member.key}`);
    }

    const managerId = member.managerKey ? userIdByKey.get(member.managerKey) ?? null : null;

    if (member.managerKey && !managerId) {
      throw new Error(`Missing manager id for ${member.key}`);
    }

    const row: ProfileRow = {
      id: userId,
      org_id: org.id,
      email: member.email,
      full_name: member.fullName,
      roles: member.roles,
      department: member.department,
      title: member.title,
      country_code: member.countryCode,
      timezone: member.timezone,
      employment_type: "contractor",
      payroll_mode: "contractor_usd_no_withholding",
      primary_currency: "USD",
      manager_id: managerId,
      status: member.status,
      notification_preferences: {}
    };

    if (member.roles.includes("EMPLOYEE") && member.roles.length === 1) {
      employeeRows.push(row);
    } else {
      managementRows.push(row);
    }
  }

  await upsertProfiles(client, managementRows);
  await upsertProfiles(client, employeeRows);
  await upsertSeedAnnouncements(client, org.id, userIdByKey);
  await upsertSeedDocuments(client, org.id, userIdByKey);

  console.log("Seed completed successfully.");
  console.log(`Organization: ${org.name} (${org.id})`);
  console.log(`Profiles upserted: ${SEED_MEMBERS.length}`);
  console.log(`Announcements upserted: ${SEED_ANNOUNCEMENTS.length}`);
  console.log(`Documents upserted: ${SEED_DOCUMENTS.length}`);
  console.log(`Shared test password: ${sharedPassword}`);
}

main().catch((error) => {
  console.error("Seed failed.", error);
  process.exitCode = 1;
});
