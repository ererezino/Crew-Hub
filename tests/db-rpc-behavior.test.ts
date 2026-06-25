/**
 * DATABASE-BACKED behavioral tests (PGlite) for the migration policies/triggers:
 * P1-1 published-schedule visibility (drafts hidden), P1-2 duplicate idempotency
 * + cross-org rejection, P1-4 attachment min/max, P1-6 onboarding exact-match.
 */
import { afterEach, describe, expect, it } from "vitest";

import { asRole, createTestDb, type TestDb } from "./helpers/pglite-harness";

const ALL = [
  "20260624120000_schedule_visibility_normalized.sql",
  "20260624130000_replace_grid_cell_rpc.sql",
  "20260624140000_duplicate_schedule_rpc.sql",
  "20260624150000_decide_leave_change_rpc.sql",
  "20260624160000_expense_attachment_limits.sql",
  "20260624170000_complete_onboarding_task_rpc.sql"
];

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const USER = "10000000-0000-4000-8000-000000000001";

let db: TestDb | null = null;
afterEach(async () => {
  if (db) await db.close();
  db = null;
});

describe("P1-1: published-schedule RLS hides drafts from ordinary employees", () => {
  async function setup() {
    db = await createTestDb(ALL);
    await db.exec("alter table public.schedules enable row level security;");
    // The ordinary employee, in ORG_A, department 'Customer Success'.
    await db.query(
      `insert into public.profiles (id, org_id, department, status) values ($1, $2, 'Customer Success', 'active')`,
      [USER, ORG_A]
    );
    const ids = {
      draftSame: "20000000-0000-4000-8000-000000000001",
      pubSame: "20000000-0000-4000-8000-000000000002",
      pubOther: "20000000-0000-4000-8000-000000000003",
      pubUnscoped: "20000000-0000-4000-8000-000000000004",
      pubRostered: "20000000-0000-4000-8000-000000000005",
      pubMixedCase: "20000000-0000-4000-8000-000000000006",
      pubCrossOrg: "20000000-0000-4000-8000-000000000007"
    };
    const seed = async (id: string, org: string, status: string, dep: string | null) =>
      db!.query(
        `insert into public.schedules (id, org_id, status, department, start_date, end_date)
         values ($1, $2, $3, $4, '2026-07-01', '2026-07-31')`,
        [id, org, status, dep]
      );
    await seed(ids.draftSame, ORG_A, "draft", "Customer Success");
    await seed(ids.pubSame, ORG_A, "published", "Customer Success");
    await seed(ids.pubOther, ORG_A, "published", "Finance");
    await seed(ids.pubUnscoped, ORG_A, "published", null);
    await seed(ids.pubRostered, ORG_A, "published", "Finance");
    await seed(ids.pubMixedCase, ORG_A, "published", "  customer SUCCESS ");
    await seed(ids.pubCrossOrg, ORG_B, "published", "Customer Success");
    // The user is rostered onto the cross-department published schedule.
    await db.query(`insert into public.schedule_roster (schedule_id, employee_id) values ($1, $2)`, [
      ids.pubRostered,
      USER
    ]);
    return ids;
  }

  it("an ordinary employee sees only entitled PUBLISHED schedules; the draft is hidden", async () => {
    const ids = await setup();
    await asRole(db!, { role: "authenticated", uid: USER, org: ORG_A, roles: "" });
    const rows = await db!.query<{ id: string }>(`select id from public.schedules order by id`);
    const visible = new Set(rows.rows.map((r) => r.id));

    expect(visible.has(ids.pubSame)).toBe(true); // same department
    expect(visible.has(ids.pubMixedCase)).toBe(true); // normalized (trim + case-insensitive)
    expect(visible.has(ids.pubUnscoped)).toBe(true); // unscoped / org-wide
    expect(visible.has(ids.pubRostered)).toBe(true); // rostered cross-department

    expect(visible.has(ids.draftSame)).toBe(false); // DRAFT hidden (P1-1)
    expect(visible.has(ids.pubOther)).toBe(false); // unrelated department hidden
    expect(visible.has(ids.pubCrossOrg)).toBe(false); // cross-org hidden
  });

  it("a manager sees drafts too", async () => {
    const ids = await setup();
    await asRole(db!, { role: "authenticated", uid: USER, org: ORG_A, roles: "MANAGER" });
    const rows = await db!.query<{ id: string }>(`select id from public.schedules`);
    const visible = new Set(rows.rows.map((r) => r.id));
    expect(visible.has(ids.draftSame)).toBe(true);
  });
});

describe("P1-2: duplicate_schedule idempotency + cross-org rejection", () => {
  async function setupOrg() {
    db = await createTestDb(ALL);
    await db.query(`insert into public.profiles (id, org_id, status) values ($1, $2, 'active')`, [USER, ORG_A]);
    await asRole(db, { role: "service_role" });
  }

  it("a repeated op key returns the SAME schedule (no second draft)", async () => {
    await setupOrg();
    const args = `$1, 'Copy', null, '2026-08-01'::date, '2026-08-31'::date, 'weekday',
      '[]'::jsonb, '[]'::jsonb, 'op-key-123'`;
    const first = await db!.query<{ r: { schedule: { id: string } } }>(
      `select public.duplicate_schedule(${args}) as r`,
      [ORG_A]
    );
    const second = await db!.query<{ r: { schedule: { id: string }; idempotent: boolean } }>(
      `select public.duplicate_schedule(${args}) as r`,
      [ORG_A]
    );
    expect(second.rows[0]!.r.idempotent).toBe(true);
    expect(second.rows[0]!.r.schedule.id).toBe(first.rows[0]!.r.schedule.id);
    const count = await db!.query<{ n: number }>(`select count(*)::int as n from public.schedules`);
    expect(count.rows[0]!.n).toBe(1); // exactly one created
  });

  it("rejects a roster employee from another organization (CROSS_ORG_EMPLOYEE)", async () => {
    await setupOrg();
    const foreign = "99999999-0000-4000-8000-000000000001";
    await db!.query(`insert into public.profiles (id, org_id, status) values ($1, $2, 'active')`, [foreign, ORG_B]);
    const res = await db!.query<{ r: { error?: string } }>(
      `select public.duplicate_schedule($1, 'Copy', null, '2026-08-01'::date, '2026-08-31'::date, 'weekday',
        $2::jsonb, '[]'::jsonb, null) as r`,
      [ORG_A, JSON.stringify([{ employee_id: foreign }])]
    );
    expect(res.rows[0]!.r.error).toBe("CROSS_ORG_EMPLOYEE");
    const count = await db!.query<{ n: number }>(`select count(*)::int as n from public.schedules`);
    expect(count.rows[0]!.n).toBe(0); // rolled back — no orphan draft
  });
});

