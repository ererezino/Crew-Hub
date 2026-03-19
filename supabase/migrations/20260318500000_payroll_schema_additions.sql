-- Payroll schema additions (v3)
-- Per-run payout cycles with full lifecycle, overtime entries,
-- batch audit trail, historical publication governance,
-- amendment support, and least-privilege finance-only RLS.
-- All changes are additive — no existing columns or tables are dropped.

begin;

-- ══════════════════════════════════════════════════════════════════════
-- 1. profiles.overtime_eligible
-- ══════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists overtime_eligible boolean not null default false;

-- ══════════════════════════════════════════════════════════════════════
-- 2. payroll_runs additions
--    Monthly batch identity, audit trail, amendment lineage,
--    and historical-publication governance.
-- ══════════════════════════════════════════════════════════════════════

-- Monthly batch identity (YYYY-MM)
alter table public.payroll_runs
  add column if not exists run_month varchar(7)
    check (run_month is null or run_month ~ '^\d{4}-\d{2}$');

-- Publication: when payslips were made visible to employees
alter table public.payroll_runs
  add column if not exists published_at timestamptz;
alter table public.payroll_runs
  add column if not exists published_by uuid references public.profiles(id);

-- Submission audit
alter table public.payroll_runs
  add column if not exists submitted_at timestamptz;
alter table public.payroll_runs
  add column if not exists submitted_by uuid references public.profiles(id);

-- Rejection audit
alter table public.payroll_runs
  add column if not exists rejected_at timestamptz;
alter table public.payroll_runs
  add column if not exists rejected_by uuid references public.profiles(id);
alter table public.payroll_runs
  add column if not exists rejection_reason text;

-- Completion audit
alter table public.payroll_runs
  add column if not exists completed_at timestamptz;
alter table public.payroll_runs
  add column if not exists completed_by uuid references public.profiles(id);

-- Amendment batches: links a corrective run to its parent
alter table public.payroll_runs
  add column if not exists amendment_of uuid references public.payroll_runs(id);

-- Batch immutability: set when all cycles are paid
alter table public.payroll_runs
  add column if not exists locked_at timestamptz;

-- Historical-publication governance (uploaded legacy batches)
-- Tracks whether this run represents uploaded historical data
-- and the review/authorization lifecycle for that upload.
alter table public.payroll_runs
  add column if not exists is_historical boolean not null default false;
alter table public.payroll_runs
  add column if not exists reviewed_at timestamptz;
alter table public.payroll_runs
  add column if not exists reviewed_by uuid references public.profiles(id);
alter table public.payroll_runs
  add column if not exists authorized_at timestamptz;
alter table public.payroll_runs
  add column if not exists authorized_by uuid references public.profiles(id);

-- Backfill run_month from pay_period_start for existing runs.
-- Only the most recent non-cancelled, non-deleted, non-amendment run
-- per org+month gets the run_month value. Older duplicates stay NULL
-- to avoid violating the partial unique index.
update public.payroll_runs pr
set run_month = to_char(pr.pay_period_start, 'YYYY-MM')
from (
  select distinct on (org_id, to_char(pay_period_start, 'YYYY-MM'))
    id
  from public.payroll_runs
  where deleted_at is null
    and status != 'cancelled'
    and amendment_of is null
  order by org_id, to_char(pay_period_start, 'YYYY-MM'), created_at desc
) latest
where pr.id = latest.id
  and pr.run_month is null;

-- One primary (non-amendment) run per org per month.
-- Excludes cancelled and soft-deleted runs so cancel-and-recreate works.
create unique index if not exists idx_payroll_runs_org_month_primary
  on public.payroll_runs(org_id, run_month)
  where amendment_of is null
    and deleted_at is null
    and status != 'cancelled';

create index if not exists idx_payroll_runs_amendment
  on public.payroll_runs(amendment_of)
  where amendment_of is not null;

-- ══════════════════════════════════════════════════════════════════════
-- 3. payroll_items additions (overtime + correction path)
-- ══════════════════════════════════════════════════════════════════════

alter table public.payroll_items
  add column if not exists overtime_amount bigint not null default 0
    check (overtime_amount >= 0);

alter table public.payroll_items
  add column if not exists overtime_hours numeric(8, 2) not null default 0
    check (overtime_hours >= 0);

-- Correction lineage: points to the original item being corrected
alter table public.payroll_items
  add column if not exists correction_of uuid references public.payroll_items(id);

alter table public.payroll_items
  add column if not exists correction_reason text;

-- Internal finance notes (separate from employee-visible notes)
alter table public.payroll_items
  add column if not exists finance_notes text;

create index if not exists idx_payroll_items_correction
  on public.payroll_items(correction_of)
  where correction_of is not null;

-- ══════════════════════════════════════════════════════════════════════
-- 4. payroll_cycles (per-run payout cycles with full lifecycle)
-- ══════════════════════════════════════════════════════════════════════

