-- Restrict expense routing rules management to SUPER_ADMIN only.
--
-- The original RLS policies allowed HR_ADMIN and FINANCE_ADMIN to
-- insert and update routing rules. The product rule requires that
-- routing configuration is Super Admin only.

-- Drop overly permissive insert policy and recreate as SUPER_ADMIN only
drop policy if exists "routing_rules_insert" on public.expense_routing_rules;

create policy "routing_rules_insert"
  on public.expense_routing_rules
  for insert
  with check (
    org_id = (select org_id from public.profiles where id = auth.uid())
    and exists (
      select 1 from public.profiles
      where id = auth.uid()
        and roles && ARRAY['SUPER_ADMIN']::text[]
    )
  );

-- Drop overly permissive update policy and recreate as SUPER_ADMIN only
drop policy if exists "routing_rules_update" on public.expense_routing_rules;

create policy "routing_rules_update"
  on public.expense_routing_rules
  for update
  using (
    org_id = (select org_id from public.profiles where id = auth.uid())
    and exists (
      select 1 from public.profiles
      where id = auth.uid()
        and roles && ARRAY['SUPER_ADMIN']::text[]
    )
  );
