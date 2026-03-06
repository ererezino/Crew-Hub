-- Fix production auth failures caused by recursive profiles RLS policy.
-- The prior TEAM_LEAD policy queried public.profiles directly inside a policy
-- on public.profiles, which can trigger infinite recursion (42P17).

create or replace function public.get_user_department()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select (
    select p.department
    from public.profiles p
    where p.id = auth.uid()
      and p.deleted_at is null
    limit 1
  );
$$;

drop policy if exists profiles_select_team_lead_scope on public.profiles;

create policy profiles_select_team_lead_scope
on public.profiles
for select
to authenticated
using (
  public.has_role('TEAM_LEAD')
  and org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    id = auth.uid()
    or (
      department is not null
      and public.get_user_department() is not null
      and lower(trim(department)) = lower(trim(public.get_user_department()))
    )
  )
);
