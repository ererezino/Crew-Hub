begin;

-- =============================================================================
-- Phase 1: Org Structure + Delegation Model
--
-- Adds:
--   1. profiles.team_lead_id  — operational team/sub-team lead (separate from manager_id)
--   2. approval_delegates     — backup approval coverage (deputy, co-founder, temporary)
--   3. function_owners        — executive/function ownership of departments
--   4. Audit fields on leave_requests and schedules for delegation tracking
--   5. is_principal_unavailable() helper function
--
-- Phase 1 expense behavior: existing 2-stage flow unchanged.
-- Manager-stage approver resolves via team_lead_id ?? manager_id with delegation backup.
-- Department-specific expense routing is explicitly Phase 2.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles.team_lead_id
-- ---------------------------------------------------------------------------
-- Lightweight phase-1 model for operational ownership.
-- May later evolve into explicit team/sub-team entities (teams table).
-- When NULL, manager_id is used for operational purposes (schedules, leave).

alter table public.profiles
  add column if not exists team_lead_id uuid references public.profiles(id);

comment on column public.profiles.team_lead_id is
  'Operational team/sub-team lead. Governs schedules and leave approval. Falls back to manager_id when NULL.';

create index if not exists idx_profiles_team_lead
  on public.profiles(team_lead_id)
  where team_lead_id is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2. approval_delegates
-- ---------------------------------------------------------------------------

create table if not exists public.approval_delegates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),

  -- who is being covered
  principal_id uuid not null references public.profiles(id),

  -- who can act as backup
  delegate_id uuid not null references public.profiles(id),

  -- what type of delegation
  delegate_type text not null
    check (delegate_type in ('deputy_team_lead', 'cofounder_coverage', 'temporary')),

  -- what the delegate can cover
  scope text[] not null default '{leave,expense,schedule}',

  -- when (for temporary delegations; NULL = standing/permanent)
  starts_at date,
  ends_at date,

  -- activation condition
  activation text not null default 'when_unavailable'
    check (activation in ('when_unavailable', 'always')),

  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- prevent duplicate delegate assignments
  unique (org_id, principal_id, delegate_id, delegate_type),

  -- prevent self-delegation
  check (principal_id != delegate_id)
);

create index if not exists idx_approval_delegates_delegate_active
  on public.approval_delegates(org_id, delegate_id)
  where is_active = true;

create index if not exists idx_approval_delegates_principal_active
  on public.approval_delegates(org_id, principal_id)
  where is_active = true;

drop trigger if exists set_approval_delegates_updated_at on public.approval_delegates;
create trigger set_approval_delegates_updated_at
before update on public.approval_delegates
for each row
execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. function_owners
-- ---------------------------------------------------------------------------

create table if not exists public.function_owners (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),

  -- what function/department
  department text not null,

  -- who owns it
  owner_id uuid not null references public.profiles(id),

  -- what kind of ownership
  ownership_type text not null
    check (ownership_type in ('executive', 'operational_lead', 'leadership_visibility')),

  -- future-proofing: scoped visibility granularity
  visibility_scope text[] not null default '{team,leave,expenses}',

  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (org_id, department, owner_id, ownership_type)
);

create index if not exists idx_function_owners_owner_active
  on public.function_owners(org_id, owner_id)
  where is_active = true;

create index if not exists idx_function_owners_department_active
  on public.function_owners(org_id, department)
  where is_active = true;

drop trigger if exists set_function_owners_updated_at on public.function_owners;
create trigger set_function_owners_updated_at
before update on public.function_owners
for each row
execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Delegation audit fields
-- ---------------------------------------------------------------------------

-- Leave requests: track when approval was delegated
alter table public.leave_requests
  add column if not exists acting_for uuid references public.profiles(id),
  add column if not exists delegate_type text;

comment on column public.leave_requests.acting_for is
  'If approved by a delegate, the principal they acted on behalf of. NULL = direct approval.';
comment on column public.leave_requests.delegate_type is
  'Type of delegation used (deputy_team_lead, cofounder_coverage, temporary). NULL = direct approval.';

