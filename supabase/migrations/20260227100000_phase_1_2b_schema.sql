begin;

create extension if not exists pgcrypto;

create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name varchar(200) not null,
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id),
  org_id uuid not null references public.orgs(id),
  email varchar(255) not null,
  full_name varchar(200) not null,
  avatar_url text,
  roles text[] not null default '{EMPLOYEE}'::text[],
  department varchar(100),
  title varchar(200),
  country_code varchar(2),
  timezone varchar(50),
  phone varchar(30),
  start_date date,
  employment_type varchar(20) not null default 'contractor',
  payroll_mode varchar(50) not null default 'contractor_usd_no_withholding',
  primary_currency varchar(3) not null default 'USD',
  manager_id uuid references public.profiles(id),
  status varchar(20) not null default 'active',
  notification_preferences jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint profiles_employment_type_check
    check (employment_type in ('full_time', 'part_time', 'contractor')),
  constraint profiles_payroll_mode_check
    check (
      payroll_mode in (
        'contractor_usd_no_withholding',
        'employee_local_withholding',
        'employee_usd_withholding'
      )
    ),
  constraint profiles_status_check
    check (status in ('active', 'inactive', 'onboarding', 'offboarding'))
);

create index if not exists idx_profiles_org on public.profiles(org_id);
create index if not exists idx_profiles_manager on public.profiles(manager_id);
create index if not exists idx_profiles_department on public.profiles(org_id, department);
create index if not exists idx_profiles_country on public.profiles(org_id, country_code);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  actor_user_id uuid references auth.users(id),
  action varchar(50) not null,
  table_name varchar(100) not null,
  record_id uuid,
  old_value jsonb,
  new_value jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_org_created
  on public.audit_log(org_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_orgs_updated_at on public.orgs;
create trigger set_orgs_updated_at
before update on public.orgs
for each row
execute function public.set_updated_at();

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create or replace function public.get_user_roles()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select p.roles
      from public.profiles p
      where p.id = auth.uid()
        and p.deleted_at is null
      limit 1
    ),
    '{}'::text[]
  );
$$;

create or replace function public.has_role(role_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select role_name = any(public.get_user_roles());
$$;

create or replace function public.get_user_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select (
    select p.org_id
    from public.profiles p
    where p.id = auth.uid()
      and p.deleted_at is null
    limit 1
  );
$$;

grant select on table public.orgs to authenticated;
grant select, insert, update on table public.profiles to authenticated;
grant select, insert on table public.audit_log to authenticated;

alter table public.orgs enable row level security;
alter table public.profiles enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists orgs_select_own_org on public.orgs;
create policy orgs_select_own_org
on public.orgs
for select
to authenticated
using (id = public.get_user_org_id());

drop policy if exists profiles_select_employee_self on public.profiles;
create policy profiles_select_employee_self
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  and deleted_at is null
);

drop policy if exists profiles_select_manager_scope on public.profiles;
create policy profiles_select_manager_scope
on public.profiles
for select
to authenticated
using (
  public.has_role('MANAGER')
  and org_id = public.get_user_org_id()
  and deleted_at is null
  and (id = auth.uid() or manager_id = auth.uid())
);

drop policy if exists profiles_select_admin_scope on public.profiles;
create policy profiles_select_admin_scope
on public.profiles
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

drop policy if exists profiles_insert_admin_only on public.profiles;
create policy profiles_insert_admin_only
on public.profiles
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists profiles_update_admin_only on public.profiles;
create policy profiles_update_admin_only
on public.profiles
for update
to authenticated
using (
  org_id = public.get_user_org_id()
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

drop policy if exists audit_log_insert_authenticated_org on public.audit_log;
create policy audit_log_insert_authenticated_org
on public.audit_log
for insert
to authenticated
with check (
  auth.uid() is not null
  and org_id = public.get_user_org_id()
);

drop policy if exists audit_log_select_admin_org on public.audit_log;
create policy audit_log_select_admin_org
on public.audit_log
for select
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
