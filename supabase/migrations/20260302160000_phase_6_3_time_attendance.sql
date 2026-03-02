begin;

create table if not exists public.time_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  name varchar(200) not null,
  applies_to_departments text[],
  applies_to_types text[],
  country_code varchar(2),
  weekly_hours_target numeric(5, 2) not null default 40.00,
  daily_hours_max numeric(4, 2) not null default 12.00,
  overtime_after_daily numeric(4, 2),
  overtime_after_weekly numeric(5, 2),
  overtime_multiplier numeric(3, 2) not null default 1.50,
  double_time_after numeric(4, 2),
  double_time_multiplier numeric(3, 2) not null default 2.00,
  break_after_hours numeric(4, 2) not null default 6.00,
  break_duration_minutes int not null default 30,
  paid_break boolean not null default false,
  rounding_rule varchar(20) not null default 'nearest_15',
  require_geolocation boolean not null default false,
  allowed_locations jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint time_policies_name_check check (char_length(trim(name)) > 0),
  constraint time_policies_country_code_check check (
    country_code is null or country_code ~ '^[A-Z]{2}$'
  ),
  constraint time_policies_rounding_rule_check check (
    rounding_rule in ('none', 'nearest_5', 'nearest_15', 'nearest_30')
  ),
  constraint time_policies_weekly_hours_target_check check (weekly_hours_target > 0),
  constraint time_policies_daily_hours_max_check check (daily_hours_max > 0),
  constraint time_policies_overtime_multiplier_check check (overtime_multiplier >= 1),
  constraint time_policies_double_time_multiplier_check check (double_time_multiplier >= 1),
  constraint time_policies_break_duration_minutes_check check (break_duration_minutes >= 0)
);

create index if not exists idx_time_policies_org_active
  on public.time_policies(org_id, is_active)
  where deleted_at is null;

create index if not exists idx_time_policies_org_country
  on public.time_policies(org_id, country_code)
  where deleted_at is null;

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  employee_id uuid not null references public.profiles(id),
  policy_id uuid references public.time_policies(id),
  clock_in timestamptz not null,
  clock_out timestamptz,
  regular_minutes int not null default 0,
  overtime_minutes int not null default 0,
  double_time_minutes int not null default 0,
  break_minutes int not null default 0,
  total_minutes int not null default 0,
  breaks jsonb not null default '[]'::jsonb,
  clock_in_method varchar(20) not null default 'web',
  clock_out_method varchar(20),
  clock_in_location jsonb,
  clock_out_location jsonb,
  notes text,
  edited_by uuid references public.profiles(id),
  edit_reason text,
  original_clock_in timestamptz,
  original_clock_out timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint time_entries_clock_window_check check (
    clock_out is null or clock_out >= clock_in
  ),
  constraint time_entries_clock_in_method_check check (
    clock_in_method in ('web', 'mobile', 'kiosk', 'manual')
  ),
  constraint time_entries_clock_out_method_check check (
    clock_out_method is null or clock_out_method in ('web', 'mobile', 'kiosk', 'manual')
  ),
  constraint time_entries_regular_minutes_check check (regular_minutes >= 0),
  constraint time_entries_overtime_minutes_check check (overtime_minutes >= 0),
  constraint time_entries_double_time_minutes_check check (double_time_minutes >= 0),
  constraint time_entries_break_minutes_check check (break_minutes >= 0),
  constraint time_entries_total_minutes_check check (total_minutes >= 0)
);

create index if not exists idx_time_entries_org_employee_clock_in
  on public.time_entries(org_id, employee_id, clock_in desc)
  where deleted_at is null;

create index if not exists idx_time_entries_org_open_entries
  on public.time_entries(org_id, employee_id)
  where deleted_at is null and clock_out is null;

create table if not exists public.timesheets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  employee_id uuid not null references public.profiles(id),
  week_start date not null,
  week_end date not null,
  total_regular_minutes int not null default 0,
  total_overtime_minutes int not null default 0,
  total_double_time_minutes int not null default 0,
  total_break_minutes int not null default 0,
  total_worked_minutes int not null default 0,
  status varchar(20) not null default 'pending',
  submitted_at timestamptz,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint timesheets_status_check check (
    status in ('pending', 'submitted', 'approved', 'rejected', 'locked')
  ),
  constraint timesheets_week_window_check check (
    week_end >= week_start and week_end <= week_start + 6
  ),
  constraint timesheets_regular_minutes_check check (total_regular_minutes >= 0),
  constraint timesheets_overtime_minutes_check check (total_overtime_minutes >= 0),
  constraint timesheets_double_time_minutes_check check (total_double_time_minutes >= 0),
  constraint timesheets_break_minutes_check check (total_break_minutes >= 0),
  constraint timesheets_worked_minutes_check check (total_worked_minutes >= 0),
  constraint timesheets_approval_check check (
    (approved_at is null and approved_by is null)
    or (approved_at is not null and approved_by is not null)
  ),
  constraint unique_timesheet_per_week unique (org_id, employee_id, week_start)
);

