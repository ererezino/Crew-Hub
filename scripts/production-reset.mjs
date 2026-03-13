/**
 * Production Data Reset — Accrue Crew Hub
 *
 * Clears all test/seed transactional data, soft-deletes test profiles,
 * cleans up orphan auth users, and cleans storage.
 *
 * Usage:
 *   DRY_RUN=true  node scripts/production-reset.mjs   # preview (default)
 *   DRY_RUN=false node scripts/production-reset.mjs   # execute
 */

import { assertSafety } from "./lib/safety.mjs";

// When running live (not dry-run), require explicit flags
if (process.env.DRY_RUN === "false") {
  assertSafety({ requireEnv: true, requireConfirm: true });
}

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";

/* ─── Config ─── */

const DRY_RUN = process.env.DRY_RUN !== "false";

const EXPECTED_SUPABASE_URL = "https://xmeruhyybvyosqxfleiu.supabase.co";
const EXPECTED_ORG_ID = "0c0e516f-5896-4f3b-a163-42e8460e5faa";
const EXPECTED_PROFILE_COUNT = 67;

const KEEP_UUIDS = new Set([
  "9f45c4f9-5218-4d85-a4eb-eba3a23dc6d3", // Adesuwa Omoruyi
  "6dab7242-63d0-4d48-913d-3da260439725", // Aishat Akintola
  "f337747f-ee57-4da3-9adc-b28f6067c557", // Alan Olisa
  "7cca09d8-084c-4cdf-8c33-a3c1a87786b0", // Alex Omenye
  "8366efa2-b1d1-4dc8-9cf7-53cca203f9cf", // Antoinette Atolagbe
  "fda94ee6-5090-4e97-9967-4f5f482d30f2", // Chiamaka Ewa
  "367a48ea-c8f8-4c26-89ac-c55c70999041", // Clinton Mbah
  "e2b00e91-0f61-4fda-8b5f-134990e17aa9", // Emmanuella Wamba
  "a8b4765f-19f1-481e-9e32-ed4dcc36827d", // Eniibukunoluwa Oyesanya
  "e4b74be1-8c7e-4634-aead-478f254f88be", // Esse Udubrah
  "3a4dbf14-9b9a-46cf-951c-86b248314e68", // Essilfie Quansah
  "a23f0fd0-3961-4385-ae8f-ac0ff42752f9", // Favour Nnadi
  "d1ca2b68-62f7-4fa9-ae89-5e090f344569", // Felix Akinnibi
  "a804f8f1-e156-46e7-8594-fdbaf03a4962", // Flore Keugwa
  "7778efdf-46dd-4327-8e4c-b920b6a276ad", // Gabriel Owusu
  "d2aec714-8436-4aef-9e47-e87b0cb6f611", // Ifeanyi Onuoha
  "cb765e6e-a183-4aa8-9cd7-912bca29335c", // Joy Omoruyi
  "8b1d91da-2e9e-405d-b294-342d41197799", // Kimbi Chantal
  "0ae7728e-f2e5-48ee-abda-0c3bb87912d1", // Melon Lagoye
  "fea7e981-8f0e-4d6f-ab13-4e25784494bd", // Mobolaji Alabi
  "7c6681d6-d31d-4045-ab28-a61b9f59dc99", // Nureni Imam
  "ba635f1e-c609-4d3b-a426-281c98f5f741", // Ogochukwu Ozongwu
  "d8a40779-646f-420d-a4bf-14a8d7b51e76", // Oyinkansola King
  "0dfefbfc-cdc5-456e-a5fe-f0e81223ab5a", // Raphaela Rockson
  "e24d4f16-4492-489c-8b53-a0a5dde93c0c", // Rayo Ailara
  "982411d3-732a-44f4-908d-f0033a7ae3bd", // Richard Adaramola
  "40dea79e-774d-4e85-bd52-a4f2f70d9049", // Seun Adesoye
  "0c614f7a-3cf5-442f-b906-2ade68b50b15", // Shalewa Oseni
  "51b0d966-34ef-431b-a653-b5f9e6ee6ab9", // Sonia Ezeribe
  "4d0eb045-2647-402f-82f2-66ed8a8abca9", // Stephanie Anene
  "6b1f255d-637e-4990-9429-3830ee9a34a6", // Sydney Dapilah
  "80f15cb3-4abd-49f9-ba02-8175c805a846", // Tema Omame
  "ad95e560-5d55-4a05-9660-5cb46d8f243a", // Tunmise Falade
  "9171ca33-b402-49eb-aa99-1c4b1bae89a4", // Victor Sanusi
  "9f2394f3-ee9f-425e-aef3-21c7d0c57a6b", // Wasiu Adesina
  "9a5d19e4-e235-4ebc-a3d7-217f787c5d6a", // Zino Asamaige
]);

