-- Phase 2A: Expense routing rules + additional approval stage
-- Adds configurable routing rules and an optional additional approval stage
-- between manager approval and finance confirmation.

-- 1. Add new status value to the expense enum
alter type public.expense_status_type add value if not exists 'additional_approved';

-- 2. Create expense routing rules table
create table if not exists public.expense_routing_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  name text not null,
  priority integer not null default 100,
  department text,
  min_amount bigint,
  max_amount bigint,
  category text,
  approver_type text not null
    check (approver_type in ('department_owner', 'specific_person')),
  approver_id uuid references public.profiles(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, priority)
);

create index if not exists idx_routing_rules_org_active
  on public.expense_routing_rules(org_id, is_active)
  where deleted_at is null;

-- 3. Add routing columns to expenses table
alter table public.expenses
  add column if not exists requires_additional_approval boolean not null default false,
  add column if not exists additional_approver_id uuid references public.profiles(id),
  add column if not exists matched_rule_id uuid references public.expense_routing_rules(id),
  add column if not exists additional_approved_by uuid references public.profiles(id),
  add column if not exists additional_approved_at timestamptz,
  add column if not exists additional_acting_for uuid references public.profiles(id),
  add column if not exists additional_delegate_type text,
  add column if not exists additional_rejected_by uuid references public.profiles(id),
  add column if not exists additional_rejected_at timestamptz,
  add column if not exists additional_rejection_reason text;

-- 4. Index for additional approval stage queries
create index if not exists idx_expenses_additional_approver
  on public.expenses(org_id, additional_approver_id, status)
  where requires_additional_approval = true and deleted_at is null;

-- 5. RLS for expense_routing_rules
alter table public.expense_routing_rules enable row level security;

-- Everyone in the org can read active rules
create policy "routing_rules_select"
  on public.expense_routing_rules
  for select
  using (
    org_id = (select org_id from public.profiles where id = auth.uid())
  );

-- Only admins can manage rules
create policy "routing_rules_insert"
  on public.expense_routing_rules
  for insert
  with check (
    org_id = (select org_id from public.profiles where id = auth.uid())
    and exists (
      select 1 from public.profiles
      where id = auth.uid()
        and roles && ARRAY['SUPER_ADMIN','HR_ADMIN','FINANCE_ADMIN']::text[]
    )
  );

create policy "routing_rules_update"
  on public.expense_routing_rules
  for update
  using (
    org_id = (select org_id from public.profiles where id = auth.uid())
    and exists (
      select 1 from public.profiles
      where id = auth.uid()
        and roles && ARRAY['SUPER_ADMIN','HR_ADMIN','FINANCE_ADMIN']::text[]
    )
  );

-- 6. Update expenses RLS to allow additional approvers to update manager_approved expenses
-- The route-layer canApproveAtStage() does fine-grained checks;
-- RLS just needs to allow the broader status transitions.
-- Existing policies already allow FINANCE_ADMIN/SUPER_ADMIN to update manager_approved.
-- We extend to allow updates on additional_approved status as well.
-- No new RLS policy needed - existing admin policies cover it since we use service-role client.
