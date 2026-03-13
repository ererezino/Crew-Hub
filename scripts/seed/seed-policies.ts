/**
 * Seed placeholder policy documents into the documents table.
 *
 * Inserts 10 company-wide policy documents with category 'policy' so the
 * Documents / Policies section has meaningful data to display.
 *
 * Because the documents table requires an owner_user_id (nullable) and a
 * created_by (not null) foreign key into profiles, the script resolves the
 * first HR_ADMIN it can find in the target organisation and uses that profile
 * as the creator.  If no HR_ADMIN exists it falls back to any SUPER_ADMIN.
 *
 * The applies_to_countries, owner_role, requires_acknowledgment, status and
 * version metadata requested in the brief are stored inside the document
 * description as a structured JSON block, since the documents table schema
 * does not carry those columns natively.  The title and description fields
 * surface the information in the UI list view.
 *
 * Usage:  npx tsx scripts/seed/seed-policies.ts
 */

/* ── Production safety guard ── */
const _ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost").hostname.split(".")[0];
if (_ref === "xmeruhyybvyosqxfleiu") { console.error("ABORT: Seed scripts cannot run against production."); process.exit(1); }

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/* ── Helpers ── */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function createServiceRoleClient(): SupabaseClient {
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/* ── Policy definitions ── */

interface PolicyDefinition {
  title: string;
  description: string;
}

const APPLIES_TO_COUNTRIES = ["NG", "GH", "KE", "ZA", "CA"];
const OWNER_ROLE = "HR_ADMIN";
const REQUIRES_ACKNOWLEDGMENT = false;
const POLICY_STATUS = "draft";
const POLICY_VERSION = "0.1-placeholder";

function buildDescription(summary: string): string {
  const meta = {
    status: POLICY_STATUS,
    version: POLICY_VERSION,
    applies_to_countries: APPLIES_TO_COUNTRIES,
    owner_role: OWNER_ROLE,
    requires_acknowledgment: REQUIRES_ACKNOWLEDGMENT,
  };
  return `${summary}\n\n---\nPolicy metadata: ${JSON.stringify(meta)}`;
}

const SEED_POLICIES: PolicyDefinition[] = [
  {
    title: "Employee Expense Policy",
    description: buildDescription(
      "Guidelines for submitting, approving, and reimbursing business-related expenses incurred by employees."
    ),
  },
  {
    title: "Remote Work and Flexible Hours Policy",
    description: buildDescription(
      "Framework governing remote work eligibility, flexible scheduling, and expectations for distributed teams."
    ),
  },
  {
    title: "Time Off and Leave Policy",
    description: buildDescription(
      "Rules for requesting and tracking annual leave, sick leave, parental leave, and other time-off categories."
    ),
  },
  {
    title: "Code of Conduct",
    description: buildDescription(
      "Standards of professional behaviour, ethical obligations, and company values that apply to all team members."
    ),
  },
  {
    title: "Data Privacy and Confidentiality Policy",
    description: buildDescription(
      "Requirements for handling personal data, confidential information, and compliance with applicable privacy regulations."
    ),
  },
  {
    title: "Performance Management Policy",
    description: buildDescription(
      "Process for setting objectives, conducting performance reviews, and managing improvement plans."
    ),
  },
  {
    title: "IT and Security Policy",
    description: buildDescription(
      "Security practices for company devices, accounts, network access, and incident reporting."
    ),
  },
  {
    title: "Anti-Harassment and Non-Discrimination Policy",
    description: buildDescription(
      "Commitment to a safe, inclusive workplace free from harassment, bullying, and discrimination of any kind."
    ),
  },
  {
    title: "Probation Policy",
    description: buildDescription(
      "Terms governing the probationary period for new hires, including review milestones and confirmation criteria."
    ),
  },
  {
    title: "Offboarding Policy",
    description: buildDescription(
      "Checklist and procedures for employee departures including knowledge transfer, asset return, and final settlements."
    ),
  },
];

/* ── Resolve creator profile ── */

async function resolveCreatorId(
  client: SupabaseClient,
  orgId: string
): Promise<string> {
  // Prefer HR_ADMIN, fall back to SUPER_ADMIN
  for (const role of ["HR_ADMIN", "SUPER_ADMIN"]) {
    const { data, error } = await client
      .from("profiles")
      .select("id, roles")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .limit(100);

    if (error) {
      throw new Error(`Failed to query profiles: ${error.message}`);
    }

    const match = (data ?? []).find((p: { id: string; roles: string[] }) =>
      Array.isArray(p.roles) && p.roles.includes(role)
    );

    if (match) {
      return match.id;
    }
  }

  throw new Error(
    `No HR_ADMIN or SUPER_ADMIN profile found in org ${orgId}. ` +
      "Run seed-foundation first to create profiles."
  );
}

/* ── Resolve org ── */

async function resolveOrgId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client
    .from("orgs")
    .select("id")
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error(`No organisation found. Run seed-foundation first. ${error?.message ?? ""}`);
  }

  return data.id;
}

