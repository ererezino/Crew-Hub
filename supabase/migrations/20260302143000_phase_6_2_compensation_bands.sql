begin;

create table if not exists public.compensation_bands (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  title varchar(200) not null,
  level varchar(60),
  department varchar(100),
  location_type varchar(20) not null default 'global'
    check (location_type in ('global', 'country', 'city', 'zone')),
  location_value varchar(100),
  currency varchar(3) not null default 'USD',
  min_salary_amount bigint not null check (min_salary_amount >= 0),
  mid_salary_amount bigint not null check (mid_salary_amount >= 0),
  max_salary_amount bigint not null check (max_salary_amount >= 0),
  equity_min integer check (equity_min is null or equity_min >= 0),
  equity_max integer check (equity_max is null or equity_max >= 0),
  effective_from date not null,
  effective_to date,
  created_by uuid not null references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint compensation_bands_range_valid
    check (min_salary_amount <= mid_salary_amount and mid_salary_amount <= max_salary_amount),
  constraint compensation_bands_equity_valid
    check (equity_min is null or equity_max is null or equity_min <= equity_max),
  constraint compensation_bands_effective_window_valid
    check (effective_to is null or effective_to >= effective_from)
);

create index if not exists idx_comp_bands_org_effective
  on public.compensation_bands(org_id, effective_from desc);

create index if not exists idx_comp_bands_org_role
  on public.compensation_bands(org_id, title, level, department);

create index if not exists idx_comp_bands_org_location
  on public.compensation_bands(org_id, location_type, location_value);

create table if not exists public.benchmark_data (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  source varchar(100) not null,
  title varchar(200) not null,
  level varchar(60),
  location varchar(100),
  currency varchar(3) not null default 'USD',
  p25 bigint check (p25 is null or p25 >= 0),
  p50 bigint check (p50 is null or p50 >= 0),
  p75 bigint check (p75 is null or p75 >= 0),
  p90 bigint check (p90 is null or p90 >= 0),
  imported_by uuid references public.profiles(id),
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint benchmark_data_percentile_order_valid
    check (
      (p25 is null or p50 is null or p25 <= p50)
      and (p50 is null or p75 is null or p50 <= p75)
      and (p75 is null or p90 is null or p75 <= p90)
    )
);

create index if not exists idx_benchmark_org_role
  on public.benchmark_data(org_id, title, level, location);

create index if not exists idx_benchmark_org_imported
  on public.benchmark_data(org_id, imported_at desc);

create table if not exists public.compensation_band_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  band_id uuid not null references public.compensation_bands(id),
  employee_id uuid not null references public.profiles(id),
  assigned_by uuid not null references public.profiles(id),
  assigned_at timestamptz not null default now(),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint comp_band_assignments_effective_window_valid
    check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists uq_comp_band_assignments_employee_active
  on public.compensation_band_assignments(org_id, employee_id)
  where deleted_at is null and effective_to is null;

create index if not exists idx_comp_band_assignments_org_band
  on public.compensation_band_assignments(org_id, band_id, assigned_at desc);

create index if not exists idx_comp_band_assignments_org_employee
  on public.compensation_band_assignments(org_id, employee_id, assigned_at desc);

drop trigger if exists set_compensation_bands_updated_at on public.compensation_bands;
create trigger set_compensation_bands_updated_at
before update on public.compensation_bands
for each row
execute function public.set_updated_at();

drop trigger if exists set_benchmark_data_updated_at on public.benchmark_data;
create trigger set_benchmark_data_updated_at
before update on public.benchmark_data
for each row
execute function public.set_updated_at();

drop trigger if exists set_comp_band_assignments_updated_at on public.compensation_band_assignments;
create trigger set_comp_band_assignments_updated_at
before update on public.compensation_band_assignments
for each row
execute function public.set_updated_at();

grant select, insert, update on table public.compensation_bands to authenticated;
grant select, insert, update on table public.benchmark_data to authenticated;
grant select, insert, update on table public.compensation_band_assignments to authenticated;

alter table public.compensation_bands enable row level security;
alter table public.benchmark_data enable row level security;
alter table public.compensation_band_assignments enable row level security;

drop policy if exists comp_bands_select_org_comp_admin on public.compensation_bands;
create policy comp_bands_select_org_comp_admin
on public.compensation_bands
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

drop policy if exists comp_bands_insert_org_comp_admin on public.compensation_bands;
create policy comp_bands_insert_org_comp_admin
on public.compensation_bands
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and created_by = auth.uid()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists comp_bands_update_org_comp_admin on public.compensation_bands;
create policy comp_bands_update_org_comp_admin
on public.compensation_bands
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

drop policy if exists benchmark_select_org_comp_admin on public.benchmark_data;
create policy benchmark_select_org_comp_admin
on public.benchmark_data
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

drop policy if exists benchmark_insert_org_comp_admin on public.benchmark_data;
create policy benchmark_insert_org_comp_admin
on public.benchmark_data
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

drop policy if exists benchmark_update_org_comp_admin on public.benchmark_data;
create policy benchmark_update_org_comp_admin
on public.benchmark_data
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

drop policy if exists comp_band_assignments_select_org_comp_admin on public.compensation_band_assignments;
create policy comp_band_assignments_select_org_comp_admin
on public.compensation_band_assignments
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

drop policy if exists comp_band_assignments_insert_org_comp_admin on public.compensation_band_assignments;
create policy comp_band_assignments_insert_org_comp_admin
on public.compensation_band_assignments
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and assigned_by = auth.uid()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
  and exists (
    select 1
    from public.compensation_bands cb
    where cb.id = band_id
      and cb.org_id = public.get_user_org_id()
      and cb.deleted_at is null
  )
);

drop policy if exists comp_band_assignments_update_org_comp_admin on public.compensation_band_assignments;
create policy comp_band_assignments_update_org_comp_admin
on public.compensation_band_assignments
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

commit;
