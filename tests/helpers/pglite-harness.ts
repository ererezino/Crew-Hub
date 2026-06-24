import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";

/**
 * Database-backed test harness.
 *
 * Spins up an isolated in-process Postgres (PGlite — real Postgres compiled to
 * WASM, with plpgsql, triggers, FOR UPDATE, roles and GRANT/REVOKE), creates the
 * minimum scaffolding the new migrations reference (tables + Supabase-style
 * helper stubs + the anon/authenticated/service_role roles + an auth.uid()
 * driven by a GUC), then applies the ACTUAL migration files under test.
 *
 * This is what lets us execute the new RPCs as anon/authenticated/service_role
 * and exercise the real SQL (locking, triggers, policy expressions) rather than
 * mocking the Supabase client.
 */

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");

function migrationSql(name: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
}

/** Minimal scaffolding: roles, auth stubs, helper functions, and the tables the
 *  migrations touch (only the columns they reference). */
const SCAFFOLD = `
create role anon;
create role authenticated;
create role service_role;

create schema if not exists auth;
-- auth.uid()/jwt() are driven by GUCs the tests set per "session".
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;

-- Supabase-style helpers the policies/functions call. Stubbed off GUCs so tests
-- can simulate the caller's org and roles.
create or replace function public.get_user_org_id() returns uuid language sql stable as $$
  select nullif(current_setting('test.org', true), '')::uuid
$$;
create or replace function public.has_role(p_role text) returns boolean language sql stable as $$
  select coalesce(current_setting('test.roles', true), '') like '%' || p_role || '%'
$$;
create or replace function public.is_team_lead_for_department(p_dep text) returns boolean language sql stable as $$
  select false
$$;

create table public.orgs (id uuid primary key);

create table public.profiles (
  id uuid primary key,
  org_id uuid,
  department text,
  status text,
  team_lead_id uuid,
  manager_id uuid,
  deleted_at timestamptz
);

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  name text,
  department text,
  start_date date,
  end_date date,
  schedule_track text,
  status text not null default 'draft',
  published_at timestamptz,
  published_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.schedule_roster (
  schedule_id uuid not null,
  employee_id uuid not null,
  weekend_hours text
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  schedule_id uuid not null,
  template_id uuid,
  employee_id uuid,
  shift_date date,
  start_time timestamptz,
  end_time timestamptz,
  break_minutes int default 0,
  status text default 'scheduled',
  notes text,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.shift_swaps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  shift_id uuid not null,
  deleted_at timestamptz
);

-- has_shift_assignment_in_schedule mirrors the real helper closely enough for
-- the visibility tests: true when the caller has a (non-deleted) shift in the schedule.
create or replace function public.has_shift_assignment_in_schedule(p_schedule_id uuid, p_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.shifts s
    where s.schedule_id = p_schedule_id and s.org_id = p_org_id
      and s.employee_id = auth.uid() and s.deleted_at is null
  )
$$;

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  employee_id uuid not null,
  leave_type text not null,
  start_date date not null,
  end_date date not null,
  total_days numeric not null default 0,
  status text not null,
  reason text default '',
  approver_id uuid,
  rejection_reason text,
  pending_change_type text,
  pending_start_date date,
  pending_end_date date,
  pending_total_days numeric,
  change_reason text,
  change_requested_by uuid,
  change_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.leave_balances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  employee_id uuid not null,
  leave_type text not null,
  year int not null,
  total_days numeric not null default 0,
  used_days numeric not null default 0,
  pending_days numeric not null default 0,
  carried_days numeric not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  actor_user_id uuid,
  action text,
  table_name text,
  record_id uuid,
  old_value jsonb,
  new_value jsonb,
  ip_address text,
  created_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  status text not null,
  receipt_file_path text
);

create table public.expense_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  expense_id uuid not null,
  file_name text not null,
  file_path text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.onboarding_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  instance_id uuid,
  status text not null,
  depends_on_task_ids uuid[],
  completed_by uuid,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
`;

export type TestDb = PGlite;

/** Create a fresh isolated database with scaffolding + the named migrations applied. */
export async function createTestDb(migrationNames: string[]): Promise<TestDb> {
  const db = await PGlite.create();
  // Allow creating functions whose bodies reference objects created later.
  await db.exec("set check_function_bodies = off;");
  await db.exec(SCAFFOLD);
  for (const name of migrationNames) {
    await db.exec(migrationSql(name));
  }
  // Mirror Supabase: service_role has full DML and bypasses RLS; authenticated/
  // anon get schema usage and table grants but are gated by RLS. (Function
  // EXECUTE is governed separately by the per-migration REVOKE/GRANTs.)
  await db.exec(`
    grant usage on schema public to anon, authenticated, service_role;
    grant all on all tables in schema public to service_role;
    grant select, insert, update, delete on all tables in schema public to authenticated, anon;
  `);
  return db;
}

/** Run a callback "as" a Postgres role with a simulated auth.uid()/org/roles. */
export async function asRole(
  db: TestDb,
  opts: { role: "anon" | "authenticated" | "service_role"; uid?: string; org?: string; roles?: string }
): Promise<void> {
  await db.exec("reset role;");
  await db.query("select set_config('test.uid', $1, false)", [opts.uid ?? ""]);
  await db.query("select set_config('test.org', $1, false)", [opts.org ?? ""]);
  await db.query("select set_config('test.roles', $1, false)", [opts.roles ?? ""]);
  await db.exec(`set role ${opts.role};`);
}

/** has_function_privilege for a role against a function signature. */
export async function canExecute(db: TestDb, role: string, signature: string): Promise<boolean> {
  await db.exec("reset role;");
  const r = await db.query<{ ok: boolean }>(
    `select has_function_privilege($1, $2, 'execute') as ok`,
    [role, signature]
  );
  return r.rows[0]!.ok;
}
