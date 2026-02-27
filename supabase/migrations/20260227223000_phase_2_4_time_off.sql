begin;

create table if not exists public.leave_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  country_code varchar(2) not null,
  leave_type varchar(50) not null,
  default_days_per_year numeric(6, 2) not null check (default_days_per_year >= 0),
  accrual_type varchar(30) not null default 'annual_upfront',
  carry_over boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint leave_policies_country_code_check check (country_code ~ '^[A-Z]{2}$'),
  constraint leave_policies_leave_type_check check (char_length(trim(leave_type)) > 0),
  constraint leave_policies_accrual_type_check
    check (accrual_type in ('annual_upfront', 'monthly', 'quarterly', 'manual')),
  constraint leave_policies_unique_org_country_type unique (org_id, country_code, leave_type)
);

create index if not exists idx_leave_policies_org_country
  on public.leave_policies(org_id, country_code);

create index if not exists idx_leave_policies_org_leave_type
  on public.leave_policies(org_id, leave_type);

create table if not exists public.leave_balances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  employee_id uuid not null references public.profiles(id),
  leave_type varchar(50) not null,
  year integer not null check (year between 2000 and 3000),
  total_days numeric(6, 2) not null default 0 check (total_days >= 0),
  used_days numeric(6, 2) not null default 0 check (used_days >= 0),
  pending_days numeric(6, 2) not null default 0 check (pending_days >= 0),
  carried_days numeric(6, 2) not null default 0 check (carried_days >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint leave_balances_leave_type_check check (char_length(trim(leave_type)) > 0),
  constraint leave_balances_unique_employee_type_year unique (employee_id, leave_type, year)
);

create index if not exists idx_leave_balances_org_employee
  on public.leave_balances(org_id, employee_id);

create index if not exists idx_leave_balances_org_year
  on public.leave_balances(org_id, year desc);

create index if not exists idx_leave_balances_org_leave_type
  on public.leave_balances(org_id, leave_type);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  employee_id uuid not null references public.profiles(id),
  leave_type varchar(50) not null,
  start_date date not null,
  end_date date not null,
  total_days numeric(6, 2) not null check (total_days > 0),
  status varchar(20) not null default 'pending',
  reason text not null default '',
  approver_id uuid references public.profiles(id),
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint leave_requests_leave_type_check check (char_length(trim(leave_type)) > 0),
  constraint leave_requests_status_check
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  constraint leave_requests_dates_check check (end_date >= start_date)
);

create index if not exists idx_leave_requests_org_status_start
  on public.leave_requests(org_id, status, start_date);

create index if not exists idx_leave_requests_employee
  on public.leave_requests(employee_id, created_at desc);

create index if not exists idx_leave_requests_approver
  on public.leave_requests(approver_id, created_at desc);

create index if not exists idx_leave_requests_org_date_range
  on public.leave_requests(org_id, start_date, end_date);

create table if not exists public.holiday_calendars (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  country_code varchar(2) not null,
  date date not null,
  name varchar(200) not null,
  year integer not null check (year between 2000 and 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint holiday_calendars_country_code_check check (country_code ~ '^[A-Z]{2}$'),
  constraint holiday_calendars_name_check check (char_length(trim(name)) > 0),
  constraint holiday_calendars_unique_org_country_date unique (org_id, country_code, date)
);

create index if not exists idx_holiday_calendars_org_country_year
  on public.holiday_calendars(org_id, country_code, year, date);

drop trigger if exists set_leave_policies_updated_at on public.leave_policies;
create trigger set_leave_policies_updated_at
before update on public.leave_policies
for each row
execute function public.set_updated_at();

drop trigger if exists set_leave_balances_updated_at on public.leave_balances;
create trigger set_leave_balances_updated_at
before update on public.leave_balances
for each row
execute function public.set_updated_at();

drop trigger if exists set_leave_requests_updated_at on public.leave_requests;
create trigger set_leave_requests_updated_at
before update on public.leave_requests
for each row
execute function public.set_updated_at();

drop trigger if exists set_holiday_calendars_updated_at on public.holiday_calendars;
create trigger set_holiday_calendars_updated_at
before update on public.holiday_calendars
for each row
execute function public.set_updated_at();

grant select, insert, update, delete on table public.leave_policies to authenticated;
grant select, insert, update, delete on table public.leave_balances to authenticated;
grant select, insert, update, delete on table public.leave_requests to authenticated;
grant select, insert, update, delete on table public.holiday_calendars to authenticated;

alter table public.leave_policies enable row level security;
alter table public.leave_balances enable row level security;
alter table public.leave_requests enable row level security;
alter table public.holiday_calendars enable row level security;

drop policy if exists leave_policies_select_org on public.leave_policies;
create policy leave_policies_select_org
on public.leave_policies
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
);

