begin;

create table if not exists public.shift_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  name varchar(200) not null,
  department varchar(100),
  start_time time not null,
  end_time time not null,
  break_minutes int not null default 0,
  color varchar(7),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint shift_templates_name_check check (char_length(trim(name)) > 0),
  constraint shift_templates_break_minutes_check check (break_minutes >= 0),
  constraint shift_templates_time_window_check check (end_time > start_time),
  constraint shift_templates_color_check check (
    color is null or color ~ '^#[0-9A-Fa-f]{6}$'
  )
);

create index if not exists idx_shift_templates_org_department
  on public.shift_templates(org_id, department)
  where deleted_at is null;

create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  name varchar(200),
  department varchar(100),
  week_start date not null,
  week_end date not null,
  status varchar(20) not null default 'draft',
  published_at timestamptz,
  published_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint schedules_status_check check (status in ('draft', 'published', 'locked')),
  constraint schedules_week_window_check check (
    week_end >= week_start and week_end <= week_start + 6
  ),
  constraint schedules_publish_actor_check check (
    (published_at is null and published_by is null)
    or (published_at is not null and published_by is not null)
  )
);

create index if not exists idx_schedules_org_week
  on public.schedules(org_id, week_start desc)
  where deleted_at is null;

create index if not exists idx_schedules_org_status
  on public.schedules(org_id, status, week_start desc)
  where deleted_at is null;

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  template_id uuid references public.shift_templates(id),
  employee_id uuid references public.profiles(id),
  shift_date date not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  break_minutes int not null default 0,
  status varchar(20) not null default 'scheduled',
  notes text,
  color varchar(7),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint shifts_time_window_check check (end_time > start_time),
  constraint shifts_status_check check (
    status in ('scheduled', 'swap_requested', 'swapped', 'cancelled')
  ),
  constraint shifts_break_minutes_check check (break_minutes >= 0),
  constraint shifts_color_check check (
    color is null or color ~ '^#[0-9A-Fa-f]{6}$'
  )
);

create index if not exists idx_shifts_schedule
  on public.shifts(schedule_id)
  where deleted_at is null;

create index if not exists idx_shifts_employee_date
  on public.shifts(employee_id, shift_date)
  where deleted_at is null;

create index if not exists idx_shifts_open
  on public.shifts(org_id, shift_date)
  where employee_id is null and deleted_at is null;

create table if not exists public.shift_swaps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  requester_id uuid not null references public.profiles(id),
  target_id uuid references public.profiles(id),
  reason text,
  status varchar(20) not null default 'pending',
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint shift_swaps_status_check check (
    status in ('pending', 'accepted', 'rejected', 'cancelled')
  ),
  constraint shift_swaps_approval_check check (
    (approved_at is null and approved_by is null)
    or (approved_at is not null and approved_by is not null)
  )
);

create index if not exists idx_shift_swaps_org_status
  on public.shift_swaps(org_id, status, created_at desc)
  where deleted_at is null;

create index if not exists idx_shift_swaps_shift
  on public.shift_swaps(shift_id)
  where deleted_at is null;

drop trigger if exists set_shift_templates_updated_at on public.shift_templates;
create trigger set_shift_templates_updated_at
before update on public.shift_templates
for each row
execute function public.set_updated_at();

drop trigger if exists set_schedules_updated_at on public.schedules;
create trigger set_schedules_updated_at
before update on public.schedules
for each row
execute function public.set_updated_at();

drop trigger if exists set_shifts_updated_at on public.shifts;
create trigger set_shifts_updated_at
before update on public.shifts
for each row
execute function public.set_updated_at();

drop trigger if exists set_shift_swaps_updated_at on public.shift_swaps;
create trigger set_shift_swaps_updated_at
before update on public.shift_swaps
for each row
execute function public.set_updated_at();

grant select, insert, update, delete on table public.shift_templates to authenticated;
grant select, insert, update, delete on table public.schedules to authenticated;
grant select, insert, update, delete on table public.shifts to authenticated;
grant select, insert, update, delete on table public.shift_swaps to authenticated;

alter table public.shift_templates enable row level security;
alter table public.schedules enable row level security;
alter table public.shifts enable row level security;
alter table public.shift_swaps enable row level security;

drop policy if exists shift_templates_select_org on public.shift_templates;
create policy shift_templates_select_org
on public.shift_templates
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
);

drop policy if exists shift_templates_insert_manager on public.shift_templates;
create policy shift_templates_insert_manager
on public.shift_templates
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('MANAGER')
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists shift_templates_update_manager on public.shift_templates;
create policy shift_templates_update_manager
on public.shift_templates
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('MANAGER')
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('MANAGER')
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists shift_templates_delete_manager on public.shift_templates;
create policy shift_templates_delete_manager
on public.shift_templates
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('MANAGER')
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists schedules_select_scope on public.schedules;
create policy schedules_select_scope
on public.schedules
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    status = 'published'
    or public.has_role('MANAGER')
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or exists (
      select 1
      from public.shifts shift_row
      where shift_row.schedule_id = schedules.id
        and shift_row.org_id = public.get_user_org_id()
        and shift_row.employee_id = auth.uid()
        and shift_row.deleted_at is null
    )
  )
);

drop policy if exists schedules_insert_manager on public.schedules;
create policy schedules_insert_manager
on public.schedules
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('MANAGER')
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists schedules_update_manager on public.schedules;
create policy schedules_update_manager
on public.schedules
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('MANAGER')
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('MANAGER')
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists schedules_delete_manager on public.schedules;
create policy schedules_delete_manager
on public.schedules
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('MANAGER')
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists shifts_select_scope on public.shifts;
create policy shifts_select_scope
on public.shifts
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    employee_id = auth.uid()
    or employee_id is null
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or (
      public.has_role('MANAGER')
      and (
        employee_id is null
        or employee_id = auth.uid()
        or exists (
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
);

drop policy if exists shifts_insert_manager on public.shifts;
create policy shifts_insert_manager
on public.shifts
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('MANAGER')
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists shifts_update_manager on public.shifts;
create policy shifts_update_manager
on public.shifts
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('MANAGER')
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('MANAGER')
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists shifts_delete_manager on public.shifts;
create policy shifts_delete_manager
on public.shifts
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('MANAGER')
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists shift_swaps_select_scope on public.shift_swaps;
create policy shift_swaps_select_scope
on public.shift_swaps
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    requester_id = auth.uid()
    or target_id = auth.uid()
    or public.has_role('MANAGER')
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists shift_swaps_insert_scope on public.shift_swaps;
create policy shift_swaps_insert_scope
on public.shift_swaps
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and requester_id = auth.uid()
);

drop policy if exists shift_swaps_update_scope on public.shift_swaps;
create policy shift_swaps_update_scope
on public.shift_swaps
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    requester_id = auth.uid()
    or target_id = auth.uid()
    or public.has_role('MANAGER')
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    requester_id = auth.uid()
    or target_id = auth.uid()
    or public.has_role('MANAGER')
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists shift_swaps_delete_scope on public.shift_swaps;
create policy shift_swaps_delete_scope
on public.shift_swaps
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    requester_id = auth.uid()
    or public.has_role('MANAGER')
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

commit;
