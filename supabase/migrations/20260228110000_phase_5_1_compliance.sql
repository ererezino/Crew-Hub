begin;

create table if not exists public.compliance_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  country_code varchar(2) not null,
  authority varchar(150) not null,
  requirement varchar(200) not null,
  description text,
  cadence varchar(30) not null default 'monthly',
  category varchar(60) not null default 'tax',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint compliance_items_country_code_check check (country_code ~ '^[A-Z]{2}$'),
  constraint compliance_items_authority_check check (char_length(trim(authority)) > 0),
  constraint compliance_items_requirement_check check (char_length(trim(requirement)) > 0),
  constraint compliance_items_cadence_check
    check (cadence in ('monthly', 'quarterly', 'annual', 'ongoing', 'one_time'))
);

create unique index if not exists uq_compliance_items_org_country_requirement
  on public.compliance_items(org_id, country_code, authority, requirement)
  where deleted_at is null;

create index if not exists idx_compliance_items_org_country
  on public.compliance_items(org_id, country_code);

create index if not exists idx_compliance_items_org_category
  on public.compliance_items(org_id, category);

create table if not exists public.compliance_deadlines (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.compliance_items(id) on delete cascade,
  org_id uuid not null references public.orgs(id),
  due_date date not null,
  status varchar(20) not null default 'pending',
  assigned_to uuid references public.profiles(id),
  proof_document_id uuid references public.documents(id),
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint compliance_deadlines_status_check
    check (status in ('pending', 'in_progress', 'completed', 'overdue'))
);

create unique index if not exists uq_compliance_deadlines_item_due_date
  on public.compliance_deadlines(item_id, due_date)
  where deleted_at is null;

create index if not exists idx_compliance_deadlines_org_due_date
  on public.compliance_deadlines(org_id, due_date, status);

create index if not exists idx_compliance_deadlines_assigned
  on public.compliance_deadlines(assigned_to, due_date);

drop trigger if exists set_compliance_items_updated_at on public.compliance_items;
create trigger set_compliance_items_updated_at
before update on public.compliance_items
for each row
execute function public.set_updated_at();

drop trigger if exists set_compliance_deadlines_updated_at on public.compliance_deadlines;
create trigger set_compliance_deadlines_updated_at
before update on public.compliance_deadlines
for each row
execute function public.set_updated_at();

grant select, insert, update, delete on table public.compliance_items to authenticated;
grant select, insert, update, delete on table public.compliance_deadlines to authenticated;

alter table public.compliance_items enable row level security;
alter table public.compliance_deadlines enable row level security;

drop policy if exists compliance_items_select_scope on public.compliance_items;
create policy compliance_items_select_scope
on public.compliance_items
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

drop policy if exists compliance_items_insert_scope on public.compliance_items;
create policy compliance_items_insert_scope
on public.compliance_items
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

drop policy if exists compliance_items_update_scope on public.compliance_items;
create policy compliance_items_update_scope
on public.compliance_items
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

drop policy if exists compliance_items_delete_scope on public.compliance_items;
create policy compliance_items_delete_scope
on public.compliance_items
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

drop policy if exists compliance_deadlines_select_scope on public.compliance_deadlines;
create policy compliance_deadlines_select_scope
on public.compliance_deadlines
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or assigned_to = auth.uid()
  )
);

drop policy if exists compliance_deadlines_insert_scope on public.compliance_deadlines;
create policy compliance_deadlines_insert_scope
on public.compliance_deadlines
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and exists (
    select 1
    from public.compliance_items item
    where item.id = compliance_deadlines.item_id
      and item.org_id = public.get_user_org_id()
      and item.deleted_at is null
  )
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists compliance_deadlines_update_scope on public.compliance_deadlines;
create policy compliance_deadlines_update_scope
on public.compliance_deadlines
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or assigned_to = auth.uid()
  )
)
with check (
  org_id = public.get_user_org_id()
  and exists (
    select 1
    from public.compliance_items item
    where item.id = compliance_deadlines.item_id
      and item.org_id = public.get_user_org_id()
      and item.deleted_at is null
  )
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or assigned_to = auth.uid()
  )
);

drop policy if exists compliance_deadlines_delete_scope on public.compliance_deadlines;
create policy compliance_deadlines_delete_scope
on public.compliance_deadlines
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
