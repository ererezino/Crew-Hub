begin;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'expense_category_type'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.expense_category_type as enum (
      'travel',
      'lodging',
      'meals',
      'transport',
      'internet',
      'office_supplies',
      'software',
      'wellness',
      'other'
    );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'expense_status_type'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.expense_status_type as enum (
      'pending',
      'approved',
      'rejected',
      'reimbursed',
      'cancelled'
    );
  end if;
end;
$$;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  employee_id uuid not null references public.profiles(id),
  category public.expense_category_type not null,
  description text not null,
  amount bigint not null check (amount > 0),
  currency varchar(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  receipt_file_path text not null,
  expense_date date not null,
  status public.expense_status_type not null default 'pending',
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  rejected_by uuid references public.profiles(id),
  rejected_at timestamptz,
  rejection_reason text,
  reimbursed_by uuid references public.profiles(id),
  reimbursed_at timestamptz,
  reimbursement_reference varchar(120),
  reimbursement_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint expenses_description_check check (char_length(trim(description)) > 0),
  constraint expenses_expense_date_check check (expense_date >= date '2000-01-01')
);

create index if not exists idx_expenses_org_status_date
  on public.expenses(org_id, status, expense_date desc);

create index if not exists idx_expenses_org_category_date
  on public.expenses(org_id, category, expense_date desc);

create index if not exists idx_expenses_employee_date
  on public.expenses(employee_id, expense_date desc);

create index if not exists idx_expenses_org_created
  on public.expenses(org_id, created_at desc);

drop trigger if exists set_expenses_updated_at on public.expenses;
create trigger set_expenses_updated_at
before update on public.expenses
for each row
execute function public.set_updated_at();

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'receipts',
  'receipts',
  false,
  10485760,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg'
  ]::text[]
)
on conflict (id)
do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

grant select, insert, update, delete on table public.expenses to authenticated;

alter table public.expenses enable row level security;
alter table storage.objects enable row level security;

drop policy if exists expenses_select_scope on public.expenses;
create policy expenses_select_scope
on public.expenses
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
        where report.id = expenses.employee_id
          and report.org_id = public.get_user_org_id()
          and report.deleted_at is null
          and report.manager_id = auth.uid()
      )
    )
  )
);

drop policy if exists expenses_insert_scope on public.expenses;
create policy expenses_insert_scope
on public.expenses
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists expenses_update_scope on public.expenses;
create policy expenses_update_scope
on public.expenses
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    (
      employee_id = auth.uid()
      and status = 'pending'
    )
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or (
      public.has_role('MANAGER')
      and status = 'pending'
      and exists (
        select 1
        from public.profiles report
        where report.id = expenses.employee_id
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
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or (
      public.has_role('MANAGER')
      and exists (
        select 1
        from public.profiles report
        where report.id = expenses.employee_id
          and report.org_id = public.get_user_org_id()
          and report.deleted_at is null
          and report.manager_id = auth.uid()
      )
    )
  )
);

drop policy if exists expenses_delete_scope on public.expenses;
create policy expenses_delete_scope
on public.expenses
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

drop policy if exists receipts_bucket_select_scope on storage.objects;
create policy receipts_bucket_select_scope
on storage.objects
for select
to authenticated
using (
  bucket_id = 'receipts'
  and exists (
    select 1
    from public.expenses expense
    where expense.receipt_file_path = name
      and expense.org_id = public.get_user_org_id()
      and expense.deleted_at is null
      and (
        expense.employee_id = auth.uid()
        or public.has_role('HR_ADMIN')
        or public.has_role('FINANCE_ADMIN')
        or public.has_role('SUPER_ADMIN')
        or (
          public.has_role('MANAGER')
          and exists (
            select 1
            from public.profiles report
            where report.id = expense.employee_id
              and report.org_id = public.get_user_org_id()
              and report.deleted_at is null
              and report.manager_id = auth.uid()
          )
        )
      )
  )
);

drop policy if exists receipts_bucket_insert_org_prefix on storage.objects;
create policy receipts_bucket_insert_org_prefix
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'receipts'
  and position(public.get_user_org_id()::text || '/' in name) = 1
);

drop policy if exists receipts_bucket_update_org_prefix on storage.objects;
create policy receipts_bucket_update_org_prefix
on storage.objects
for update
to authenticated
using (
  bucket_id = 'receipts'
  and position(public.get_user_org_id()::text || '/' in name) = 1
)
with check (
  bucket_id = 'receipts'
  and position(public.get_user_org_id()::text || '/' in name) = 1
);

drop policy if exists receipts_bucket_delete_org_prefix on storage.objects;
create policy receipts_bucket_delete_org_prefix
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'receipts'
  and position(public.get_user_org_id()::text || '/' in name) = 1
);

commit;
