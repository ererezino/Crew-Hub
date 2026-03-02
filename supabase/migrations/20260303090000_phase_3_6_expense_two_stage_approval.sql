begin;

alter type public.expense_status_type add value if not exists 'manager_approved';
alter type public.expense_status_type add value if not exists 'finance_rejected';

alter table public.expenses
  add column if not exists manager_approved_by uuid references public.profiles(id),
  add column if not exists manager_approved_at timestamptz,
  add column if not exists finance_approved_by uuid references public.profiles(id),
  add column if not exists finance_approved_at timestamptz,
  add column if not exists finance_rejected_by uuid references public.profiles(id),
  add column if not exists finance_rejected_at timestamptz,
  add column if not exists finance_rejection_reason text;

update public.expenses
set
  manager_approved_by = coalesce(manager_approved_by, approved_by),
  manager_approved_at = coalesce(manager_approved_at, approved_at)
where approved_by is not null
  and manager_approved_by is null;

update public.expenses
set
  finance_approved_by = coalesce(finance_approved_by, reimbursed_by),
  finance_approved_at = coalesce(finance_approved_at, reimbursed_at)
where reimbursed_by is not null
  and finance_approved_by is null;

update public.expenses
set status = 'manager_approved'
where status = 'approved';

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
    or (
      status = 'pending'
      and (
        public.has_role('SUPER_ADMIN')
        or (
          public.has_role('MANAGER')
          and employee_id <> auth.uid()
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
    or (
      status = 'manager_approved'
      and (
        public.has_role('FINANCE_ADMIN')
        or public.has_role('SUPER_ADMIN')
      )
    )
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    (
      employee_id = auth.uid()
      and status = 'cancelled'
    )
    or (
      status in ('manager_approved', 'rejected')
      and (
        public.has_role('SUPER_ADMIN')
        or (
          public.has_role('MANAGER')
          and employee_id <> auth.uid()
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
    or (
      status in ('reimbursed', 'finance_rejected')
      and (
        public.has_role('FINANCE_ADMIN')
        or public.has_role('SUPER_ADMIN')
      )
    )
  )
);

commit;
