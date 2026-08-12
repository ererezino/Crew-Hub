/**
 * DATABASE-BACKED test (PGlite) for the FINANCE_APPROVER expense-stack RLS
 * parity migration. The app layer (canFinanceApproveExpenses, payment-proof
 * upload, approvals UI) has always treated FINANCE_APPROVER as a full finance
 * operator, but the RLS policies only granted FINANCE_ADMIN — so approvers got
 * "receipt not found" / "expense not found" on rows the UI told them they
 * could act on. These tests pin the repaired policies: FINANCE_APPROVER and
 * FINANCE_ADMIN must see the exact same expense stack, and the pre-existing
 * boundaries (plain employees, cross-org) must remain intact.
 *
 * One PGlite instance is shared across the file (WASM instances are expensive
 * under parallel suite load); tests run in declaration order and only test 2
 * mutates state, in a way later tests do not depend on.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asRole, createTestDb, type TestDb } from "./helpers/pglite-harness";

const MIGRATIONS = ["20260811090000_finance_approver_expense_visibility.sql"];

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const EMPLOYEE = "10000000-0000-4000-8000-000000000001"; // submitted the expense
const APPROVER = "10000000-0000-4000-8000-000000000002"; // FINANCE_APPROVER, not the owner/manager
const ADMIN = "10000000-0000-4000-8000-000000000003"; // FINANCE_ADMIN baseline
const OUTSIDER = "10000000-0000-4000-8000-000000000004"; // plain employee, unrelated

const EXPENSE_A = "20000000-0000-4000-8000-000000000001"; // ORG_A, manager_approved
const EXPENSE_B = "20000000-0000-4000-8000-000000000002"; // ORG_B (cross-org)
const COMMENT_A = "30000000-0000-4000-8000-000000000001";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb(MIGRATIONS);
  await db.exec(`
    alter table public.expenses enable row level security;
    alter table public.expense_comments enable row level security;
    alter table public.expense_comment_attachments enable row level security;
    alter table public.expense_attachments enable row level security;
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated, anon;
    grant select on storage.objects to authenticated, anon;
  `);

  const profile = (id: string, org: string) =>
    db.query(`insert into public.profiles (id, org_id, status) values ($1, $2, 'active')`, [id, org]);
  await profile(EMPLOYEE, ORG_A);
  await profile(APPROVER, ORG_A);
  await profile(ADMIN, ORG_A);
  await profile(OUTSIDER, ORG_A);

  await db.query(
    `insert into public.expenses (id, org_id, employee_id, status, receipt_file_path)
     values ($1, $2, $3, 'manager_approved', $4)`,
    [EXPENSE_A, ORG_A, EMPLOYEE, `${ORG_A}/${EMPLOYEE}/${EXPENSE_A}/receipt.pdf`]
  );
  await db.query(
    `insert into public.expenses (id, org_id, employee_id, status, receipt_file_path)
     values ($1, $2, $3, 'manager_approved', 'other-org/receipt.pdf')`,
    [EXPENSE_B, ORG_B, OUTSIDER]
  );

  await db.query(
    `insert into public.expense_attachments (org_id, expense_id, file_name, file_path)
     values ($1, $2, 'receipt.pdf', $3)`,
    [ORG_A, EXPENSE_A, `${ORG_A}/${EMPLOYEE}/${EXPENSE_A}/receipt.pdf`]
  );
  await db.query(
    `insert into public.expense_comments (id, org_id, expense_id, author_id, message)
     values ($1, $2, $3, $4, 'Please clarify the vendor.')`,
    [COMMENT_A, ORG_A, EXPENSE_A, EMPLOYEE]
  );
  await db.query(
    `insert into public.expense_comment_attachments (org_id, comment_id, file_path)
     values ($1, $2, $3)`,
    [ORG_A, COMMENT_A, `${ORG_A}/comments/${COMMENT_A}/quote.pdf`]
  );
  await db.query(
    `insert into storage.objects (bucket_id, name) values ('receipts', $1)`,
    [`${ORG_A}/${EMPLOYEE}/${EXPENSE_A}/receipt.pdf`]
  );
});

afterAll(async () => {
  await db.close();
});

async function visibleExpenseIds(): Promise<Set<string>> {
  const rows = await db.query<{ id: string }>(`select id from public.expenses`);
  return new Set(rows.rows.map((r) => r.id));
}

describe("FINANCE_APPROVER expense-stack RLS parity", () => {
  it("a finance approver sees org expenses, attachments, comments, and receipt objects (parity with finance admin)", async () => {
    for (const [uid, roles] of [
      [APPROVER, "FINANCE_APPROVER"],
      [ADMIN, "FINANCE_ADMIN"]
    ] as const) {
      await asRole(db, { role: "authenticated", uid, org: ORG_A, roles });

      const expenses = await visibleExpenseIds();
      expect(expenses.has(EXPENSE_A)).toBe(true); // org expense visible
      expect(expenses.has(EXPENSE_B)).toBe(false); // cross-org hidden

      const attachments = await db.query(`select id from public.expense_attachments`);
      expect(attachments.rows).toHaveLength(1);

      const comments = await db.query(`select id from public.expense_comments`);
      expect(comments.rows).toHaveLength(1);

      const commentFiles = await db.query(`select id from public.expense_comment_attachments`);
      expect(commentFiles.rows).toHaveLength(1);

      const objects = await db.query(`select name from storage.objects`);
      expect(objects.rows).toHaveLength(1);
    }
  });

  it("a finance approver can post a comment and move a manager_approved expense to reimbursed", async () => {
    await asRole(db, { role: "authenticated", uid: APPROVER, org: ORG_A, roles: "FINANCE_APPROVER" });

    await db.query(
      `insert into public.expense_comments (org_id, expense_id, author_id, message)
       values ($1, $2, $3, 'Payment sent, proof attached.')`,
      [ORG_A, EXPENSE_A, APPROVER]
    );

    const updated = await db.query<{ id: string }>(
      `update public.expenses set status = 'reimbursed' where id = $1 returning id`,
      [EXPENSE_A]
    );
    expect(updated.rows).toHaveLength(1);
  });

  it("a plain employee still sees only their own expenses and cannot touch others' rows", async () => {
    await asRole(db, { role: "authenticated", uid: OUTSIDER, org: ORG_A, roles: "" });

    const expenses = await visibleExpenseIds();
    expect(expenses.has(EXPENSE_A)).toBe(false);
    expect(expenses.has(EXPENSE_B)).toBe(false);

    // RLS filters the row out of the UPDATE entirely — zero rows affected.
    const updated = await db.query<{ id: string }>(
      `update public.expenses set status = 'pending' where id = $1 returning id`,
      [EXPENSE_A]
    );
    expect(updated.rows).toHaveLength(0);
  });

  it("the expense owner keeps their own visibility", async () => {
    await asRole(db, { role: "authenticated", uid: EMPLOYEE, org: ORG_A, roles: "" });

    const expenses = await visibleExpenseIds();
    expect(expenses.has(EXPENSE_A)).toBe(true);
    expect(expenses.has(EXPENSE_B)).toBe(false);
  });
});
