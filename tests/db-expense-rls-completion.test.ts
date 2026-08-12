/**
 * DATABASE-BACKED tests (PGlite) for the expense-stack RLS completion
 * migration (20260812060000), which closes the three gaps 20260811090000 left
 * in the same incident class:
 *
 *  1. FINANCE_APPROVER could not read org profiles → "Unknown user" in every
 *     expense list and a 500 in the comments route (owner-profile read).
 *  2. TEAM_LEAD operational leads (team_lead_id link, or manager_id fallback)
 *     could approve queue rows served via service role but got 404s on every
 *     user-scoped read (receipt, attachments, comment thread).
 *  3. receipts bucket UPDATE/DELETE were org-wide — any org member could
 *     overwrite/delete any receipt/payment-proof object. Now own-prefix only.
 *
 * Faithfulness: profiles RLS is enabled with the real production policy set
 * (self / manager / team-lead department / admin scope), so the TEAM_LEAD
 * expense clause is proven independent of profiles visibility — the linked
 * report deliberately sits in a DIFFERENT department than the team lead.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asRole, createTestDb, type TestDb } from "./helpers/pglite-harness";

const MIGRATIONS = [
  "20260811090000_finance_approver_expense_visibility.sql",
  "20260812060000_expense_stack_rls_completion.sql"
];

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";

const TEAM_LEAD = "10000000-0000-4000-8000-000000000001"; // TEAM_LEAD role, dept CS
const REPORT_LINKED = "10000000-0000-4000-8000-000000000002"; // team_lead_id → TEAM_LEAD, dept Engineering
const REPORT_FALLBACK = "10000000-0000-4000-8000-000000000003"; // team_lead_id null, manager_id → TEAM_LEAD
const UNRELATED = "10000000-0000-4000-8000-000000000004"; // no link to TEAM_LEAD
const APPROVER = "10000000-0000-4000-8000-000000000005"; // FINANCE_APPROVER
const ADMIN = "10000000-0000-4000-8000-000000000006"; // FINANCE_ADMIN baseline
const OUTSIDER_B = "10000000-0000-4000-8000-00000000000b"; // ORG_B profile

const EXPENSE_LINKED = "20000000-0000-4000-8000-000000000001";
const EXPENSE_FALLBACK = "20000000-0000-4000-8000-000000000002";
const EXPENSE_UNRELATED = "20000000-0000-4000-8000-000000000003";
const COMMENT_LINKED = "30000000-0000-4000-8000-000000000001";

const RECEIPT_LINKED = `${ORG_A}/${REPORT_LINKED}/${EXPENSE_LINKED}/receipt.pdf`;
const RECEIPT_UNRELATED = `${ORG_A}/${UNRELATED}/${EXPENSE_UNRELATED}/receipt.pdf`;

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb(MIGRATIONS);

  await db.exec(`
    alter table public.profiles enable row level security;
    alter table public.expenses enable row level security;
    alter table public.expense_comments enable row level security;
    alter table public.expense_comment_attachments enable row level security;
    alter table public.expense_attachments enable row level security;
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated, anon;
    grant select, insert, update, delete on storage.objects to authenticated, anon;

    -- Real production profiles policy set (20260227100000 + 20260306610000);
    -- the admin-scope policy itself comes from the migration under test.
    create or replace function public.get_user_department()
    returns text language sql stable security definer set search_path = public as $$
      select (
        select p.department from public.profiles p
        where p.id = auth.uid() and p.deleted_at is null limit 1
      );
    $$;

    drop policy if exists profiles_select_employee_self on public.profiles;
    create policy profiles_select_employee_self
    on public.profiles for select to authenticated
    using (id = auth.uid() and deleted_at is null);

    drop policy if exists profiles_select_manager_scope on public.profiles;
    create policy profiles_select_manager_scope
    on public.profiles for select to authenticated
    using (
      public.has_role('MANAGER')
      and org_id = public.get_user_org_id()
      and deleted_at is null
      and (id = auth.uid() or manager_id = auth.uid())
    );

    drop policy if exists profiles_select_team_lead_scope on public.profiles;
    create policy profiles_select_team_lead_scope
    on public.profiles for select to authenticated
    using (
      public.has_role('TEAM_LEAD')
      and org_id = public.get_user_org_id()
      and deleted_at is null
      and (
        id = auth.uid()
        or (
          department is not null
          and public.get_user_department() is not null
          and lower(trim(department)) = lower(trim(public.get_user_department()))
        )
      )
    );
  `);

  const profile = (
    id: string,
    org: string,
    department: string | null,
    teamLeadId: string | null,
    managerId: string | null
  ) =>
    db.query(
      `insert into public.profiles (id, org_id, department, status, team_lead_id, manager_id)
       values ($1, $2, $3, 'active', $4, $5)`,
      [id, org, department, teamLeadId, managerId]
    );

  await profile(TEAM_LEAD, ORG_A, "Customer Success", null, null);
  // Cross-department on purpose: proves expense reads do not depend on the
  // same-department profiles team-lead policy.
  await profile(REPORT_LINKED, ORG_A, "Engineering", TEAM_LEAD, null);
  await profile(REPORT_FALLBACK, ORG_A, "Customer Success", null, TEAM_LEAD);
  await profile(UNRELATED, ORG_A, "Sales", null, null);
  await profile(APPROVER, ORG_A, "Finance", null, null);
  await profile(ADMIN, ORG_A, "Finance", null, null);
  await profile(OUTSIDER_B, ORG_B, "Engineering", null, null);

  const expense = (id: string, employee: string, receiptPath: string | null) =>
    db.query(
      `insert into public.expenses (id, org_id, employee_id, status, receipt_file_path)
       values ($1, $2, $3, 'pending', $4)`,
      [id, ORG_A, employee, receiptPath]
    );

  await expense(EXPENSE_LINKED, REPORT_LINKED, RECEIPT_LINKED);
  await expense(EXPENSE_FALLBACK, REPORT_FALLBACK, null);
  await expense(EXPENSE_UNRELATED, UNRELATED, RECEIPT_UNRELATED);

  await db.query(
    `insert into public.expense_attachments (org_id, expense_id, file_name, file_path)
     values ($1, $2, 'receipt.pdf', $3)`,
    [ORG_A, EXPENSE_LINKED, RECEIPT_LINKED]
  );
  await db.query(
    `insert into public.expense_comments (id, org_id, expense_id, author_id, message)
     values ($1, $2, $3, $4, 'Need itemized receipt, please.')`,
    [COMMENT_LINKED, ORG_A, EXPENSE_LINKED, REPORT_LINKED]
  );
  await db.query(
    `insert into public.expense_comment_attachments (org_id, comment_id, file_path)
     values ($1, $2, $3)`,
    [ORG_A, COMMENT_LINKED, `${ORG_A}/expense-comment-attachments/${EXPENSE_LINKED}/${COMMENT_LINKED}/quote.pdf`]
  );
  await db.query(`insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [RECEIPT_LINKED]);
  await db.query(`insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [RECEIPT_UNRELATED]);
});

afterAll(async () => {
  await db.close();
});

async function visibleIds(table: string): Promise<Set<string>> {
  const rows = await db.query<{ id: string }>(`select id from ${table}`);
  return new Set(rows.rows.map((r) => r.id));
}

describe("FINANCE_APPROVER profiles parity (fixes 'Unknown user' + comments 500)", () => {
  it("a finance approver reads org profiles exactly like a finance admin", async () => {
    for (const [uid, roles] of [
      [APPROVER, "FINANCE_APPROVER"],
      [ADMIN, "FINANCE_ADMIN"]
    ] as const) {
      await asRole(db, { role: "authenticated", uid, org: ORG_A, roles });
      const profiles = await visibleIds("public.profiles");
      expect(profiles.has(REPORT_LINKED)).toBe(true); // any org member's profile
      expect(profiles.has(UNRELATED)).toBe(true);
      expect(profiles.has(OUTSIDER_B)).toBe(false); // cross-org still hidden
    }
  });

  it("a plain employee still reads only their own profile", async () => {
    await asRole(db, { role: "authenticated", uid: UNRELATED, org: ORG_A, roles: "" });
    const profiles = await visibleIds("public.profiles");
    expect(profiles).toEqual(new Set([UNRELATED]));
  });
});

describe("TEAM_LEAD operational-lead expense reads", () => {
  it("sees linked reports' expenses via team_lead_id even across departments, and manager_id fallback rows", async () => {
    await asRole(db, { role: "authenticated", uid: TEAM_LEAD, org: ORG_A, roles: "TEAM_LEAD" });
    const expenses = await visibleIds("public.expenses");
    expect(expenses.has(EXPENSE_LINKED)).toBe(true); // team_lead_id link (cross-dept)
    expect(expenses.has(EXPENSE_FALLBACK)).toBe(true); // team_lead_id null → manager_id fallback
    expect(expenses.has(EXPENSE_UNRELATED)).toBe(false); // no link — hidden
  });

  it("sees the linked expense's attachments, comment thread, and receipt object", async () => {
    await asRole(db, { role: "authenticated", uid: TEAM_LEAD, org: ORG_A, roles: "TEAM_LEAD" });

    const attachments = await db.query(`select id from public.expense_attachments`);
    expect(attachments.rows).toHaveLength(1);

    const comments = await db.query(`select id from public.expense_comments`);
    expect(comments.rows).toHaveLength(1);

    const commentFiles = await db.query(`select id from public.expense_comment_attachments`);
    expect(commentFiles.rows).toHaveLength(1);

    const objects = await db.query<{ name: string }>(`select name from storage.objects`);
    expect(objects.rows.map((r) => r.name)).toEqual([RECEIPT_LINKED]); // unrelated receipt filtered
  });

  it("can post to the linked expense's thread (request-info parity)", async () => {
    await asRole(db, { role: "authenticated", uid: TEAM_LEAD, org: ORG_A, roles: "TEAM_LEAD" });
    await db.query(
      `insert into public.expense_comments (org_id, expense_id, author_id, message)
       values ($1, $2, $3, 'Please add the vendor invoice.')`,
      [ORG_A, EXPENSE_LINKED, TEAM_LEAD]
    );
  });

  it("cannot post to an unrelated expense's thread", async () => {
    await asRole(db, { role: "authenticated", uid: TEAM_LEAD, org: ORG_A, roles: "TEAM_LEAD" });
    await expect(
      db.query(
        `insert into public.expense_comments (org_id, expense_id, author_id, message)
         values ($1, $2, $3, 'Should not land.')`,
        [ORG_A, EXPENSE_UNRELATED, TEAM_LEAD]
      )
    ).rejects.toThrow(/row-level security/);
  });

  it("a MANAGER-of-record keeps visibility (manager clause untouched)", async () => {
    await db.exec("reset role;");
    await db.query(`update public.profiles set manager_id = $1 where id = $2`, [ADMIN, UNRELATED]);
    await asRole(db, { role: "authenticated", uid: ADMIN, org: ORG_A, roles: "MANAGER" });
    const expenses = await visibleIds("public.expenses");
    expect(expenses.has(EXPENSE_UNRELATED)).toBe(true);
    await db.exec("reset role;");
    await db.query(`update public.profiles set manager_id = null where id = $1`, [UNRELATED]);
  });
});

describe("receipts bucket write hardening (own-prefix only)", () => {
  it("an employee cannot delete or overwrite another employee's receipt object", async () => {
    await asRole(db, { role: "authenticated", uid: REPORT_LINKED, org: ORG_A, roles: "" });

    const deleted = await db.query<{ name: string }>(
      `delete from storage.objects where name = $1 returning name`,
      [RECEIPT_UNRELATED]
    );
    expect(deleted.rows).toHaveLength(0); // RLS filters the row from the DELETE

    const updated = await db.query<{ name: string }>(
      `update storage.objects set name = name || '.overwritten' where name = $1 returning name`,
      [RECEIPT_UNRELATED]
    );
    expect(updated.rows).toHaveLength(0);
  });

  it("an employee can still clean up files under their own org/uid prefix", async () => {
    await asRole(db, { role: "authenticated", uid: REPORT_LINKED, org: ORG_A, roles: "" });
    const deleted = await db.query<{ name: string }>(
      `delete from storage.objects where name = $1 returning name`,
      [RECEIPT_LINKED]
    );
    expect(deleted.rows).toHaveLength(1);

    // Restore for any later assertions.
    await db.exec("reset role;");
    await db.query(`insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [RECEIPT_LINKED]);
  });

  it("finance roles do not gain direct storage deletes (service role is the path)", async () => {
    await asRole(db, { role: "authenticated", uid: APPROVER, org: ORG_A, roles: "FINANCE_APPROVER" });
    const deleted = await db.query<{ name: string }>(
      `delete from storage.objects where name = $1 returning name`,
      [RECEIPT_UNRELATED]
    );
    expect(deleted.rows).toHaveLength(0);
  });
});
