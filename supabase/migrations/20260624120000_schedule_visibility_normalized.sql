-- SCHED-02: one published-schedule visibility rule, normalized, for both tables.
--
-- Before this migration two rules disagreed:
--   * schedules_select_scope let an ordinary employee SELECT EVERY published
--     schedule in the org (no department/roster scoping at all), while the app
--     route then re-narrowed to "my department only".
--   * shifts_select_published scoped shifts to (same department OR rostered OR
--     unscoped) but compared department with a case-SENSITIVE "=", whereas the
--     app compared with trim + case-insensitive normalization.
--
-- The fix defines the rule ONCE as public.can_view_published_schedule(...) and
-- uses it in both the schedules and shifts SELECT policies, with trim +
-- case-insensitive department comparison so "Customer Success", "customer
-- success", and " Customer Success " all match. Ordinary employees may see a
-- published schedule when at least one holds:
--   * the schedule has no department (org-wide / unscoped), OR
--   * its normalized department equals the viewer's normalized department, OR
--   * the viewer is on the schedule's roster (cross-department helpers).
-- Drafts remain scheduler-only. Managers/admins/team-leads keep their existing
-- broader scope via the OR branches already present in the policies.
--
-- NOTE: like 20260306620000, the roster check references schedule_roster (not
-- shifts) to avoid a shifts-subquery-inside-shifts-policy recursion.

begin;

create or replace function public.can_view_published_schedule(
  p_department text,
  p_schedule_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- Unscoped schedule: visible org-wide.
    p_department is null
    -- Same normalized department as the viewer.
    or lower(btrim(p_department)) = (
      select lower(btrim(me.department))
      from public.profiles me
      where me.id = auth.uid()
        and me.department is not null
    )
    -- Explicitly rostered onto this schedule (covers cross-department helpers).
    or exists (
      select 1
      from public.schedule_roster roster_row
      where roster_row.schedule_id = p_schedule_id
        and roster_row.employee_id = auth.uid()
    );
$$;

-- ── schedules: ordinary employees no longer see EVERY published schedule ──
drop policy if exists schedules_select_scope on public.schedules;
create policy schedules_select_scope
on public.schedules
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    (status = 'published' and public.can_view_published_schedule(department, id))
    or public.has_role('MANAGER')
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or public.has_shift_assignment_in_schedule(id, org_id)
  )
);

-- ── shifts: same rule, now via the shared normalized helper ──
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
      and public.can_view_published_schedule(schedule_row.department, schedule_row.id)
  )
);

commit;
