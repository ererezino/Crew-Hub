-- Comprehensive overhaul: expense extensions, vendor beneficiaries, profile extensions
begin;

-- ============================================================
-- 1. Add 'marketing' to expense_category_type enum
-- ============================================================
alter type public.expense_category_type add value if not exists 'marketing';

commit;

-- Must commit before using the new enum value in DML
begin;

-- ============================================================
-- 2. Expense table extensions
-- ============================================================

-- Expense type: personal reimbursement vs work expense
alter table public.expenses
  add column if not exists expense_type varchar(30) not null default 'personal_reimbursement';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'expenses_expense_type_check'
  ) then
    alter table public.expenses
      add constraint expenses_expense_type_check
      check (expense_type in ('personal_reimbursement', 'work_expense'));
  end if;
end;
$$;

-- Vendor fields (nullable — only required for work expenses, enforced at app level)
alter table public.expenses
  add column if not exists vendor_name text,
  add column if not exists vendor_bank_account_name text,
  add column if not exists vendor_bank_account_number text;

-- Custom category for "other"
alter table public.expenses
  add column if not exists custom_category text;

-- ============================================================
-- 3. Vendor beneficiaries table
-- ============================================================

create table if not exists public.vendor_beneficiaries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  employee_id uuid not null references public.profiles(id),
  vendor_name text not null check (char_length(trim(vendor_name)) > 0),
  bank_account_name text not null check (char_length(trim(bank_account_name)) > 0),
  bank_account_number text not null check (char_length(trim(bank_account_number)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_vendor_beneficiaries_employee
  on public.vendor_beneficiaries(employee_id);
create index if not exists idx_vendor_beneficiaries_org
  on public.vendor_beneficiaries(org_id);

-- Trigger to auto-update updated_at
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_vendor_beneficiaries_updated_at'
  ) then
    create trigger set_vendor_beneficiaries_updated_at
      before update on public.vendor_beneficiaries
      for each row
      execute function public.set_updated_at();
  end if;
end;
$$;

-- RLS policies
alter table public.vendor_beneficiaries enable row level security;
grant select, insert, update, delete on table public.vendor_beneficiaries to authenticated;

create policy vendor_beneficiaries_select on public.vendor_beneficiaries
  for select to authenticated
  using (
    org_id = public.get_user_org_id()
    and deleted_at is null
    and employee_id = auth.uid()
  );

create policy vendor_beneficiaries_insert on public.vendor_beneficiaries
  for insert to authenticated
  with check (
    org_id = public.get_user_org_id()
    and employee_id = auth.uid()
  );

create policy vendor_beneficiaries_update on public.vendor_beneficiaries
  for update to authenticated
  using (
    org_id = public.get_user_org_id()
    and deleted_at is null
    and employee_id = auth.uid()
  );

-- ============================================================
-- 4. Profile extensions
-- ============================================================

alter table public.profiles
  add column if not exists bio text,
  add column if not exists favorite_music text,
  add column if not exists favorite_books text,
  add column if not exists favorite_sports text,
  add column if not exists privacy_settings jsonb not null default '{}'::jsonb;

-- Length constraints
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_bio_length'
  ) then
    alter table public.profiles
      add constraint profiles_bio_length check (char_length(bio) <= 500);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_music_length'
  ) then
    alter table public.profiles
      add constraint profiles_music_length check (char_length(favorite_music) <= 200);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_books_length'
  ) then
    alter table public.profiles
      add constraint profiles_books_length check (char_length(favorite_books) <= 200);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_sports_length'
  ) then
    alter table public.profiles
      add constraint profiles_sports_length check (char_length(favorite_sports) <= 200);
  end if;
end;
$$;

commit;