create table if not exists public.payroll_cycles (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  org_id uuid not null references public.orgs(id),
  label varchar(200) not null,
  currency varchar(3) not null check (currency ~ '^[A-Z]{3}$'),
  status varchar(20) not null default 'draft'
    check (status in ('draft', 'ready', 'processing', 'paid', 'failed', 'cancelled')),
  -- Payout lifecycle
  target_pay_date date,
  prepared_at timestamptz,
  prepared_by uuid references public.profiles(id),
  paid_at timestamptz,
  paid_by uuid references public.profiles(id),
  payment_snapshot jsonb not null default '{}'::jsonb,
  -- Reconciliation
  reconciled_at timestamptz,
  reconciled_by uuid references public.profiles(id),
  reconciliation_notes text,
  -- Immutability
  locked_at timestamptz,
  -- Totals
  total_gross bigint not null default 0 check (total_gross >= 0),
  total_net bigint not null default 0,
  total_deductions bigint not null default 0 check (total_deductions >= 0),
  employee_count int not null default 0 check (employee_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint payroll_cycles_label_length check (char_length(trim(label)) > 0)
);

create index if not exists idx_payroll_cycles_run
  on public.payroll_cycles(payroll_run_id, status)
  where deleted_at is null;

create index if not exists idx_payroll_cycles_org_status
  on public.payroll_cycles(org_id, status)
  where deleted_at is null;

drop trigger if exists set_payroll_cycles_updated_at on public.payroll_cycles;
create trigger set_payroll_cycles_updated_at
before update on public.payroll_cycles
for each row
execute function public.set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
-- 5. payroll_cycle_items (employee disbursement within a cycle)
-- ══════════════════════════════════════════════════════════════════════

create table if not exists public.payroll_cycle_items (
  id uuid primary key default gen_random_uuid(),
  payroll_cycle_id uuid not null references public.payroll_cycles(id) on delete cascade,
  payroll_item_id uuid not null references public.payroll_items(id) on delete cascade,
  employee_id uuid not null references public.profiles(id),
  org_id uuid not null references public.orgs(id),
  payment_destination_snapshot jsonb not null default '{}'::jsonb,
  disbursement_status varchar(20) not null default 'pending'
    check (disbursement_status in ('pending', 'processing', 'paid', 'failed')),
  disbursement_reference varchar(200),
  disbursement_amount bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- One item per cycle (no double-paying)
create unique index if not exists idx_payroll_cycle_items_unique_item
  on public.payroll_cycle_items(payroll_cycle_id, payroll_item_id)
  where deleted_at is null;

-- One employee per cycle
create unique index if not exists idx_payroll_cycle_items_unique_employee
  on public.payroll_cycle_items(payroll_cycle_id, employee_id)
  where deleted_at is null;

create index if not exists idx_payroll_cycle_items_item
  on public.payroll_cycle_items(payroll_item_id);

create index if not exists idx_payroll_cycle_items_employee
  on public.payroll_cycle_items(org_id, employee_id)
  where deleted_at is null;

drop trigger if exists set_payroll_cycle_items_updated_at on public.payroll_cycle_items;
create trigger set_payroll_cycle_items_updated_at
before update on public.payroll_cycle_items
for each row
execute function public.set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
-- 6. overtime_entries (finance workflow)
-- ══════════════════════════════════════════════════════════════════════

create table if not exists public.overtime_entries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  org_id uuid not null references public.orgs(id),
  entry_date date not null,
  hours numeric(6, 2) not null check (hours > 0),
  multiplier numeric(4, 2) not null default 1.50 check (multiplier > 0),
  amount bigint not null default 0 check (amount >= 0),
  currency varchar(3) not null check (currency ~ '^[A-Z]{3}$'),
  description text,
  status varchar(20) not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  payroll_item_id uuid references public.payroll_items(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_overtime_entries_org_employee
  on public.overtime_entries(org_id, employee_id, entry_date desc);

create index if not exists idx_overtime_entries_org_status
  on public.overtime_entries(org_id, status)
  where deleted_at is null;

create index if not exists idx_overtime_entries_payroll_item
  on public.overtime_entries(payroll_item_id)
  where payroll_item_id is not null;

drop trigger if exists set_overtime_entries_updated_at on public.overtime_entries;
create trigger set_overtime_entries_updated_at
before update on public.overtime_entries
for each row
execute function public.set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
-- 7. payslips additions (native + historical statement handling)
-- ══════════════════════════════════════════════════════════════════════

alter table public.payslips
  add column if not exists currency varchar(3)
    check (currency is null or currency ~ '^[A-Z]{3}$');

alter table public.payslips
  add column if not exists gross_amount bigint
    check (gross_amount is null or gross_amount >= 0);

alter table public.payslips
  add column if not exists net_amount bigint;

-- When this payslip was made visible to the employee
alter table public.payslips
  add column if not exists published_at timestamptz;

-- native = system-generated from payroll run; historical = uploaded legacy
alter table public.payslips
  add column if not exists statement_type varchar(20) not null default 'native'
    check (statement_type in ('native', 'historical'));

-- Backfill payslips from linked payroll_items
update public.payslips ps
set
  currency     = pi.currency,
  gross_amount = pi.gross_amount,
  net_amount   = pi.net_amount
from public.payroll_items pi
where ps.payroll_item_id = pi.id
  and ps.currency is null;

-- ══════════════════════════════════════════════════════════════════════
-- 8. Grants and RLS
--    Least-privilege, finance-only.
--    FINANCE_APPROVER is a true superset of FINANCE_ADMIN:
--    anything FINANCE_ADMIN can do, FINANCE_APPROVER can also do.
--    Employees have NO direct access to payroll tables
--    (employee-facing views are served through My Pay APIs).
-- ══════════════════════════════════════════════════════════════════════

-- Grants
grant select, insert, update, delete on table public.payroll_cycles to authenticated;
grant select, insert, update, delete on table public.payroll_cycle_items to authenticated;
grant select, insert, update, delete on table public.overtime_entries to authenticated;

-- Enable RLS
alter table public.payroll_cycles enable row level security;
alter table public.payroll_cycle_items enable row level security;
alter table public.overtime_entries enable row level security;

-- ── payroll_runs: finance-only (remove HR_ADMIN) ──

drop policy if exists payroll_runs_select_scope on public.payroll_runs;
create policy payroll_runs_select_scope
on public.payroll_runs
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists payroll_runs_insert_scope on public.payroll_runs;
create policy payroll_runs_insert_scope
on public.payroll_runs
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists payroll_runs_update_scope on public.payroll_runs;
create policy payroll_runs_update_scope
on public.payroll_runs
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists payroll_runs_delete_scope on public.payroll_runs;
create policy payroll_runs_delete_scope
on public.payroll_runs
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

-- ── payroll_items: finance-only (remove HR_ADMIN) ──

drop policy if exists payroll_items_select_scope on public.payroll_items;
create policy payroll_items_select_scope
on public.payroll_items
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists payroll_items_insert_scope on public.payroll_items;
create policy payroll_items_insert_scope
on public.payroll_items
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and exists (
    select 1
    from public.payroll_runs run
    where run.id = payroll_run_id
      and run.org_id = public.get_user_org_id()
      and run.deleted_at is null
  )
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists payroll_items_update_scope on public.payroll_items;
create policy payroll_items_update_scope
on public.payroll_items
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists payroll_items_delete_scope on public.payroll_items;
create policy payroll_items_delete_scope
on public.payroll_items
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

-- ── payroll_cycles RLS (finance-only) ──

drop policy if exists payroll_cycles_select_scope on public.payroll_cycles;
create policy payroll_cycles_select_scope
on public.payroll_cycles
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists payroll_cycles_insert_scope on public.payroll_cycles;
create policy payroll_cycles_insert_scope
on public.payroll_cycles
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists payroll_cycles_update_scope on public.payroll_cycles;
create policy payroll_cycles_update_scope
on public.payroll_cycles
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists payroll_cycles_delete_scope on public.payroll_cycles;
create policy payroll_cycles_delete_scope
on public.payroll_cycles
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

-- ── payroll_cycle_items RLS (finance-only, NO employee access) ──
-- Employees see cycle info only through My Pay APIs, never raw rows.

drop policy if exists payroll_cycle_items_select_scope on public.payroll_cycle_items;
create policy payroll_cycle_items_select_scope
on public.payroll_cycle_items
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists payroll_cycle_items_insert_scope on public.payroll_cycle_items;
create policy payroll_cycle_items_insert_scope
on public.payroll_cycle_items
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists payroll_cycle_items_update_scope on public.payroll_cycle_items;
create policy payroll_cycle_items_update_scope
on public.payroll_cycle_items
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists payroll_cycle_items_delete_scope on public.payroll_cycle_items;
create policy payroll_cycle_items_delete_scope
on public.payroll_cycle_items
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

-- ── overtime_entries RLS (finance-only, employee read-own only) ──

drop policy if exists overtime_entries_select_scope on public.overtime_entries;
create policy overtime_entries_select_scope
on public.overtime_entries
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    employee_id = auth.uid()
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

-- Finance-only insert (no employee self-service)
drop policy if exists overtime_entries_insert_scope on public.overtime_entries;
create policy overtime_entries_insert_scope
on public.overtime_entries
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists overtime_entries_update_scope on public.overtime_entries;
create policy overtime_entries_update_scope
on public.overtime_entries
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists overtime_entries_delete_scope on public.overtime_entries;
create policy overtime_entries_delete_scope
on public.overtime_entries
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

commit;