const ORPHAN_AUTH_IDS = [
  "1a7c804e-5ec7-48ef-aa4d-0a64d547bd17",
  "dccd4210-a18f-4362-99d5-323d02c69742",
  "57bbdf86-daad-4468-a139-4d28e188f8ce",
];

/* ─── Deletion waves (FK-safe order) ─── */

const WAVES = [
  {
    name: "Wave 1 — Leaf tables",
    tables: [
      "announcement_reads", "announcement_attachments", "expense_comment_attachments",
      "notifications", "leave_requests", "leave_balances", "time_entries", "timesheets",
      "performance_goals", "travel_support_requests", "afk_logs",
      "compensation_band_assignments", "compensation_records", "allowances",
      "equity_grants", "employee_payment_details",
    ],
  },
  {
    name: "Wave 2 — Mid-tier",
    tables: ["expense_comments", "announcements", "shift_swaps"],
  },
  {
    name: "Wave 3 — After Wave 2",
    tables: ["shifts", "expenses", "onboarding_tasks", "document_versions"],
  },
  {
    name: "Wave 4 — Higher parents",
    tables: ["schedules", "onboarding_instances", "signature_events", "signature_signers", "signature_requests"],
  },
  {
    name: "Wave 5 — Top-level",
    tables: [
      "documents", "review_responses", "review_assignments", "review_cycles",
      "review_templates", "survey_responses", "surveys", "course_assignments",
      "courses", "compliance_deadlines", "compliance_items", "compliance_policies",
      "policy_acknowledgments",
    ],
  },
  {
    name: "Wave 6 — Payroll chain",
    tables: ["payment_ledger", "payslips", "payroll_items", "payment_batches", "payroll_runs"],
  },
  {
    name: "Wave 7 — Auth/audit",
    tables: ["audit_log", "failed_login_attempts", "account_lockouts", "rate_limit_entries"],
  },
];

// Tables without org_id (use different delete strategy)
const AUTH_SCOPED_TABLES = new Set([
  "failed_login_attempts", "account_lockouts", "rate_limit_entries",
  "announcement_reads", "afk_logs",
]);

/* ─── Helpers ─── */

