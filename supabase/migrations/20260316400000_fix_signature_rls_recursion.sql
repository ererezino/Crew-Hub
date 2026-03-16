-- Fix: infinite recursion between signature_requests and signature_signers RLS policies.
--
-- The signature_requests SELECT policy subqueries signature_signers, whose
-- SELECT policy subqueries signature_requests — causing a cycle.
--
-- Solution: replace the cross-table subqueries with SECURITY DEFINER helper
-- functions that bypass RLS, breaking the recursion.

begin;

-- Helper: check if a user is a signer on a given request (bypasses RLS)
create or replace function public.is_signer_on_request(
  p_request_id uuid,
  p_org_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.signature_signers ss
    where ss.signature_request_id = p_request_id
      and ss.org_id = p_org_id
      and ss.deleted_at is null
      and ss.signer_user_id = p_user_id
  );
$$;

-- Helper: check if a user created a given request (bypasses RLS)
create or replace function public.is_request_creator(
  p_request_id uuid,
  p_org_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.signature_requests sr
    where sr.id = p_request_id
      and sr.org_id = p_org_id
      and sr.deleted_at is null
      and sr.created_by = p_user_id
  );
$$;

-- Recreate signature_requests SELECT policy using the helper
drop policy if exists signature_requests_select_scope on public.signature_requests;
create policy signature_requests_select_scope
on public.signature_requests
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or created_by = auth.uid()
    or public.is_signer_on_request(id, org_id, auth.uid())
  )
);

-- Recreate signature_signers SELECT policy using the helper
drop policy if exists signature_signers_select_scope on public.signature_signers;
create policy signature_signers_select_scope
on public.signature_signers
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or signer_user_id = auth.uid()
    or public.is_request_creator(signature_request_id, org_id, auth.uid())
  )
);

-- Recreate signature_events SELECT policy using the helper (it also subqueries both tables)
drop policy if exists signature_events_select_scope on public.signature_events;
create policy signature_events_select_scope
on public.signature_events
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or public.is_request_creator(signature_request_id, org_id, auth.uid())
    or public.is_signer_on_request(signature_request_id, org_id, auth.uid())
  )
);

commit;
