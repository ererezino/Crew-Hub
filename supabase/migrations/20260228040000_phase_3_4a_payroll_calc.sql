begin;

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  pay_period_start date not null,
  pay_period_end date not null,
  pay_date date not null,
  status varchar(30) not null default 'draft'
    check (
      status in (
        'draft',
        'calculated',
        'pending_first_approval',
        'pending_final_approval',
        'approved',
        'processing',
        'completed',
        'cancelled'
      )
    ),
  initiated_by uuid references public.profiles(id),
  first_approved_by uuid references public.profiles(id),
  first_approved_at timestamptz,
  final_approved_by uuid references public.profiles(id),
  final_approved_at timestamptz,
  total_gross jsonb not null default '{}'::jsonb,
  total_net jsonb not null default '{}'::jsonb,
  total_deductions jsonb not null default '{}'::jsonb,
  total_employer_contributions jsonb not null default '{}'::jsonb,
  employee_count int not null default 0 check (employee_count >= 0),
  snapshot jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint payroll_runs_period_window_check
    check (pay_period_end >= pay_period_start)
);

create index if not exists idx_payroll_runs_org_period
  on public.payroll_runs(org_id, pay_period_start desc, pay_period_end desc);

create index if not exists idx_payroll_runs_org_status
  on public.payroll_runs(org_id, status, created_at desc);

create table if not exists public.payroll_items (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.profiles(id),
  org_id uuid not null references public.orgs(id),
  gross_amount bigint not null default 0 check (gross_amount >= 0),
  currency varchar(3) not null check (currency ~ '^[A-Z]{3}$'),
  pay_currency varchar(3) not null check (pay_currency ~ '^[A-Z]{3}$'),
  base_salary_amount bigint not null default 0 check (base_salary_amount >= 0),
  allowances jsonb not null default '[]'::jsonb,
  adjustments jsonb not null default '[]'::jsonb,
  deductions jsonb not null default '[]'::jsonb,
  employer_contributions jsonb not null default '[]'::jsonb,
  net_amount bigint not null default 0,
  withholding_applied boolean not null default false,
  payment_status varchar(20) not null default 'pending'
    check (payment_status in ('pending', 'processing', 'paid', 'failed', 'cancelled')),
  payment_reference varchar(120),
  payment_id uuid,
  notes text,
  flagged boolean not null default false,
  flag_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint payroll_items_allowances_array_check check (jsonb_typeof(allowances) = 'array'),
  constraint payroll_items_adjustments_array_check check (jsonb_typeof(adjustments) = 'array'),
  constraint payroll_items_deductions_array_check check (jsonb_typeof(deductions) = 'array'),
  constraint payroll_items_employer_contributions_array_check
    check (jsonb_typeof(employer_contributions) = 'array'),
  constraint payroll_items_unique_employee_per_run
    unique (payroll_run_id, employee_id)
);

create index if not exists idx_payroll_items_org_run
  on public.payroll_items(org_id, payroll_run_id, employee_id);

create index if not exists idx_payroll_items_org_flagged
  on public.payroll_items(org_id, flagged, created_at desc);

create index if not exists idx_payroll_items_org_payment_status
  on public.payroll_items(org_id, payment_status);

drop trigger if exists set_payroll_runs_updated_at on public.payroll_runs;
create trigger set_payroll_runs_updated_at
before update on public.payroll_runs
for each row
execute function public.set_updated_at();

drop trigger if exists set_payroll_items_updated_at on public.payroll_items;
create trigger set_payroll_items_updated_at
before update on public.payroll_items
for each row
execute function public.set_updated_at();

grant select, insert, update, delete on table public.payroll_runs to authenticated;
grant select, insert, update, delete on table public.payroll_items to authenticated;

alter table public.payroll_runs enable row level security;
alter table public.payroll_items enable row level security;

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

drop policy if exists payroll_runs_delete_scope on public.payroll_runs;
create policy payroll_runs_delete_scope
on public.payroll_runs
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

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

drop policy if exists payroll_items_delete_scope on public.payroll_items;
create policy payroll_items_delete_scope
on public.payroll_items
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

commit;