function loadEnv() {
  const raw = readFileSync(".env.local", "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const idx = line.indexOf("=");
    if (idx > 0) env[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return env;
}

function log(icon, msg) {
  const prefix = DRY_RUN ? "[DRY RUN] " : "";
  console.log(`${icon} ${prefix}${msg}`);
}

function abort(msg) {
  console.error(`\nABORT: ${msg}`);
  process.exit(1);
}

async function countRows(sb, table) {
  const { count, error } = await sb.from(table).select("*", { count: "exact", head: true });
  if (error) return -1;
  return count ?? 0;
}

async function deleteFromTable(sb, table, orgId, removeIds) {
  if (AUTH_SCOPED_TABLES.has(table)) {
    // These tables don't have org_id — scope by known data
    if (table === "announcement_reads") {
      // Delete via announcement_id (announcements are org-scoped)
      const { data: annIds } = await sb.from("announcements").select("id").eq("org_id", orgId);
      const ids = (annIds ?? []).map(r => r.id);
      if (ids.length > 0) {
        const { error } = await sb.from(table).delete().in("announcement_id", ids);
        return error;
      }
      return null;
    }
    if (table === "afk_logs") {
      const { error } = await sb.from(table).delete().eq("org_id", orgId);
      return error;
    }
    // Auth tables — delete all (these are org-isolated in practice)
    // account_lockouts uses email as PK, not id
    if (table === "account_lockouts") {
      const { error } = await sb.from(table).delete().neq("email", "");
      return error;
    }
    const { error } = await sb.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
    return error;
  }
  const { error } = await sb.from(table).delete().eq("org_id", orgId);
  return error;
}

/* ─── Main ─── */

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log(`║  PRODUCTION RESET — ${DRY_RUN ? "DRY RUN (no mutations)" : "LIVE EXECUTION"}       ║`);
  console.log("╚══════════════════════════════════════════════════╝\n");

  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;

  // ── Phase 0: Pre-Flight ──

  console.log("━━━ Phase 0: Pre-Flight Checks ━━━\n");

  // Guard 1: Environment
  if (url !== EXPECTED_SUPABASE_URL) abort(`Supabase URL mismatch.\n  Got:      ${url}\n  Expected: ${EXPECTED_SUPABASE_URL}`);
  log("✓", `Supabase URL matches expected project`);

  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // Guard 2: Org
  const { data: orgRow, error: orgErr } = await sb.from("orgs").select("id").single();
  if (orgErr || !orgRow) abort(`Cannot read org: ${orgErr?.message}`);
  if (orgRow.id !== EXPECTED_ORG_ID) abort(`Org ID mismatch.\n  Got:      ${orgRow.id}\n  Expected: ${EXPECTED_ORG_ID}`);
  log("✓", `Org ID matches: ${EXPECTED_ORG_ID}`);

  // Guard 3: Profile count
  const { data: allProfiles, error: profErr } = await sb.from("profiles").select("*");
  if (profErr) abort(`Cannot load profiles: ${profErr.message}`);
  if (allProfiles.length !== EXPECTED_PROFILE_COUNT) abort(`Profile count mismatch.\n  Got:      ${allProfiles.length}\n  Expected: ${EXPECTED_PROFILE_COUNT}`);
  log("✓", `Profile count: ${allProfiles.length}`);

  // Build lists
  const keepProfiles = allProfiles.filter(p => KEEP_UUIDS.has(p.id));
  const removeProfiles = allProfiles.filter(p => !KEEP_UUIDS.has(p.id));

  if (keepProfiles.length !== 36) abort(`Keep-list resolved to ${keepProfiles.length}, expected 36`);
  if (removeProfiles.length !== 31) abort(`Remove-list resolved to ${removeProfiles.length}, expected 31`);

  // Check for unknown profiles
  for (const p of keepProfiles) {
    if (!KEEP_UUIDS.has(p.id)) abort(`Profile ${p.id} (${p.full_name}) in keep-list but not in hardcoded manifest`);
  }

  log("✓", `Keep-list: ${keepProfiles.length} profiles`);
  log("✓", `Remove-list: ${removeProfiles.length} profiles`);

  console.log("\n  Keep-list:");
  for (const p of keepProfiles.sort((a, b) => a.full_name.localeCompare(b.full_name))) {
    console.log(`    ${p.id.slice(0, 8)}  ${p.full_name.padEnd(25)} ${p.email}`);
  }
  console.log("\n  Remove-list:");
  for (const p of removeProfiles.sort((a, b) => a.full_name.localeCompare(b.full_name))) {
    console.log(`    ${p.id.slice(0, 8)}  ${p.full_name.padEnd(25)} ${p.email}`);
  }

  // Snapshot row counts
  const allTables = WAVES.flatMap(w => w.tables);
  const configTables = [
    "orgs", "leave_policies", "holiday_calendars", "time_policies", "shift_templates",
    "compensation_bands", "benchmark_data", "deduction_rules", "onboarding_templates",
    "dashboard_widget_config", "navigation_access_config", "role_module_config",
  ];

  console.log("\n  Before-state row counts:");
  const beforeCounts = {};
  for (const t of [...allTables, ...configTables]) {
    beforeCounts[t] = await countRows(sb, t);
    if (beforeCounts[t] > 0) console.log(`    ${t.padEnd(40)} ${beforeCounts[t]}`);
  }

  // Find manager references to fix
  const managerFixes = keepProfiles.filter(p => p.manager_id && !KEEP_UUIDS.has(p.manager_id));

  if (managerFixes.length > 0) {
    console.log("\n  Manager references to null:");
    for (const p of managerFixes) {
      const mgr = allProfiles.find(m => m.id === p.manager_id);
      console.log(`    ${p.full_name} → manager: ${mgr?.full_name ?? p.manager_id}`);
    }
  }

  // ── Save Backup ──

  console.log("\n━━━ Saving Backup ━━━\n");

  const backup = {
    timestamp: new Date().toISOString(),
    mode: DRY_RUN ? "dry_run" : "live",
    profilesRemoved: removeProfiles,
    profilesKeptManagerFixed: managerFixes.map(p => ({ id: p.id, full_name: p.full_name, original_manager_id: p.manager_id })),
    orphanAuthUsers: ORPHAN_AUTH_IDS,
    beforeCounts,
  };

  // Export small auth/audit tables
  for (const t of ["failed_login_attempts", "account_lockouts", "rate_limit_entries", "audit_log"]) {
    if (beforeCounts[t] > 0 && beforeCounts[t] <= 1000) {
      const { data } = await sb.from(t).select("*");
      backup[`export_${t}`] = data ?? [];
    }
  }

  const backupPath = `scripts/backup-before-reset-${Date.now()}.json`;
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  log("✓", `Backup saved: ${backupPath} (${(JSON.stringify(backup).length / 1024).toFixed(0)} KB)`);

  if (DRY_RUN) {
    console.log("\n━━━ DRY RUN — Previewing Changes ━━━\n");
  } else {
    console.log("\n━━━ LIVE EXECUTION ━━━\n");
  }

  // ── Phase 1: Fix References ──

  console.log("━━━ Phase 1: Fix Manager References ━━━\n");

  for (const p of managerFixes) {
    log("→", `Null manager_id for ${p.full_name} (was: ${p.manager_id})`);
    if (!DRY_RUN) {
      const { error } = await sb.from("profiles").update({ manager_id: null }).eq("id", p.id);
      if (error) abort(`Failed to null manager_id for ${p.full_name}: ${error.message}`);
    }
  }
  if (managerFixes.length === 0) log("✓", "No manager references to fix");

  // ── Phase 2: Clear Transactional Data ──

  console.log("\n━━━ Phase 2: Clear Transactional Data ━━━\n");

  const removeIds = removeProfiles.map(p => p.id);
  let totalDeleted = 0;

  for (const wave of WAVES) {
    console.log(`  ${wave.name}:`);
    for (const table of wave.tables) {
      const count = beforeCounts[table] ?? 0;
      if (count === 0) {
        log("·", `  ${table.padEnd(38)} 0 rows (skip)`);
        continue;
      }
      log("→", `  ${table.padEnd(38)} ${count} rows`);
      totalDeleted += count;

      if (!DRY_RUN) {
        const err = await deleteFromTable(sb, table, EXPECTED_ORG_ID, removeIds);
        if (err) {
          console.error(`  FAILED: ${table}: ${err.message}`);
          abort(`Wave failed at ${table}. Stopping execution.`);
        }
        // Verify
        const after = await countRows(sb, table);
        if (after !== 0) {
          console.warn(`  WARNING: ${table} still has ${after} rows after delete`);
        }
      }
    }
    console.log();
  }

  log("✓", `Total transactional rows to clear: ${totalDeleted}`);

  // ── Phase 3: Soft-Delete Test Profiles ──

  console.log("\n━━━ Phase 3: Soft-Delete Test Profiles ━━━\n");

  for (const p of removeProfiles) {
    log("→", `Soft-delete: ${p.full_name.padEnd(25)} (${p.email})`);
  }

  if (!DRY_RUN) {
    const { error } = await sb
      .from("profiles")
      .update({
        deleted_at: new Date().toISOString(),
        status: "inactive",
        directory_visible: false,
        manager_id: null,
      })
      .in("id", removeIds);

    if (error) abort(`Failed to soft-delete profiles: ${error.message}`);
    log("✓", `Soft-deleted ${removeIds.length} profiles`);
  }

  // ── Phase 4: Auth Cleanup ──

  console.log("\n━━━ Phase 4: Auth Cleanup ━━━\n");

  // Delete orphan auth users
  for (const authId of ORPHAN_AUTH_IDS) {
    log("→", `Delete orphan auth user: ${authId}`);
    if (!DRY_RUN) {
      const { error } = await sb.auth.admin.deleteUser(authId);
      if (error) console.warn(`  WARNING: Failed to delete auth user ${authId}: ${error.message}`);
    }
  }

  // Tunde removed from keep-list — treated as test account, soft-deleted with others

  // ── Phase 5: Storage Cleanup ──

  console.log("\n━━━ Phase 5: Storage Cleanup ━━━\n");

  // Avatar cleanup — only 2 folders to delete
  const avatarFoldersToDelete = removeIds;
  let avatarFilesDeleted = 0;

  for (const uuid of avatarFoldersToDelete) {
    const { data: files } = await sb.storage.from("avatars").list(uuid);
    if (files && files.length > 0) {
      const paths = files.map(f => `${uuid}/${f.name}`);
      log("→", `Delete avatar: ${uuid}/ (${files.length} files)`);
      avatarFilesDeleted += files.length;
      if (!DRY_RUN) {
        await sb.storage.from("avatars").remove(paths);
      }
    }
  }
  if (avatarFilesDeleted === 0) log("·", "No test avatar files found");

  // Documents bucket — full clear
  const { data: docFiles } = await sb.storage.from("documents").list("", { limit: 1000 });
  const allDocPaths = [];

  async function listRecursive(bucket, prefix) {
    const { data } = await sb.storage.from(bucket).list(prefix, { limit: 1000 });
    const paths = [];
    for (const item of data ?? []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id) {
        paths.push(path);
      } else {
        paths.push(...(await listRecursive(bucket, path)));
      }
    }
    return paths;
  }

  const docPaths = await listRecursive("documents", "");
  log("→", `Delete ${docPaths.length} files from documents bucket`);
  for (const p of docPaths) console.log(`    ${p}`);
  if (!DRY_RUN && docPaths.length > 0) {
    await sb.storage.from("documents").remove(docPaths);
  }

  const receiptPaths = await listRecursive("receipts", "");
  log("→", `Delete ${receiptPaths.length} files from receipts bucket`);
  for (const p of receiptPaths) console.log(`    ${p}`);
  if (!DRY_RUN && receiptPaths.length > 0) {
    await sb.storage.from("receipts").remove(receiptPaths);
  }

  // ── Phase 6: Verification ──

  console.log("\n━━━ Phase 6: Verification ━━━\n");

  if (DRY_RUN) {
    console.log("  Skipped (dry run — no mutations to verify)\n");
    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║  DRY RUN COMPLETE — No changes made             ║");
    console.log("║  Review output above. Run with DRY_RUN=false    ║");
    console.log("║  to execute.                                    ║");
    console.log("╚══════════════════════════════════════════════════╝");
    return;
  }

  let failures = 0;

  function verify(label, actual, expected) {
    const pass = actual === expected;
    console.log(`  ${pass ? "✓" : "✗"} ${label}: ${actual} (expected ${expected})`);
    if (!pass) failures++;
  }

  // Row counts
  const activeProfiles = await sb
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .is("deleted_at", null);
  verify("Active profiles", activeProfiles.count, 36);

  const crewVisible = await sb
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq("directory_visible", true)
    .in("status", ["active", "onboarding"]);
  verify("Crew-visible profiles", crewVisible.count, 36);

  // Transactional tables should be 0
  for (const wave of WAVES) {
    for (const table of wave.tables) {
      const c = await countRows(sb, table);
      if (c !== 0) {
        console.log(`  ✗ ${table}: ${c} rows remaining (expected 0)`);
        failures++;
      }
    }
  }
  console.log("  ✓ All transactional tables: 0 rows");

  // Config preserved
  for (const t of configTables) {
    const c = await countRows(sb, t);
    verify(`Config: ${t}`, c, beforeCounts[t]);
  }

  // Manager refs check
  const { data: brokenMgrs } = await sb
    .from("profiles")
    .select("id, full_name, manager_id")
    .is("deleted_at", null)
    .not("manager_id", "is", null);

  const softDeletedIds = new Set(removeIds);
  const brokenRefs = (brokenMgrs ?? []).filter(p => softDeletedIds.has(p.manager_id));
  verify("Broken manager refs", brokenRefs.length, 0);

  // Deleted-user login rejection test
  console.log("\n  Auth gate test:");
  const { data: deletedLogin } = await sb
    .from("profiles")
    .select("id")
    .eq("email", "coo@accrue.test")
    .is("deleted_at", null)
    .maybeSingle();
  verify("Deleted user (coo@accrue.test) blocked", deletedLogin, null);

  // No active @accrue.test profiles
  const { data: testEmails } = await sb
    .from("profiles")
    .select("email")
    .is("deleted_at", null)
    .like("email", "%@accrue.test");
  verify("Active @accrue.test profiles", testEmails?.length ?? 0, 0);

  console.log();

  if (failures > 0) {
    console.error(`╔══════════════════════════════════════════════════╗`);
    console.error(`║  VERIFICATION FAILED — ${failures} check(s) failed          ║`);
    console.error(`╚══════════════════════════════════════════════════╝`);
    process.exit(1);
  }

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  PRODUCTION RESET COMPLETE                      ║");
  console.log("║  All checks passed.                             ║");
  console.log("╚══════════════════════════════════════════════════╝");
}

main().catch(err => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
