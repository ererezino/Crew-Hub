begin;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'payment_batch_status_type'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.payment_batch_status_type as enum (
      'processing',
      'completed',
      'failed',
      'cancelled'
    );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'payment_ledger_status_type'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.payment_ledger_status_type as enum (
      'processing',
      'completed',
      'failed',
      'cancelled'
    );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'payment_provider_type'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.payment_provider_type as enum ('mock', 'cashramp', 'wise');
  end if;
end;
$$;

create table if not exists public.payment_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  total_amount jsonb not null default '{}'::jsonb,
  payment_count int not null default 0 check (payment_count >= 0),
  status public.payment_batch_status_type not null default 'processing',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint payment_batches_total_amount_object_check
    check (jsonb_typeof(total_amount) = 'object')
);

create index if not exists idx_payment_batches_org_run
  on public.payment_batches(org_id, payroll_run_id, created_at desc);

create index if not exists idx_payment_batches_org_status
  on public.payment_batches(org_id, status, created_at desc);

create table if not exists public.payment_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  payroll_item_id uuid not null references public.payroll_items(id) on delete cascade,
  employee_id uuid not null references public.profiles(id),
  batch_id uuid not null references public.payment_batches(id) on delete cascade,
  amount bigint not null check (amount >= 0),
  currency varchar(3) not null check (currency ~ '^[A-Z]{3}$'),
  payment_method public.payment_method_type not null,
  provider public.payment_provider_type not null default 'mock',
  provider_reference varchar(160),
  idempotency_key varchar(255) not null unique,
  status public.payment_ledger_status_type not null default 'processing',
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint payment_ledger_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists idx_payment_ledger_org_batch
  on public.payment_ledger(org_id, batch_id, created_at desc);

create index if not exists idx_payment_ledger_org_status
  on public.payment_ledger(org_id, status, created_at desc);

create index if not exists idx_payment_ledger_org_item
  on public.payment_ledger(org_id, payroll_item_id);

create index if not exists idx_payment_ledger_org_employee
  on public.payment_ledger(org_id, employee_id, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payroll_items_payment_id_fkey'
      and conrelid = 'public.payroll_items'::regclass
  ) then
    alter table public.payroll_items
      add constraint payroll_items_payment_id_fkey
      foreign key (payment_id)
      references public.payment_ledger(id);
  end if;
end;
$$;

drop trigger if exists set_payment_batches_updated_at on public.payment_batches;
create trigger set_payment_batches_updated_at
before update on public.payment_batches
for each row
execute function public.set_updated_at();

drop trigger if exists set_payment_ledger_updated_at on public.payment_ledger;
create trigger set_payment_ledger_updated_at
before update on public.payment_ledger
for each row
execute function public.set_updated_at();

grant select, insert, update, delete on table public.payment_batches to authenticated;
grant select, insert, update, delete on table public.payment_ledger to authenticated;

alter table public.payment_batches enable row level security;
alter table public.payment_ledger enable row level security;

drop policy if exists payment_batches_select_scope on public.payment_batches;
create policy payment_batches_select_scope
on public.payment_batches
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

drop policy if exists payment_batches_insert_scope on public.payment_batches;
create policy payment_batches_insert_scope
on public.payment_batches
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
  and exists (
    select 1
    from public.payroll_runs run
    where run.id = payroll_run_id
      and run.org_id = public.get_user_org_id()
      and run.deleted_at is null
  )
);

drop policy if exists payment_batches_update_scope on public.payment_batches;
create policy payment_batches_update_scope
on public.payment_batches
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

drop policy if exists payment_batches_delete_scope on public.payment_batches;
create policy payment_batches_delete_scope
on public.payment_batches
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists payment_ledger_select_scope on public.payment_ledger;
create policy payment_ledger_select_scope
on public.payment_ledger
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

drop policy if exists payment_ledger_insert_scope on public.payment_ledger;
create policy payment_ledger_insert_scope
on public.payment_ledger
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
  and exists (
    select 1
    from public.payroll_items item
    where item.id = payroll_item_id
      and item.org_id = public.get_user_org_id()
      and item.deleted_at is null
  )
  and exists (
    select 1
    from public.payment_batches batch
    where batch.id = batch_id
      and batch.org_id = public.get_user_org_id()
      and batch.deleted_at is null
  )
  and exists (
    select 1
    from public.profiles profile
    where profile.id = employee_id
      and profile.org_id = public.get_user_org_id()
      and profile.deleted_at is null
  )
);

drop policy if exists payment_ledger_update_scope on public.payment_ledger;
create policy payment_ledger_update_scope
on public.payment_ledger
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

drop policy if exists payment_ledger_delete_scope on public.payment_ledger;
create policy payment_ledger_delete_scope
on public.payment_ledger
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