/* ── Upsert policies ── */

async function upsertPolicies(
  client: SupabaseClient,
  orgId: string,
  createdBy: string
): Promise<void> {
  const titles = SEED_POLICIES.map((p) => p.title);

  // Check which policies already exist
  const { data: existingRows, error: existingError } = await client
    .from("documents")
    .select("id, title")
    .eq("org_id", orgId)
    .eq("category", "policy")
    .is("deleted_at", null)
    .in("title", titles);

  if (existingError) {
    throw new Error(`Failed to query existing policies: ${existingError.message}`);
  }

  const existingByTitle = new Map(
    (existingRows ?? []).map((row: { id: string; title: string }) => [row.title, row.id] as const)
  );

  let insertedCount = 0;
  let updatedCount = 0;

  for (const policy of SEED_POLICIES) {
    const existingId = existingByTitle.get(policy.title);
    const filePath = `${orgId}/policies/${policy.title.toLowerCase().replace(/\s+/g, "-")}.pdf`;

    if (existingId) {
      // Update existing
      const { error: updateError } = await client
        .from("documents")
        .update({
          description: policy.description,
          file_path: filePath,
          file_name: `${policy.title}.pdf`,
          mime_type: "application/pdf",
          size_bytes: 0,
          country_code: null,
          created_by: createdBy,
          deleted_at: null,
        })
        .eq("id", existingId)
        .eq("org_id", orgId);

      if (updateError) {
        throw new Error(`Failed to update policy "${policy.title}": ${updateError.message}`);
      }

      updatedCount += 1;
    } else {
      // Insert new
      const { error: insertError } = await client
        .from("documents")
        .insert({
          org_id: orgId,
          owner_user_id: createdBy,
          category: "policy",
          title: policy.title,
          description: policy.description,
          file_path: filePath,
          file_name: `${policy.title}.pdf`,
          mime_type: "application/pdf",
          size_bytes: 0,
          expiry_date: null,
          country_code: null,
          created_by: createdBy,
        });

      if (insertError) {
        throw new Error(`Failed to insert policy "${policy.title}": ${insertError.message}`);
      }

      insertedCount += 1;
    }
  }

  console.log(
    `Policies seeded: ${insertedCount} inserted, ${updatedCount} updated (${SEED_POLICIES.length} total).`
  );
}

/* ── Main ── */

async function main(): Promise<void> {
  console.log("Seeding placeholder policy documents...\n");

  const client = createServiceRoleClient();
  const orgId = await resolveOrgId(client);
  const createdBy = await resolveCreatorId(client, orgId);

  console.log(`Organisation: ${orgId}`);
  console.log(`Creator (HR_ADMIN / SUPER_ADMIN): ${createdBy}\n`);

  await upsertPolicies(client, orgId, createdBy);

  console.log("\nPolicy seed completed.");
}

main().catch((error) => {
  console.error("Policy seed failed.", error);
  process.exitCode = 1;
});
