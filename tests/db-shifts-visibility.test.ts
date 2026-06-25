/**
 * DATABASE-BACKED test (PGlite) for the review's finding #1: shift RLS must be
 * consistent with schedule RLS. An employee assigned to a published schedule
 * (but not rostered and in a different department) must see BOTH the schedule
 * row AND every shift in it — not only their own — and drafts / unrelated /
 * cross-org must remain hidden, with no RLS recursion.
 */
import { afterEach, describe, expect, it } from "vitest";

import { asRole, createTestDb, type TestDb } from "./helpers/pglite-harness";

const MIGRATIONS = ["20260624120000_schedule_visibility_normalized.sql"];

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const USER = "10000000-0000-4000-8000-000000000001"; // CS employee
const MATE = "10000000-0000-4000-8000-000000000002"; // teammate

let db: TestDb | null = null;
afterEach(async () => {
  if (db) await db.close();
  db = null;
});

describe("shifts_select_published is consistent with schedules_select_scope", () => {
  // Schedule + shift ids
  const finPub = "20000000-0000-4000-8000-000000000001"; // published Finance, USER assigned (not rostered)
  const finDraft = "20000000-0000-4000-8000-000000000002"; // draft Finance, USER assigned
  const finOther = "20000000-0000-4000-8000-000000000003"; // published Finance, USER NOT assigned
  const crossOrg = "20000000-0000-4000-8000-000000000004"; // published, ORG_B

  async function setup() {
    db = await createTestDb(MIGRATIONS);
    await db.exec("alter table public.schedules enable row level security;");
    await db.exec("alter table public.shifts enable row level security;");
    await db.query(
      `insert into public.profiles (id, org_id, department, status) values ($1, $2, 'Customer Success', 'active')`,
      [USER, ORG_A]
    );

    const sched = (id: string, org: string, status: string, dep: string | null) =>
      db!.query(
        `insert into public.schedules (id, org_id, status, department, start_date, end_date)
         values ($1, $2, $3, $4, '2026-07-01', '2026-07-31')`,
        [id, org, status, dep]
      );
    await sched(finPub, ORG_A, "published", "Finance");
    await sched(finDraft, ORG_A, "draft", "Finance");
    await sched(finOther, ORG_A, "published", "Finance");
    await sched(crossOrg, ORG_B, "published", "Customer Success");

    const shift = (id: string, org: string, schedule: string, emp: string) =>
      db!.query(
        `insert into public.shifts (id, org_id, schedule_id, employee_id, shift_date, start_time, end_time, status)
         values ($1, $2, $3, $4, '2026-07-06', '2026-07-06T08:00:00Z', '2026-07-06T16:00:00Z', 'scheduled')`,
        [id, org, schedule, emp]
      );
    // Published Finance schedule: USER's shift + a teammate's shift.
    await shift("30000000-0000-4000-8000-000000000001", ORG_A, finPub, USER);
    await shift("30000000-0000-4000-8000-000000000002", ORG_A, finPub, MATE);
    // Draft Finance schedule: USER assigned — must STILL be hidden (draft).
    await shift("30000000-0000-4000-8000-000000000003", ORG_A, finDraft, USER);
    // Other published Finance schedule: only a teammate, USER not assigned → hidden.
    await shift("30000000-0000-4000-8000-000000000004", ORG_A, finOther, MATE);
    // Cross-org published schedule.
    await shift("30000000-0000-4000-8000-000000000005", ORG_B, crossOrg, MATE);
  }

  it("an assigned cross-department employee sees the schedule AND all its shifts; drafts/others/cross-org hidden; no recursion", async () => {
    await setup();
    await asRole(db!, { role: "authenticated", uid: USER, org: ORG_A, roles: "" });

    // No RLS recursion: these selects complete rather than raising
    // "infinite recursion detected in policy".
    const schedRows = await db!.query<{ id: string }>(`select id from public.schedules`);
    const visibleSchedules = new Set(schedRows.rows.map((r) => r.id));
    expect(visibleSchedules.has(finPub)).toBe(true); // assigned → visible
    expect(visibleSchedules.has(finDraft)).toBe(false); // draft hidden
    expect(visibleSchedules.has(finOther)).toBe(false); // not assigned, other dept → hidden
    expect(visibleSchedules.has(crossOrg)).toBe(false); // cross-org hidden

    const shiftRows = await db!.query<{ id: string; employee_id: string; schedule_id: string }>(
      `select id, employee_id, schedule_id from public.shifts order by id`
    );
    const visibleShifts = shiftRows.rows;

    // ALL shifts in the assigned published schedule are visible (own + teammate).
    const finPubShifts = visibleShifts.filter((s) => s.schedule_id === finPub);
    expect(finPubShifts).toHaveLength(2);
    expect(new Set(finPubShifts.map((s) => s.employee_id))).toEqual(new Set([USER, MATE]));

    // The draft's shift (even though USER is assigned) is hidden.
    expect(visibleShifts.some((s) => s.schedule_id === finDraft)).toBe(false);
    // The other published schedule (USER not assigned) and cross-org are hidden.
    expect(visibleShifts.some((s) => s.schedule_id === finOther)).toBe(false);
    expect(visibleShifts.some((s) => s.schedule_id === crossOrg)).toBe(false);
  });
});