describe("P1-4: expense attachment limits (max 10, min 1 in every non-cancelled state)", () => {
  async function seedExpense(status: string) {
    db = await createTestDb(ALL);
    const expense = "70000000-0000-4000-8000-000000000001";
    await db.query(`insert into public.expenses (id, org_id, status, receipt_file_path) values ($1, $2, $3, 'p/1')`, [
      expense,
      ORG_A,
      status
    ]);
    return expense;
  }
  async function addAttachment(expense: string, n: number) {
    return db!.query(
      `insert into public.expense_attachments (org_id, expense_id, file_name, file_path, sort_order)
       values ($1, $2, $3, $4, $5)`,
      [ORG_A, expense, `f${n}.png`, `p/${n}`, n]
    );
  }

  it("rejects the 11th attachment", async () => {
    const expense = await seedExpense("pending");
    for (let i = 1; i <= 10; i += 1) await addAttachment(expense, i);
    await expect(addAttachment(expense, 11)).rejects.toThrow(/maximum/i);
  });

  it("rejects removing the LAST attachment of a PENDING expense (min-1 in every state)", async () => {
    const expense = await seedExpense("pending");
    await addAttachment(expense, 1);
    const only = await db!.query<{ id: string }>(`select id from public.expense_attachments limit 1`);
    await expect(
      db!.query(`update public.expense_attachments set deleted_at = now() where id = $1`, [only.rows[0]!.id])
    ).rejects.toThrow(/last evidence/i);
  });

  it("repoints the primary receipt to the next attachment when the primary is removed (same transaction)", async () => {
    const expense = await seedExpense("approved");
    await addAttachment(expense, 1); // p/1 is the primary
    await addAttachment(expense, 2); // p/2
    const primary = await db!.query<{ id: string }>(
      `select id from public.expense_attachments where file_path = 'p/1'`
    );
    await db!.query(`update public.expense_attachments set deleted_at = now() where id = $1`, [primary.rows[0]!.id]);
    const exp = await db!.query<{ receipt_file_path: string }>(
      `select receipt_file_path from public.expenses where id = $1`,
      [expense]
    );
    expect(exp.rows[0]!.receipt_file_path).toBe("p/2"); // repointed atomically
  });
});

describe("P1-6: onboarding completion exact-match dependency enforcement + unlock", () => {
  async function seed() {
    db = await createTestDb(ALL);
    await asRole(db, { role: "service_role" });
  }

  it("blocks completion when a declared prerequisite is missing/deleted (no empty-set bypass)", async () => {
    await seed();
    const instance = "80000000-0000-4000-8000-000000000001";
    const blocked = "80000000-0000-4000-8000-000000000002";
    const missingPrereq = "80000000-0000-4000-8000-0000000000ff";
    // 'blocked' declares a dependency on a task that does NOT exist.
    await db!.query(
      `insert into public.onboarding_tasks (id, org_id, instance_id, status, depends_on_task_ids)
       values ($1, $2, $3, 'blocked', array[$4]::uuid[])`,
      [blocked, ORG_A, instance, missingPrereq]
    );
    const res = await db!.query<{ r: { error?: string } }>(
      `select public.complete_onboarding_task_with_unlock($1, $2, $3, true) as r`,
      [blocked, ORG_A, USER]
    );
    expect(res.rows[0]!.r.error).toBe("TASK_BLOCKED");
  });

  it("completing the final prerequisite unlocks the dependent atomically", async () => {
    await seed();
    const instance = "80000000-0000-4000-8000-000000000010";
    const prereq = "80000000-0000-4000-8000-000000000011";
    const dependent = "80000000-0000-4000-8000-000000000012";
    await db!.query(
      `insert into public.onboarding_tasks (id, org_id, instance_id, status, depends_on_task_ids)
       values ($1, $2, $3, 'pending', null)`,
      [prereq, ORG_A, instance]
    );
    await db!.query(
      `insert into public.onboarding_tasks (id, org_id, instance_id, status, depends_on_task_ids)
       values ($1, $2, $3, 'blocked', array[$4]::uuid[])`,
      [dependent, ORG_A, instance, prereq]
    );

    const res = await db!.query<{ r: { completed: boolean; unlocked: string[] } }>(
      `select public.complete_onboarding_task_with_unlock($1, $2, $3, true) as r`,
      [prereq, ORG_A, USER]
    );
    expect(res.rows[0]!.r.completed).toBe(true);
    expect(res.rows[0]!.r.unlocked).toContain(dependent);

    const dep = await db!.query<{ status: string }>(`select status from public.onboarding_tasks where id = $1`, [
      dependent
    ]);
    expect(dep.rows[0]!.status).toBe("pending"); // unlocked in the same call
  });
});
