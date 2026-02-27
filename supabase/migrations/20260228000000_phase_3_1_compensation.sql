begin;

create table if not exists public.compensation_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  org_id uuid not null references public.orgs(id),
  base_salary_amount bigint not null check (base_salary_amount >= 0),
  currency varchar(3) not null,
  pay_frequency varchar(20) not null,
  employment_type varchar(20) not null,
  effective_from date not null,
  effective_to date,
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint compensation_records_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint compensation_records_pay_frequency_check
    check (pay_frequency in ('weekly', 'biweekly', 'monthly', 'quarterly', 'annual')),
  constraint compensation_records_employment_type_check
    check (employment_type in ('full_time', 'part_time', 'contractor')),
  constraint compensation_records_effective_window_check
    check (effective_to is null or effective_to >= effective_from)
);

create index if not exists idx_compensation_records_org_employee
  on public.compensation_records(org_id, employee_id, effective_from desc);

create index if not exists idx_compensation_records_org_currency
  on public.compensation_records(org_id, currency);

create table if not exists public.allowances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  org_id uuid not null references public.orgs(id),
  type varchar(30) not null,
  label varchar(200) not null,
  amount bigint not null check (amount >= 0),
  currency varchar(3) not null,
  is_taxable boolean not null default false,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint allowances_type_check
    check (type in ('housing', 'transport', 'communication', 'meal', 'internet', 'wellness', 'other')),
  constraint allowances_label_check check (char_length(trim(label)) > 0),
  constraint allowances_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint allowances_effective_window_check
    check (effective_to is null or effective_to >= effective_from)
);

create index if not exists idx_allowances_org_employee
  on public.allowances(org_id, employee_id, effective_from desc);

create index if not exists idx_allowances_org_type
  on public.allowances(org_id, type);

create table if not exists public.equity_grants (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  org_id uuid not null references public.orgs(id),
  grant_type varchar(10) not null,
  number_of_shares numeric(16, 4) not null check (number_of_shares > 0),
  exercise_price_cents bigint check (exercise_price_cents is null or exercise_price_cents >= 0),
  grant_date date not null,
  vesting_start_date date not null,
  cliff_months integer not null default 12 check (cliff_months >= 0),
  vesting_duration_months integer not null default 48 check (vesting_duration_months > 0),
  schedule varchar(20) not null default 'monthly',
  status varchar(20) not null default 'draft',
  approved_by uuid references public.profiles(id),
  board_approval_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint equity_grants_grant_type_check check (grant_type in ('ISO', 'NSO', 'RSU')),
  constraint equity_grants_schedule_check check (schedule = 'monthly'),
  constraint equity_grants_status_check
    check (status in ('draft', 'active', 'cancelled', 'vested', 'terminated')),
  constraint equity_grants_board_approval_check
    check (board_approval_date is null or board_approval_date >= grant_date)
);

create index if not exists idx_equity_grants_org_employee
  on public.equity_grants(org_id, employee_id, grant_date desc);

create index if not exists idx_equity_grants_org_status
  on public.equity_grants(org_id, status);

drop trigger if exists set_compensation_records_updated_at on public.compensation_records;
create trigger set_compensation_records_updated_at
before update on public.compensation_records
for each row
execute function public.set_updated_at();

drop trigger if exists set_allowances_updated_at on public.allowances;
create trigger set_allowances_updated_at
before update on public.allowances
for each row
execute function public.set_updated_at();

drop trigger if exists set_equity_grants_updated_at on public.equity_grants;
create trigger set_equity_grants_updated_at
before update on public.equity_grants
for each row
execute function public.set_updated_at();

grant select, insert, update, delete on table public.compensation_records to authenticated;
grant select, insert, update, delete on table public.allowances to authenticated;
grant select, insert, update, delete on table public.equity_grants to authenticated;

alter table public.compensation_records enable row level security;
alter table public.allowances enable row level security;
alter table public.equity_grants enable row level security;

drop policy if exists compensation_records_select_scope on public.compensation_records;
create policy compensation_records_select_scope
on public.compensation_records
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists compensation_records_insert_scope on public.compensation_records;
create policy compensation_records_insert_scope
on public.compensation_records
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    approved_by is null
    or (
      public.has_role('SUPER_ADMIN')
      and approved_by = auth.uid()
    )
  )
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists compensation_records_update_super_admin on public.compensation_records;
create policy compensation_records_update_super_admin
on public.compensation_records
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and public.has_role('SUPER_ADMIN')
)
with check (
  org_id = public.get_user_org_id()
  and public.has_role('SUPER_ADMIN')
);

drop policy if exists compensation_records_delete_super_admin on public.compensation_records;
create policy compensation_records_delete_super_admin
on public.compensation_records
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and public.has_role('SUPER_ADMIN')
);

drop policy if exists allowances_select_scope on public.allowances;
create policy allowances_select_scope
on public.allowances
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists allowances_insert_scope on public.allowances;
create policy allowances_insert_scope
on public.allowances
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists allowances_update_scope on public.allowances;
create policy allowances_update_scope
on public.allowances
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists allowances_delete_scope on public.allowances;
create policy allowances_delete_scope
on public.allowances
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists equity_grants_select_scope on public.equity_grants;
create policy equity_grants_select_scope
on public.equity_grants
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists equity_grants_insert_scope on public.equity_grants;
create policy equity_grants_insert_scope
on public.equity_grants
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    approved_by is null
    or (
      public.has_role('SUPER_ADMIN')
      and approved_by = auth.uid()
    )
  )
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists equity_grants_update_scope on public.equity_grants;
create policy equity_grants_update_scope
on public.equity_grants
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    approved_by is null
    or (
      public.has_role('SUPER_ADMIN')
      and approved_by = auth.uid()
    )
  )
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists equity_grants_delete_scope on public.equity_grants;
create policy equity_grants_delete_scope
on public.equity_grants
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

commit;
