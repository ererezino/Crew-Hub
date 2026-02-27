begin;

create table if not exists public.onboarding_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  name varchar(200) not null,
  type varchar(20) not null default 'onboarding',
  country_code varchar(2),
  department varchar(100),
  tasks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint onboarding_templates_type_check
    check (type in ('onboarding', 'offboarding'))
);

create index if not exists idx_onboarding_templates_org_type
  on public.onboarding_templates(org_id, type, name);

create index if not exists idx_onboarding_templates_org_country_department
  on public.onboarding_templates(org_id, country_code, department);

create table if not exists public.onboarding_instances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  employee_id uuid not null references public.profiles(id),
  template_id uuid references public.onboarding_templates(id),
  type varchar(20) not null default 'onboarding',
  status varchar(20) not null default 'active',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint onboarding_instances_type_check
    check (type in ('onboarding', 'offboarding')),
  constraint onboarding_instances_status_check
    check (status in ('active', 'completed', 'cancelled'))
);

create index if not exists idx_onboarding_instances_org_status_started
  on public.onboarding_instances(org_id, status, started_at desc);

create index if not exists idx_onboarding_instances_employee
  on public.onboarding_instances(employee_id);

create index if not exists idx_onboarding_instances_template
  on public.onboarding_instances(template_id);

create table if not exists public.onboarding_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  instance_id uuid not null references public.onboarding_instances(id),
  title varchar(200) not null,
  description text,
  category varchar(50) not null,
  status varchar(20) not null default 'pending',
  assigned_to uuid references public.profiles(id),
  due_date date,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint onboarding_tasks_status_check
    check (status in ('pending', 'in_progress', 'completed', 'blocked'))
);

create index if not exists idx_onboarding_tasks_instance_category
  on public.onboarding_tasks(instance_id, category);

create index if not exists idx_onboarding_tasks_org_status_due
  on public.onboarding_tasks(org_id, status, due_date);

create index if not exists idx_onboarding_tasks_assigned_to
  on public.onboarding_tasks(assigned_to);

drop trigger if exists set_onboarding_templates_updated_at on public.onboarding_templates;
create trigger set_onboarding_templates_updated_at
before update on public.onboarding_templates
for each row
execute function public.set_updated_at();

drop trigger if exists set_onboarding_instances_updated_at on public.onboarding_instances;
create trigger set_onboarding_instances_updated_at
before update on public.onboarding_instances
for each row
execute function public.set_updated_at();

drop trigger if exists set_onboarding_tasks_updated_at on public.onboarding_tasks;
create trigger set_onboarding_tasks_updated_at
before update on public.onboarding_tasks
for each row
execute function public.set_updated_at();

grant select, insert, update on table public.onboarding_templates to authenticated;
grant select, insert, update on table public.onboarding_instances to authenticated;
grant select, insert, update on table public.onboarding_tasks to authenticated;

alter table public.onboarding_templates enable row level security;
alter table public.onboarding_instances enable row level security;
alter table public.onboarding_tasks enable row level security;

drop policy if exists onboarding_templates_select_scope on public.onboarding_templates;
create policy onboarding_templates_select_scope
on public.onboarding_templates
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or exists (
      select 1
      from public.onboarding_instances oi
      where oi.template_id = onboarding_templates.id
        and oi.org_id = public.get_user_org_id()
        and oi.deleted_at is null
        and oi.employee_id = auth.uid()
    )
    or exists (
      select 1
      from public.onboarding_instances oi
      join public.profiles report
        on report.id = oi.employee_id
      where oi.template_id = onboarding_templates.id
        and oi.org_id = public.get_user_org_id()
        and oi.deleted_at is null
        and report.org_id = public.get_user_org_id()
        and report.deleted_at is null
        and report.manager_id = auth.uid()
        and public.has_role('MANAGER')
    )
  )
);

drop policy if exists onboarding_templates_insert_admin on public.onboarding_templates;
create policy onboarding_templates_insert_admin
on public.onboarding_templates
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists onboarding_templates_update_admin on public.onboarding_templates;
create policy onboarding_templates_update_admin
on public.onboarding_templates
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

drop policy if exists onboarding_instances_select_scope on public.onboarding_instances;
create policy onboarding_instances_select_scope
on public.onboarding_instances
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or employee_id = auth.uid()
    or (
      public.has_role('MANAGER')
      and exists (
        select 1
        from public.profiles report
        where report.id = onboarding_instances.employee_id
          and report.org_id = public.get_user_org_id()
          and report.deleted_at is null
          and report.manager_id = auth.uid()
      )
    )
  )
);

drop policy if exists onboarding_instances_insert_admin on public.onboarding_instances;
create policy onboarding_instances_insert_admin
on public.onboarding_instances
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists onboarding_instances_update_admin on public.onboarding_instances;
create policy onboarding_instances_update_admin
on public.onboarding_instances
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

drop policy if exists onboarding_tasks_select_scope on public.onboarding_tasks;
create policy onboarding_tasks_select_scope
on public.onboarding_tasks
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and exists (
    select 1
    from public.onboarding_instances oi
    left join public.profiles report
      on report.id = oi.employee_id
    where oi.id = onboarding_tasks.instance_id
      and oi.org_id = public.get_user_org_id()
      and oi.deleted_at is null
      and (
        public.has_role('HR_ADMIN')
        or public.has_role('SUPER_ADMIN')
        or oi.employee_id = auth.uid()
        or (
          public.has_role('MANAGER')
          and report.org_id = public.get_user_org_id()
          and report.deleted_at is null
          and report.manager_id = auth.uid()
        )
      )
  )
);

drop policy if exists onboarding_tasks_insert_admin on public.onboarding_tasks;
create policy onboarding_tasks_insert_admin
on public.onboarding_tasks
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
  and exists (
    select 1
    from public.onboarding_instances oi
    where oi.id = onboarding_tasks.instance_id
      and oi.org_id = public.get_user_org_id()
      and oi.deleted_at is null
  )
);

drop policy if exists onboarding_tasks_update_admin on public.onboarding_tasks;
create policy onboarding_tasks_update_admin
on public.onboarding_tasks
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

drop policy if exists onboarding_tasks_update_employee_own on public.onboarding_tasks;
create policy onboarding_tasks_update_employee_own
on public.onboarding_tasks
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and assigned_to = auth.uid()
  and exists (
    select 1
    from public.onboarding_instances oi
    where oi.id = onboarding_tasks.instance_id
      and oi.org_id = public.get_user_org_id()
      and oi.deleted_at is null
      and oi.employee_id = auth.uid()
  )
)
with check (
  org_id = public.get_user_org_id()
  and assigned_to = auth.uid()
  and exists (
    select 1
    from public.onboarding_instances oi
    where oi.id = onboarding_tasks.instance_id
      and oi.org_id = public.get_user_org_id()
      and oi.deleted_at is null
      and oi.employee_id = auth.uid()
  )
);

commit;
