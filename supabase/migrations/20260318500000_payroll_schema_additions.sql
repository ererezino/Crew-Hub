-- Payroll schema additions
-- Adds payroll cycles, overtime entries, and denormalized payslip fields.
-- All changes are additive — no existing columns or tables are dropped.

begin;

-- ══════════════════════════════════════════════════════════════════════
-- 1. profiles.overtime_eligible
-- ══════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists overtime_eligible boolean not null default false;

-- ══════════════════════════════════════════════════════════════════════
-- 2. payroll_cycles
-- ══════════════════════════════════════════════════════════════════════

create table if not exists public.payroll_cycles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  name varchar(120) not null,
  frequency varchar(20) not null
    check (frequency in ('weekly', 'biweekly', 'semi_monthly', 'monthly')),
  anchor_day smallint not null default 1
    check (anchor_day between 1 and 31),
  pay_day_offset smallint not null default 0
    check (pay_day_offset between 0 and 30),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint payroll_cycles_name_length check (char_length(trim(name)) > 0)
);

create index if not exists idx_payroll_cycles_org_active
  on public.payroll_cycles(org_id, active)
  where deleted_at is null;

drop trigger if exists set_payroll_cycles_updated_at on public.payroll_cycles;
create trigger set_payroll_cycles_updated_at
before update on public.payroll_cycles
for each row
execute function public.set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
-- 3. payroll_cycle_items (employee-to-cycle assignment)
-- ══════════════════════════════════════════════════════════════════════

create table if not exists public.payroll_cycle_items (
  id uuid primary key default gen_random_uuid(),
  payroll_cycle_id uuid not null references public.payroll_cycles(id) on delete cascade,
  employee_id uuid not null references public.profiles(id),
  org_id uuid not null references public.orgs(id),
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint payroll_cycle_items_window_check
    check (effective_to is null or effective_to >= effective_from)
);

-- Partial unique: one active cycle assignment per employee at a time
create unique index if not exists idx_payroll_cycle_items_active_employee
  on public.payroll_cycle_items(org_id, employee_id)
  where effective_to is null and deleted_at is null;

create index if not exists idx_payroll_cycle_items_cycle
  on public.payroll_cycle_items(payroll_cycle_id, employee_id);

drop trigger if exists set_payroll_cycle_items_updated_at on public.payroll_cycle_items;
create trigger set_payroll_cycle_items_updated_at
before update on public.payroll_cycle_items
for each row
execute function public.set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
-- 4. payroll_runs additions
-- ══════════════════════════════════════════════════════════════════════

alter table public.payroll_runs
  add column if not exists payroll_cycle_id uuid
    references public.payroll_cycles(id);

alter table public.payroll_runs
  add column if not exists run_label varchar(200);

create index if not exists idx_payroll_runs_cycle
  on public.payroll_runs(payroll_cycle_id)
  where payroll_cycle_id is not null;

-- ══════════════════════════════════════════════════════════════════════
-- 5. payroll_items additions
-- ══════════════════════════════════════════════════════════════════════

alter table public.payroll_items
  add column if not exists overtime_amount bigint not null default 0
    check (overtime_amount >= 0);

alter table public.payroll_items
  add column if not exists overtime_hours numeric(8, 2) not null default 0
    check (overtime_hours >= 0);

-- ══════════════════════════════════════════════════════════════════════
-- 6. overtime_entries
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
-- 7. payslips additions (denormalized for fast listing)
-- ══════════════════════════════════════════════════════════════════════

alter table public.payslips
  add column if not exists currency varchar(3)
    check (currency is null or currency ~ '^[A-Z]{3}$');

alter table public.payslips
  add column if not exists gross_amount bigint
    check (gross_amount is null or gross_amount >= 0);

alter table public.payslips
  add column if not exists net_amount bigint;

-- Backfill payslips from linked payroll_items
update public.payslips ps
set
  currency    = pi.currency,
  gross_amount = pi.gross_amount,
  net_amount  = pi.net_amount
from public.payroll_items pi
where ps.payroll_item_id = pi.id
  and ps.currency is null;

-- ══════════════════════════════════════════════════════════════════════
-- 8. Grants and RLS
-- ══════════════════════════════════════════════════════════════════════

-- Grants
grant select, insert, update, delete on table public.payroll_cycles to authenticated;
grant select, insert, update, delete on table public.payroll_cycle_items to authenticated;
grant select, insert, update, delete on table public.overtime_entries to authenticated;

-- Enable RLS
alter table public.payroll_cycles enable row level security;
alter table public.payroll_cycle_items enable row level security;
alter table public.overtime_entries enable row level security;

-- ── payroll_cycles RLS ──

drop policy if exists payroll_cycles_select_scope on public.payroll_cycles;
create policy payroll_cycles_select_scope
on public.payroll_cycles
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
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
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
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
    or public.has_role('SUPER_ADMIN')
  )
);

-- ── payroll_cycle_items RLS ──

drop policy if exists payroll_cycle_items_select_scope on public.payroll_cycle_items;
create policy payroll_cycle_items_select_scope
on public.payroll_cycle_items
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
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
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
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
    or public.has_role('SUPER_ADMIN')
  )
);

-- ── overtime_entries RLS ──

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
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists overtime_entries_insert_scope on public.overtime_entries;
create policy overtime_entries_insert_scope
on public.overtime_entries
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
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
    -- Employees can update own pending entries
    (employee_id = auth.uid() and status = 'pending')
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    -- Approving requires admin role
    (
      status in ('approved', 'rejected')
      and (
        public.has_role('HR_ADMIN')
        or public.has_role('FINANCE_ADMIN')
        or public.has_role('FINANCE_APPROVER')
        or public.has_role('SUPER_ADMIN')
      )
    )
    or
    -- Employees can edit own pending entries
    (
      status = 'pending'
      and employee_id = auth.uid()
    )
    or
    -- Admins can always edit
    (
      public.has_role('HR_ADMIN')
      or public.has_role('FINANCE_ADMIN')
      or public.has_role('SUPER_ADMIN')
    )
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
    or public.has_role('SUPER_ADMIN')
  )
);

-- ── Update payroll_runs SELECT to include FINANCE_APPROVER ──

drop policy if exists payroll_runs_select_scope on public.payroll_runs;
create policy payroll_runs_select_scope
on public.payroll_runs
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

-- ── Update payroll_items SELECT to include FINANCE_APPROVER ──

drop policy if exists payroll_items_select_scope on public.payroll_items;
create policy payroll_items_select_scope
on public.payroll_items
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

commit;