drop policy if exists leave_policies_insert_admin on public.leave_policies;
create policy leave_policies_insert_admin
on public.leave_policies
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists leave_policies_update_admin on public.leave_policies;
create policy leave_policies_update_admin
on public.leave_policies
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists leave_policies_delete_admin on public.leave_policies;
create policy leave_policies_delete_admin
on public.leave_policies
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists leave_balances_select_scope on public.leave_balances;
create policy leave_balances_select_scope
on public.leave_balances
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or (
      public.has_role('MANAGER')
      and exists (
        select 1
        from public.profiles report
        where report.id = leave_balances.employee_id
          and report.org_id = public.get_user_org_id()
          and report.deleted_at is null
          and report.manager_id = auth.uid()
      )
    )
  )
);

drop policy if exists leave_balances_insert_admin on public.leave_balances;
create policy leave_balances_insert_admin
on public.leave_balances
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists leave_balances_update_admin on public.leave_balances;
create policy leave_balances_update_admin
on public.leave_balances
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists leave_balances_delete_admin on public.leave_balances;
create policy leave_balances_delete_admin
on public.leave_balances
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists leave_requests_select_scope on public.leave_requests;
create policy leave_requests_select_scope
on public.leave_requests
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or (
      public.has_role('MANAGER')
      and exists (
        select 1
        from public.profiles report
        where report.id = leave_requests.employee_id
          and report.org_id = public.get_user_org_id()
          and report.deleted_at is null
          and report.manager_id = auth.uid()
      )
    )
  )
);

drop policy if exists leave_requests_insert_scope on public.leave_requests;
create policy leave_requests_insert_scope
on public.leave_requests
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    (
      employee_id = auth.uid()
      and status = 'pending'
    )
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists leave_requests_update_scope on public.leave_requests;
create policy leave_requests_update_scope
on public.leave_requests
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or (
      public.has_role('MANAGER')
      and exists (
        select 1
        from public.profiles report
        where report.id = leave_requests.employee_id
          and report.org_id = public.get_user_org_id()
          and report.deleted_at is null
          and report.manager_id = auth.uid()
      )
    )
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or (
      employee_id = auth.uid()
      and status in ('pending', 'cancelled')
    )
    or (
      public.has_role('MANAGER')
      and status in ('approved', 'rejected')
      and exists (
        select 1
        from public.profiles report
        where report.id = leave_requests.employee_id
          and report.org_id = public.get_user_org_id()
          and report.deleted_at is null
          and report.manager_id = auth.uid()
      )
    )
  )
);

drop policy if exists leave_requests_delete_scope on public.leave_requests;
create policy leave_requests_delete_scope
on public.leave_requests
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    (
      employee_id = auth.uid()
      and status in ('pending', 'cancelled')
    )
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists holiday_calendars_select_org on public.holiday_calendars;
create policy holiday_calendars_select_org
on public.holiday_calendars
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
);

drop policy if exists holiday_calendars_insert_admin on public.holiday_calendars;
create policy holiday_calendars_insert_admin
on public.holiday_calendars
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists holiday_calendars_update_admin on public.holiday_calendars;
create policy holiday_calendars_update_admin
on public.holiday_calendars
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists holiday_calendars_delete_admin on public.holiday_calendars;
create policy holiday_calendars_delete_admin
on public.holiday_calendars
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

commit;
