begin;

create table if not exists public.navigation_access_config (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  nav_item_key varchar(100) not null,
  visible_to_roles text[] not null default '{EMPLOYEE,MANAGER,HR_ADMIN,FINANCE_ADMIN,TEAM_LEAD,SUPER_ADMIN}',
  granted_employee_ids uuid[] not null default '{}',
  revoked_employee_ids uuid[] not null default '{}',
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unique_navigation_access_config unique (org_id, nav_item_key)
);

create table if not exists public.dashboard_widget_config (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  widget_key varchar(100) not null,
  visible_to_roles text[] not null default '{EMPLOYEE,MANAGER,HR_ADMIN,FINANCE_ADMIN,TEAM_LEAD,SUPER_ADMIN}',
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unique_dashboard_widget_config unique (org_id, widget_key)
);

create index if not exists idx_navigation_access_config_org_key
  on public.navigation_access_config(org_id, nav_item_key);

create index if not exists idx_dashboard_widget_config_org_key
  on public.dashboard_widget_config(org_id, widget_key);

grant select, insert, update, delete on table public.navigation_access_config to authenticated;
grant select, insert, update, delete on table public.dashboard_widget_config to authenticated;

alter table public.navigation_access_config enable row level security;
alter table public.dashboard_widget_config enable row level security;

drop trigger if exists set_navigation_access_config_updated_at on public.navigation_access_config;
create trigger set_navigation_access_config_updated_at
before update on public.navigation_access_config
for each row
execute function public.set_updated_at();

drop trigger if exists set_dashboard_widget_config_updated_at on public.dashboard_widget_config;
create trigger set_dashboard_widget_config_updated_at
before update on public.dashboard_widget_config
for each row
execute function public.set_updated_at();

drop policy if exists navigation_access_config_select_org on public.navigation_access_config;
create policy navigation_access_config_select_org
on public.navigation_access_config
for select
to authenticated
using (
  org_id = public.get_user_org_id()
);

drop policy if exists navigation_access_config_manage_super_admin on public.navigation_access_config;
create policy navigation_access_config_manage_super_admin
on public.navigation_access_config
for all
to authenticated
using (
  org_id = public.get_user_org_id()
  and public.has_role('SUPER_ADMIN')
)
with check (
  org_id = public.get_user_org_id()
  and public.has_role('SUPER_ADMIN')
);

drop policy if exists dashboard_widget_config_select_org on public.dashboard_widget_config;
create policy dashboard_widget_config_select_org
on public.dashboard_widget_config
for select
to authenticated
using (
  org_id = public.get_user_org_id()
);

drop policy if exists dashboard_widget_config_manage_super_admin on public.dashboard_widget_config;
create policy dashboard_widget_config_manage_super_admin
on public.dashboard_widget_config
for all
to authenticated
using (
  org_id = public.get_user_org_id()
  and public.has_role('SUPER_ADMIN')
)
with check (
  org_id = public.get_user_org_id()
  and public.has_role('SUPER_ADMIN')
);

drop policy if exists shift_templates_select_team_lead on public.shift_templates;
create policy shift_templates_select_team_lead
on public.shift_templates
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(shift_templates.department))
  )
);

drop policy if exists shift_templates_insert_team_lead on public.shift_templates;
create policy shift_templates_insert_team_lead
on public.shift_templates
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(shift_templates.department))
  )
);

drop policy if exists shift_templates_update_team_lead on public.shift_templates;
create policy shift_templates_update_team_lead
on public.shift_templates
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(shift_templates.department))
  )
)
with check (
  org_id = public.get_user_org_id()
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(shift_templates.department))
  )
);

drop policy if exists shift_templates_delete_team_lead on public.shift_templates;
create policy shift_templates_delete_team_lead
on public.shift_templates
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(shift_templates.department))
  )
);

drop policy if exists schedules_select_team_lead on public.schedules;
create policy schedules_select_team_lead
on public.schedules
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(schedules.department))
  )
);

drop policy if exists schedules_insert_team_lead on public.schedules;
create policy schedules_insert_team_lead
on public.schedules
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(schedules.department))
  )
);

drop policy if exists schedules_update_team_lead on public.schedules;
create policy schedules_update_team_lead
on public.schedules
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(schedules.department))
  )
)
with check (
  org_id = public.get_user_org_id()
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(schedules.department))
  )
);

drop policy if exists schedules_delete_team_lead on public.schedules;
create policy schedules_delete_team_lead
on public.schedules
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(schedules.department))
  )
);

drop policy if exists shifts_select_team_lead on public.shifts;
create policy shifts_select_team_lead
on public.shifts
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    join public.schedules schedule_row
      on schedule_row.id = shifts.schedule_id
     and schedule_row.org_id = shifts.org_id
     and schedule_row.deleted_at is null
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(schedule_row.department))
  )
);

