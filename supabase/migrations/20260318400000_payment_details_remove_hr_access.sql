-- Phase 3: Remove HR_ADMIN access from employee_payment_details.
-- Payment details are a finance concern. HR should not have access to
-- bank account numbers, mobile money details, or payment destinations.
-- Add FINANCE_APPROVER to all policies (was missing from initial migration).

begin;

-- ── 1. SELECT: finance + self only ──

drop policy if exists employee_payment_details_select_scope on public.employee_payment_details;
create policy employee_payment_details_select_scope
on public.employee_payment_details
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    employee_id = auth.uid()
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

-- ── 2. INSERT: finance + self only ──

drop policy if exists employee_payment_details_insert_scope on public.employee_payment_details;
create policy employee_payment_details_insert_scope
on public.employee_payment_details
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    employee_id = auth.uid()
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

-- ── 3. UPDATE: finance + self only ──

drop policy if exists employee_payment_details_update_scope on public.employee_payment_details;
create policy employee_payment_details_update_scope
on public.employee_payment_details
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    employee_id = auth.uid()
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    employee_id = auth.uid()
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

commit;
