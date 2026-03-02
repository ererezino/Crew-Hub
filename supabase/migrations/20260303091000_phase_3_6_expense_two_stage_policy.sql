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
