-- Phase 2: Salary approval groundwork
-- Adds salary_status lifecycle and approved_at timestamp to compensation_records.
-- Updates RLS policies to include FINANCE_APPROVER where appropriate.

begin;

-- ── 1. Add salary_status and approved_at columns ──

alter table public.compensation_records
  add column if not exists salary_status text not null default 'pending'
    constraint compensation_records_salary_status_check
      check (salary_status in ('pending', 'approved'));

alter table public.compensation_records
  add column if not exists approved_at timestamptz;

-- Backfill: any record that already has approved_by set is considered approved.
update public.compensation_records
  set salary_status = 'approved',
      approved_at = updated_at
  where approved_by is not null
    and salary_status = 'pending';

-- ── 2. Index for payroll calculation: only approved salaries feed into payroll ──

create index if not exists idx_compensation_records_salary_status
  on public.compensation_records(org_id, salary_status)
  where deleted_at is null and salary_status = 'approved';

-- ── 3. Update RLS policies to include FINANCE_APPROVER ──

-- SELECT: add FINANCE_APPROVER
drop policy if exists compensation_records_select_scope on public.compensation_records;
create policy compensation_records_select_scope
on public.compensation_records
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

-- INSERT: add FINANCE_APPROVER as creator (salary_status defaults to 'pending')
-- approved_by and salary_status='approved' require approval authority
drop policy if exists compensation_records_insert_scope on public.compensation_records;
create policy compensation_records_insert_scope
on public.compensation_records
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    -- If not pre-approved, anyone with manage rights can insert
    (salary_status = 'pending' and approved_by is null)
    or
    -- Pre-approved insert requires FINANCE_APPROVER or SUPER_ADMIN
    (
      salary_status = 'approved'
      and approved_by = auth.uid()
      and (
        public.has_role('FINANCE_APPROVER')
        or public.has_role('SUPER_ADMIN')
      )
    )
  )
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

-- UPDATE: allow FINANCE_APPROVER and SUPER_ADMIN (for approval transitions)
-- HR_ADMIN and FINANCE_ADMIN can update non-approval fields on pending records
drop policy if exists compensation_records_update_super_admin on public.compensation_records;
create policy compensation_records_update_admin
on public.compensation_records
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    -- Approving a record requires FINANCE_APPROVER or SUPER_ADMIN
    (
      salary_status = 'approved'
      and approved_by is not null
      and (
        public.has_role('FINANCE_APPROVER')
        or public.has_role('SUPER_ADMIN')
      )
    )
    or
    -- Non-approval edits on pending records
    (
      salary_status = 'pending'
      and (
        public.has_role('HR_ADMIN')
        or public.has_role('FINANCE_ADMIN')
        or public.has_role('FINANCE_APPROVER')
        or public.has_role('SUPER_ADMIN')
      )
    )
  )
);

-- DELETE: keep SUPER_ADMIN only (unchanged)

-- ── 4. Add FINANCE_APPROVER to equity_grants and allowances SELECT policies ──

drop policy if exists equity_grants_select_scope on public.equity_grants;
create policy equity_grants_select_scope
on public.equity_grants
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists allowances_select_scope on public.allowances;
create policy allowances_select_scope
on public.allowances
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

commit;
