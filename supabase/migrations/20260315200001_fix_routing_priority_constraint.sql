-- Fix: Replace table-level unique constraint on (org_id, priority)
-- with a partial unique index that excludes soft-deleted rows.
--
-- The original constraint prevents reuse of priority values after
-- soft-deleting a routing rule, causing silent insert failures.

alter table public.expense_routing_rules
  drop constraint if exists expense_routing_rules_org_id_priority_key;

create unique index if not exists idx_routing_rules_org_priority_active
  on public.expense_routing_rules(org_id, priority)
  where deleted_at is null;
