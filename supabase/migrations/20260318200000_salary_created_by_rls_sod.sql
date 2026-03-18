-- Phase 2b: Add created_by column and enforce separation of duties at the data layer.
-- The creator of a salary record must not be the same person who approves it.
-- This closes the bypass where an authenticated actor with direct Supabase access
-- could self-approve by skipping the API.

begin;

-- ── 1. Add created_by column ──
-- Defaults to auth.uid() so every new insert automatically records who created it.

alter table public.compensation_records
  add column if not exists created_by uuid references public.profiles(id)
    default auth.uid();

-- Backfill: set created_by from the existing approved_by where available,
-- otherwise leave null (legacy records with no audit trail).
-- For legacy records, separation of duties is not retroactively enforced
-- since they were created before the governance model existed.
update public.compensation_records
  set created_by = approved_by
  where created_by is null
    and approved_by is not null;

-- ── 2. Tighten INSERT policy: all new records must be pending, no pre-approved inserts ──

drop policy if exists compensation_records_insert_scope on public.compensation_records;
create policy compensation_records_insert_scope
on public.compensation_records
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  -- All new records must be created as pending.
  -- Approval is a separate UPDATE step with separation-of-duties enforcement.
  and salary_status = 'pending'
  and approved_by is null
  and approved_at is null
  -- created_by must be the inserting user (enforced by default, belt-and-suspenders)
  and created_by = auth.uid()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

-- ── 3. Tighten UPDATE policy: enforce creator ≠ approver at the database level ──

drop policy if exists compensation_records_update_admin on public.compensation_records;
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
    -- Path 1: Approving a pending record.
    -- Requires FINANCE_APPROVER or SUPER_ADMIN, and creator ≠ approver.
    (
      salary_status = 'approved'
      and approved_by = auth.uid()
      and approved_by is distinct from created_by
      and (
        public.has_role('FINANCE_APPROVER')
        or public.has_role('SUPER_ADMIN')
      )
    )
    or
    -- Path 2: Revoking an approved record back to pending.
    -- Requires FINANCE_APPROVER or SUPER_ADMIN.
    (
      salary_status = 'pending'
      and approved_by is null
      and (
        public.has_role('FINANCE_APPROVER')
        or public.has_role('SUPER_ADMIN')
      )
    )
    or
    -- Path 3: Editing non-approval fields on a pending record.
    -- Any admin role can edit, but salary_status must remain pending.
    (
      salary_status = 'pending'
      and approved_by is null
      and (
        public.has_role('HR_ADMIN')
        or public.has_role('FINANCE_ADMIN')
        or public.has_role('FINANCE_APPROVER')
        or public.has_role('SUPER_ADMIN')
      )
    )
  )
);

commit;
