-- Department visibility of published schedules
--
-- A team (e.g. Customer Success) should see who's working when. Shifts in a
-- PUBLISHED schedule become readable to:
--   - members of the schedule's department, or
--   - anyone on the schedule's roster (covers cross-department helpers), or
--   - everyone in the org when the schedule has no department (explicitly
--     unscoped schedules).
-- Drafts stay visible only to schedulers — publishing remains the act that
-- makes a rota public to its team. Additive policy; existing scoping intact.
--
-- NOTE: deliberately references schedule_roster (not shifts) for the
-- "rostered" check — a shifts subquery inside a shifts policy recurses
-- (see 20260306620000_fix_scheduling_rls_recursion.sql).

drop policy if exists shifts_select_published on public.shifts;
create policy shifts_select_published
on public.shifts
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and exists (
    select 1
    from public.schedules schedule_row
    where schedule_row.id = shifts.schedule_id
      and schedule_row.org_id = public.get_user_org_id()
      and schedule_row.status = 'published'
      and schedule_row.deleted_at is null
      and (
        schedule_row.department is null
        or schedule_row.department = (
          select me.department
          from public.profiles me
          where me.id = auth.uid()
        )
        or exists (
          select 1
          from public.schedule_roster roster_row
          where roster_row.schedule_id = schedule_row.id
            and roster_row.employee_id = auth.uid()
        )
      )
  )
);
