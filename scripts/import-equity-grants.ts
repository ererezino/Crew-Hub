#!/usr/bin/env tsx

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { findBestProfileMatch, parseEsopAgreementText, type EquityImportProfile } from "../lib/equity-import";

const profileRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  full_name: z.string(),
  email: z.string().email().nullable(),
  deleted_at: z.string().nullable()
});

const grantRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  org_id: z.string().uuid(),
  grant_date: z.string(),
  vesting_start_date: z.string(),
  number_of_shares: z.union([z.number(), z.string()]),
  deleted_at: z.string().nullable()
});

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parseArguments(argv: string[]) {
  const positional: string[] = [];
  let apply = false;
  let orgId: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--apply") {
      apply = true;
      continue;
    }

    if (argument === "--org-id") {
      orgId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    positional.push(argument);
  }

  const zipPath = positional[0];

  if (!zipPath) {
    throw new Error("Usage: npx tsx scripts/import-equity-grants.ts [--apply] [--org-id <uuid>] <zip-path>");
  }

  return {
    zipPath: path.resolve(zipPath),
    apply,
    orgId
  };
}

function extractAgreementTexts(zipPath: string) {
  const extractionDirectory = mkdtempSync(path.join(tmpdir(), "equity-import-"));

  try {
    execFileSync("unzip", ["-qq", zipPath, "-d", extractionDirectory], { stdio: "pipe" });

    const agreementsDirectory = path.join(extractionDirectory, "Option_Agreements");
    const agreementFileNames = readdirSync(agreementsDirectory)
      .filter((fileName) => fileName.endsWith(".docx"))
      .sort((left, right) => left.localeCompare(right));

    return agreementFileNames.map((fileName) => {
      const absolutePath = path.join(agreementsDirectory, fileName);
      const text = execFileSync("textutil", ["-convert", "txt", "-stdout", absolutePath], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });

      return {
        fileName,
        text
      };
    });
  } finally {
    rmSync(extractionDirectory, { recursive: true, force: true });
  }
}

function detectOrgId(profiles: EquityImportProfile[]): string {
  const orgIds = Array.from(new Set(profiles.map((profile) => profile.orgId)));

  if (orgIds.length !== 1) {
    throw new Error("Multiple orgs found in the current environment. Re-run with --org-id <uuid>.");
  }

  return orgIds[0]!;
}

async function main() {
  const { zipPath, apply, orgId: requestedOrgId } = parseArguments(process.argv.slice(2));
  const supabase = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: rawProfiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, org_id, full_name, email, deleted_at")
    .is("deleted_at", null)
    .order("full_name", { ascending: true });

  if (profilesError) {
    throw new Error(`Unable to load employee profiles: ${profilesError.message}`);
  }

  const parsedProfiles = z.array(profileRowSchema).parse(rawProfiles ?? []);
  const profiles: EquityImportProfile[] = parsedProfiles.map((profile) => ({
    id: profile.id,
    orgId: profile.org_id,
    fullName: profile.full_name,
    email: profile.email
  }));

  const orgId = requestedOrgId ?? detectOrgId(profiles);
  const orgProfiles = profiles.filter((profile) => profile.orgId === orgId);
  const agreements = extractAgreementTexts(zipPath).map(({ fileName, text }) =>
    parseEsopAgreementText(text, fileName)
  );

  const matches = agreements.map((agreement) => ({
    agreement,
    match: findBestProfileMatch(agreement.optioneeName, orgProfiles)
  }));

  const matched = matches.filter(
    (entry): entry is (typeof matches)[number] & { match: NonNullable<(typeof matches)[number]["match"]> } =>
      entry.match !== null
  );
  const unmatched = matches.filter((entry) => entry.match === null);
  const employeeIds = matched.map((entry) => entry.match.profile.id);

  const { data: rawExistingGrants, error: grantsError } = employeeIds.length
    ? await supabase
        .from("equity_grants")
        .select("id, employee_id, org_id, grant_date, vesting_start_date, number_of_shares, deleted_at")
        .eq("org_id", orgId)
        .in("employee_id", employeeIds)
        .is("deleted_at", null)
    : { data: [], error: null };

  if (grantsError) {
    throw new Error(`Unable to load existing equity grants: ${grantsError.message}`);
  }

  const existingGrants = z.array(grantRowSchema).parse(rawExistingGrants ?? []);
  const existingGrantByKey = new Map(
    existingGrants.map((grant) => [
      `${grant.employee_id}::${grant.grant_date}::${grant.vesting_start_date}`,
      grant
    ])
  );

  console.log(`Loaded ${agreements.length} agreement(s) from ${path.basename(zipPath)}.`);
  console.log(`Using org ${orgId} with ${orgProfiles.length} active profile(s).`);
  console.log(`Matched ${matched.length} agreement(s); ${unmatched.length} need manual review.`);

  for (const entry of matched) {
    console.log(
      `MATCH  ${entry.agreement.optioneeName} -> ${entry.match.profile.fullName} (${entry.match.profile.email ?? "no-email"}) score=${entry.match.score.toFixed(2)}`
    );
  }

  for (const entry of unmatched) {
    console.log(`UNMATCHED  ${entry.agreement.optioneeName} (${entry.agreement.sourceFileName})`);
  }

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to write grants.");
    return;
  }

  let insertedCount = 0;
  let updatedCount = 0;

  for (const entry of matched) {
    const key = `${entry.match.profile.id}::${entry.agreement.grantDate}::${entry.agreement.vestingStartDate}`;
    const existingGrant = existingGrantByKey.get(key);
    const payload = {
      employee_id: entry.match.profile.id,
      org_id: orgId,
      grant_type: entry.agreement.grantType,
      number_of_shares: entry.agreement.numberOfShares,
      exercise_price_cents: entry.agreement.exercisePriceCents,
      grant_date: entry.agreement.grantDate,
      vesting_start_date: entry.agreement.vestingStartDate,
      cliff_months: entry.agreement.cliffMonths,
      vesting_duration_months: entry.agreement.vestingDurationMonths,
      schedule: "monthly" as const,
      status: entry.agreement.status,
      approved_by: null,
      board_approval_date: entry.agreement.boardApprovalDate,
      notes: `Imported from ${entry.agreement.sourceFileName}. ${entry.agreement.vestingScheduleSummary}`
    };

    if (existingGrant) {
      const { error } = await supabase
        .from("equity_grants")
        .update(payload)
        .eq("id", existingGrant.id)
        .eq("org_id", orgId);

      if (error) {
        throw new Error(`Unable to update grant for ${entry.match.profile.fullName}: ${error.message}`);
      }

      updatedCount += 1;
      continue;
    }

    const { error } = await supabase.from("equity_grants").insert(payload);

    if (error) {
      throw new Error(`Unable to insert grant for ${entry.match.profile.fullName}: ${error.message}`);
    }

    insertedCount += 1;
  }

  console.log(`Import complete. Inserted ${insertedCount}, updated ${updatedCount}, unmatched ${unmatched.length}.`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