-- Schedules: track when publishing was delegated
alter table public.schedules
  add column if not exists published_acting_for uuid references public.profiles(id),
  add column if not exists published_delegate_type text;

comment on column public.schedules.published_acting_for is
  'If published by a delegate, the principal they acted on behalf of.';

-- Expenses: track delegation on manager-stage approval
alter table public.expenses
  add column if not exists manager_acting_for uuid references public.profiles(id),
  add column if not exists manager_delegate_type text;

comment on column public.expenses.manager_acting_for is
  'If manager-stage was approved by a delegate, the principal they acted on behalf of.';

-- ---------------------------------------------------------------------------
-- 5. is_principal_unavailable() — SQL helper
-- ---------------------------------------------------------------------------

create or replace function public.is_principal_unavailable(
  p_principal_id uuid,
  p_org_id uuid,
  p_check_date date default current_date
)
returns boolean
language plpgsql
stable
security definer
as $$
begin
  -- Check 1: on approved leave covering the check date
  if exists (
    select 1
    from public.leave_requests
    where employee_id = p_principal_id
      and org_id = p_org_id
      and status = 'approved'
      and start_date <= p_check_date
      and end_date >= p_check_date
      and deleted_at is null
  ) then
    return true;
  end if;

  -- Check 2: manually marked as out-of-office
  if exists (
    select 1
    from public.profiles
    where id = p_principal_id
      and org_id = p_org_id
      and availability_status = 'ooo'
      and deleted_at is null
  ) then
    return true;
  end if;

  return false;
end;
$$;

comment on function public.is_principal_unavailable is
  'Returns true if the principal is on approved leave today or marked OOO. Used by delegation logic.';

-- ---------------------------------------------------------------------------
-- 6. RLS policies
-- ---------------------------------------------------------------------------

-- Grant access
grant select, insert, update on table public.approval_delegates to authenticated;
grant select, insert, update on table public.function_owners to authenticated;

-- approval_delegates RLS
alter table public.approval_delegates enable row level security;

drop policy if exists approval_delegates_select_scope on public.approval_delegates;
create policy approval_delegates_select_scope
on public.approval_delegates
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    principal_id = auth.uid()
    or delegate_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists approval_delegates_insert_admin on public.approval_delegates;
create policy approval_delegates_insert_admin
on public.approval_delegates
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists approval_delegates_update_admin on public.approval_delegates;
create policy approval_delegates_update_admin
on public.approval_delegates
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

-- function_owners RLS
alter table public.function_owners enable row level security;

drop policy if exists function_owners_select_scope on public.function_owners;
create policy function_owners_select_scope
on public.function_owners
for select
to authenticated
using (
  org_id = public.get_user_org_id()
);

drop policy if exists function_owners_insert_admin on public.function_owners;
create policy function_owners_insert_admin
on public.function_owners
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists function_owners_update_admin on public.function_owners;
create policy function_owners_update_admin
on public.function_owners
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

