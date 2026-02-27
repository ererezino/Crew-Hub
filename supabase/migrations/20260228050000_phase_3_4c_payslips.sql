begin;

create table if not exists public.payslips (
  id uuid primary key default gen_random_uuid(),
  payroll_item_id uuid not null unique references public.payroll_items(id) on delete cascade,
  employee_id uuid not null references public.profiles(id),
  org_id uuid not null references public.orgs(id),
  pay_period varchar(7) not null check (pay_period ~ '^\d{4}-\d{2}$'),
  file_path text not null,
  generated_at timestamptz not null default now(),
  emailed_at timestamptz,
  viewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_payslips_org_employee_period
  on public.payslips(org_id, employee_id, pay_period desc);

create index if not exists idx_payslips_org_generated
  on public.payslips(org_id, generated_at desc);

create index if not exists idx_payslips_org_item
  on public.payslips(org_id, payroll_item_id);

drop trigger if exists set_payslips_updated_at on public.payslips;
create trigger set_payslips_updated_at
before update on public.payslips
for each row
execute function public.set_updated_at();

grant select, insert, update, delete on table public.payslips to authenticated;

alter table public.payslips enable row level security;

drop policy if exists payslips_select_scope on public.payslips;
create policy payslips_select_scope
on public.payslips
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
  )
);

drop policy if exists payslips_insert_scope on public.payslips;
create policy payslips_insert_scope
on public.payslips
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists payslips_update_scope on public.payslips;
create policy payslips_update_scope
on public.payslips
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    employee_id = auth.uid()
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    employee_id = auth.uid()
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists payslips_delete_scope on public.payslips;
create policy payslips_delete_scope
on public.payslips
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