create index if not exists idx_timesheets_org_employee_week
  on public.timesheets(org_id, employee_id, week_start desc)
  where deleted_at is null;

create index if not exists idx_timesheets_org_status
  on public.timesheets(org_id, status, week_start desc)
  where deleted_at is null;

drop trigger if exists set_time_policies_updated_at on public.time_policies;
create trigger set_time_policies_updated_at
before update on public.time_policies
for each row
execute function public.set_updated_at();

drop trigger if exists set_time_entries_updated_at on public.time_entries;
create trigger set_time_entries_updated_at
before update on public.time_entries
for each row
execute function public.set_updated_at();

drop trigger if exists set_timesheets_updated_at on public.timesheets;
create trigger set_timesheets_updated_at
before update on public.timesheets
for each row
execute function public.set_updated_at();

grant select, insert, update, delete on table public.time_policies to authenticated;
grant select, insert, update, delete on table public.time_entries to authenticated;
grant select, insert, update, delete on table public.timesheets to authenticated;

alter table public.time_policies enable row level security;
alter table public.time_entries enable row level security;
alter table public.timesheets enable row level security;

drop policy if exists time_policies_select_org on public.time_policies;
create policy time_policies_select_org
on public.time_policies
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
);

drop policy if exists time_policies_insert_admin on public.time_policies;
create policy time_policies_insert_admin
on public.time_policies
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists time_policies_update_admin on public.time_policies;
create policy time_policies_update_admin
on public.time_policies
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

drop policy if exists time_policies_delete_admin on public.time_policies;
create policy time_policies_delete_admin
on public.time_policies
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists time_entries_select_scope on public.time_entries;
create policy time_entries_select_scope
on public.time_entries
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
    or (
      public.has_role('MANAGER')
      and exists (
        select 1
        from public.profiles report
        where report.id = employee_id
          and report.org_id = public.get_user_org_id()
          and report.manager_id = auth.uid()
          and report.deleted_at is null
      )
    )
  )
);

drop policy if exists time_entries_insert_scope on public.time_entries;
create policy time_entries_insert_scope
on public.time_entries
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or (
      public.has_role('MANAGER')
      and exists (
        select 1
        from public.profiles report
        where report.id = employee_id
          and report.org_id = public.get_user_org_id()
          and report.manager_id = auth.uid()
          and report.deleted_at is null
      )
    )
  )
);

drop policy if exists time_entries_update_scope on public.time_entries;
create policy time_entries_update_scope
on public.time_entries
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or (
      public.has_role('MANAGER')
      and exists (
        select 1
        from public.profiles report
        where report.id = employee_id
          and report.org_id = public.get_user_org_id()
          and report.manager_id = auth.uid()
          and report.deleted_at is null
      )
    )
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or (
      public.has_role('MANAGER')
      and exists (
        select 1
        from public.profiles report
        where report.id = employee_id
          and report.org_id = public.get_user_org_id()
          and report.manager_id = auth.uid()
          and report.deleted_at is null
      )
    )
  )
);

drop policy if exists time_entries_delete_admin on public.time_entries;
create policy time_entries_delete_admin
on public.time_entries
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists timesheets_select_scope on public.timesheets;
create policy timesheets_select_scope
on public.timesheets
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
    or (
      public.has_role('MANAGER')
      and exists (
        select 1
        from public.profiles report
        where report.id = employee_id
          and report.org_id = public.get_user_org_id()
          and report.manager_id = auth.uid()
          and report.deleted_at is null
      )
    )
  )
);

drop policy if exists timesheets_insert_scope on public.timesheets;
create policy timesheets_insert_scope
on public.timesheets
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or (
      public.has_role('MANAGER')
      and exists (
        select 1
        from public.profiles report
        where report.id = employee_id
          and report.org_id = public.get_user_org_id()
          and report.manager_id = auth.uid()
          and report.deleted_at is null
      )
    )
  )
);

drop policy if exists timesheets_update_scope on public.timesheets;
create policy timesheets_update_scope
on public.timesheets
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or (
      public.has_role('MANAGER')
      and exists (
        select 1
        from public.profiles report
        where report.id = employee_id
          and report.org_id = public.get_user_org_id()
          and report.manager_id = auth.uid()
          and report.deleted_at is null
      )
    )
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or (
      public.has_role('MANAGER')
      and exists (
        select 1
        from public.profiles report
        where report.id = employee_id
          and report.org_id = public.get_user_org_id()
          and report.manager_id = auth.uid()
          and report.deleted_at is null
      )
    )
  )
);

drop policy if exists timesheets_delete_admin on public.timesheets;
create policy timesheets_delete_admin
on public.timesheets
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
