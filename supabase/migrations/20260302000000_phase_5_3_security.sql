-- Phase 5.3: security hardening (RLS audit helper)

create or replace function public.rls_audit()
returns table (
  schema_name text,
  table_name text,
  rls_enabled boolean,
  force_rls boolean
)
language sql
security definer
set search_path = public
as $$
  select
    n.nspname::text as schema_name,
    c.relname::text as table_name,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as force_rls
  from pg_class c
  join pg_namespace n
    on n.oid = c.relnamespace
  where c.relkind = 'r'
    and n.nspname = 'public'
  order by c.relname;
$$;

grant execute on function public.rls_audit() to authenticated;
grant execute on function public.rls_audit() to service_role;