drop policy if exists shifts_insert_team_lead on public.shifts;
create policy shifts_insert_team_lead
on public.shifts
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    join public.schedules schedule_row
      on schedule_row.id = shifts.schedule_id
     and schedule_row.org_id = shifts.org_id
     and schedule_row.deleted_at is null
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(schedule_row.department))
  )
);

drop policy if exists shifts_update_team_lead on public.shifts;
create policy shifts_update_team_lead
on public.shifts
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    join public.schedules schedule_row
      on schedule_row.id = shifts.schedule_id
     and schedule_row.org_id = shifts.org_id
     and schedule_row.deleted_at is null
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(schedule_row.department))
  )
)
with check (
  org_id = public.get_user_org_id()
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    join public.schedules schedule_row
      on schedule_row.id = shifts.schedule_id
     and schedule_row.org_id = shifts.org_id
     and schedule_row.deleted_at is null
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(schedule_row.department))
  )
);

drop policy if exists shifts_delete_team_lead on public.shifts;
create policy shifts_delete_team_lead
on public.shifts
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    join public.schedules schedule_row
      on schedule_row.id = shifts.schedule_id
     and schedule_row.org_id = shifts.org_id
     and schedule_row.deleted_at is null
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(schedule_row.department))
  )
);

drop policy if exists shift_swaps_select_team_lead on public.shift_swaps;
create policy shift_swaps_select_team_lead
on public.shift_swaps
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    join public.shifts shift_row
      on shift_row.id = shift_swaps.shift_id
     and shift_row.org_id = shift_swaps.org_id
     and shift_row.deleted_at is null
    join public.schedules schedule_row
      on schedule_row.id = shift_row.schedule_id
     and schedule_row.org_id = shift_swaps.org_id
     and schedule_row.deleted_at is null
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(schedule_row.department))
  )
);

drop policy if exists shift_swaps_update_team_lead on public.shift_swaps;
create policy shift_swaps_update_team_lead
on public.shift_swaps
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    join public.shifts shift_row
      on shift_row.id = shift_swaps.shift_id
     and shift_row.org_id = shift_swaps.org_id
     and shift_row.deleted_at is null
    join public.schedules schedule_row
      on schedule_row.id = shift_row.schedule_id
     and schedule_row.org_id = shift_swaps.org_id
     and schedule_row.deleted_at is null
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(schedule_row.department))
  )
)
with check (
  org_id = public.get_user_org_id()
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    join public.shifts shift_row
      on shift_row.id = shift_swaps.shift_id
     and shift_row.org_id = shift_swaps.org_id
     and shift_row.deleted_at is null
    join public.schedules schedule_row
      on schedule_row.id = shift_row.schedule_id
     and schedule_row.org_id = shift_swaps.org_id
     and schedule_row.deleted_at is null
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(schedule_row.department))
  )
);

drop policy if exists shift_swaps_delete_team_lead on public.shift_swaps;
create policy shift_swaps_delete_team_lead
on public.shift_swaps
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    join public.shifts shift_row
      on shift_row.id = shift_swaps.shift_id
     and shift_row.org_id = shift_swaps.org_id
     and shift_row.deleted_at is null
    join public.schedules schedule_row
      on schedule_row.id = shift_row.schedule_id
     and schedule_row.org_id = shift_swaps.org_id
     and schedule_row.deleted_at is null
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(schedule_row.department))
  )
);

drop policy if exists time_entries_select_team_lead on public.time_entries;
create policy time_entries_select_team_lead
on public.time_entries
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    join public.profiles employee_profile
      on employee_profile.id = time_entries.employee_id
     and employee_profile.org_id = time_entries.org_id
     and employee_profile.deleted_at is null
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(employee_profile.department))
  )
);

drop policy if exists timesheets_select_team_lead on public.timesheets;
create policy timesheets_select_team_lead
on public.timesheets
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    join public.profiles employee_profile
      on employee_profile.id = timesheets.employee_id
     and employee_profile.org_id = timesheets.org_id
     and employee_profile.deleted_at is null
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(employee_profile.department))
  )
);

drop policy if exists timesheets_update_team_lead on public.timesheets;
create policy timesheets_update_team_lead
on public.timesheets
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    join public.profiles employee_profile
      on employee_profile.id = timesheets.employee_id
     and employee_profile.org_id = timesheets.org_id
     and employee_profile.deleted_at is null
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(employee_profile.department))
  )
)
with check (
  org_id = public.get_user_org_id()
  and public.has_role('TEAM_LEAD')
  and exists (
    select 1
    from public.profiles lead_profile
    join public.profiles employee_profile
      on employee_profile.id = timesheets.employee_id
     and employee_profile.org_id = timesheets.org_id
     and employee_profile.deleted_at is null
    where lead_profile.id = auth.uid()
      and lead_profile.org_id = public.get_user_org_id()
      and lead_profile.deleted_at is null
      and lead_profile.department is not null
      and lower(trim(lead_profile.department)) = lower(trim(employee_profile.department))
  )
);

commit;
