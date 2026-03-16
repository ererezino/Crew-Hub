-- Fix: allow admins to soft-delete events by making deleted rows visible to admins
-- (PostgreSQL RLS requires the updated row to pass SELECT policy after UPDATE)

drop policy if exists crew_night_events_select_scope on public.crew_night_events;
create policy crew_night_events_select_scope
on public.crew_night_events
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    -- Normal visibility: non-deleted, published events
    (
      deleted_at is null
      and (
        status in ('upcoming', 'completed')
        or public.has_role('HR_ADMIN')
        or public.has_role('SUPER_ADMIN')
      )
    )
    -- Admins can see soft-deleted rows (needed for UPDATE-based soft delete)
    or (
      deleted_at is not null
      and (
        public.has_role('HR_ADMIN')
        or public.has_role('SUPER_ADMIN')
      )
    )
  )
);