-- ---------------------------------------------------------------------------
-- 7. Update leave RPC functions to support delegation audit fields
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION approve_leave_request(
  p_request_id UUID,
  p_approver_id UUID,
  p_acting_for UUID DEFAULT NULL,
  p_delegate_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_request RECORD;
  v_total_days NUMERIC;
  v_year INT;
  v_is_unlimited BOOLEAN;
BEGIN
  SELECT *
  INTO v_request
  FROM leave_requests
  WHERE id = p_request_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Leave request not found.');
  END IF;

  IF v_request.status != 'pending' THEN
    RETURN jsonb_build_object('error', 'Only pending requests can be approved. Current status: ' || v_request.status);
  END IF;

  v_total_days := COALESCE(v_request.total_days, 0);
  v_year := EXTRACT(YEAR FROM v_request.start_date)::INT;
  v_is_unlimited := v_request.leave_type IN ('sick_leave', 'bereavement', 'compassionate');

  UPDATE leave_requests
  SET status = 'approved',
      approver_id = p_approver_id,
      acting_for = p_acting_for,
      delegate_type = p_delegate_type,
      rejection_reason = NULL,
      updated_at = NOW()
  WHERE id = p_request_id;

  IF NOT v_is_unlimited AND v_total_days > 0 THEN
    UPDATE leave_balances
    SET used_days = used_days + v_total_days,
        pending_days = GREATEST(pending_days - v_total_days, 0),
        updated_at = NOW()
    WHERE employee_id = v_request.employee_id
      AND leave_type = v_request.leave_type
      AND year = v_year
      AND org_id = v_request.org_id;

    IF NOT FOUND THEN
      INSERT INTO leave_balances (org_id, employee_id, leave_type, year, allocated_days, used_days, pending_days)
      VALUES (v_request.org_id, v_request.employee_id, v_request.leave_type, v_year, 0, v_total_days, 0)
      ON CONFLICT (org_id, employee_id, leave_type, year) DO UPDATE
      SET used_days = leave_balances.used_days + v_total_days,
          pending_days = GREATEST(leave_balances.pending_days - v_total_days, 0),
          updated_at = NOW();
    END IF;
  END IF;

  INSERT INTO audit_log (org_id, actor_user_id, action, table_name, record_id, old_value, new_value)
  VALUES (
    v_request.org_id,
    p_approver_id,
    'approve',
    'leave_requests',
    p_request_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', 'approved', 'acting_for', p_acting_for, 'delegate_type', p_delegate_type)
  );

  RETURN (
    SELECT to_jsonb(r)
    FROM (
      SELECT id, org_id, employee_id, leave_type, start_date, end_date,
             total_days, status, reason, approver_id, acting_for, delegate_type,
             rejection_reason, created_at, updated_at
      FROM leave_requests
      WHERE id = p_request_id
    ) r
  );
END;
$$;

CREATE OR REPLACE FUNCTION reject_leave_request(
  p_request_id UUID,
  p_approver_id UUID,
  p_reason TEXT,
  p_acting_for UUID DEFAULT NULL,
  p_delegate_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_request RECORD;
  v_total_days NUMERIC;
  v_year INT;
  v_is_unlimited BOOLEAN;
BEGIN
  SELECT *
  INTO v_request
  FROM leave_requests
  WHERE id = p_request_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Leave request not found.');
  END IF;

  IF v_request.status != 'pending' THEN
    RETURN jsonb_build_object('error', 'Only pending requests can be rejected. Current status: ' || v_request.status);
  END IF;

  v_total_days := COALESCE(v_request.total_days, 0);
  v_year := EXTRACT(YEAR FROM v_request.start_date)::INT;
  v_is_unlimited := v_request.leave_type IN ('sick_leave', 'bereavement', 'compassionate');

  UPDATE leave_requests
  SET status = 'rejected',
      approver_id = p_approver_id,
      acting_for = p_acting_for,
      delegate_type = p_delegate_type,
      rejection_reason = p_reason,
      updated_at = NOW()
  WHERE id = p_request_id;

  IF NOT v_is_unlimited AND v_total_days > 0 THEN
    UPDATE leave_balances
    SET pending_days = GREATEST(pending_days - v_total_days, 0),
        updated_at = NOW()
    WHERE employee_id = v_request.employee_id
      AND leave_type = v_request.leave_type
      AND year = v_year
      AND org_id = v_request.org_id;
  END IF;

  INSERT INTO audit_log (org_id, actor_user_id, action, table_name, record_id, old_value, new_value)
  VALUES (
    v_request.org_id,
    p_approver_id,
    'reject',
    'leave_requests',
    p_request_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', 'rejected', 'rejection_reason', p_reason, 'acting_for', p_acting_for, 'delegate_type', p_delegate_type)
  );

  RETURN (
    SELECT to_jsonb(r)
    FROM (
      SELECT id, org_id, employee_id, leave_type, start_date, end_date,
             total_days, status, reason, approver_id, acting_for, delegate_type,
             rejection_reason, created_at, updated_at
      FROM leave_requests
      WHERE id = p_request_id
    ) r
  );
END;
$$;

commit;
