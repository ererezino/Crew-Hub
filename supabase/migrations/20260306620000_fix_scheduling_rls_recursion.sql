-- Fix scheduling RLS recursion between schedules, shifts, and shift_swaps.

begin;

create or replace function public.is_team_lead_for_department(target_department text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    public.has_role('TEAM_LEAD')
    and target_department is not null
    and public.get_user_department() is not null
    and lower(trim(public.get_user_department())) = lower(trim(target_department))
  );
$$;

create or replace function public.has_shift_assignment_in_schedule(
  target_schedule_id uuid,
  target_org_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shifts shift_row
    where shift_row.schedule_id = target_schedule_id
      and shift_row.org_id = target_org_id
      and shift_row.employee_id = auth.uid()
      and shift_row.deleted_at is null
  );
$$;

create or replace function public.team_lead_can_access_schedule(
  target_schedule_id uuid,
  target_org_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select public.is_team_lead_for_department(schedule_row.department)
      from public.schedules schedule_row
      where schedule_row.id = target_schedule_id
        and schedule_row.org_id = target_org_id
        and schedule_row.deleted_at is null
      limit 1
    ),
    false
  );
$$;

create or replace function public.team_lead_can_access_shift(
  target_shift_id uuid,
  target_org_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select public.is_team_lead_for_department(schedule_row.department)
      from public.shifts shift_row
      join public.schedules schedule_row
        on schedule_row.id = shift_row.schedule_id
       and schedule_row.org_id = shift_row.org_id
       and schedule_row.deleted_at is null
      where shift_row.id = target_shift_id
        and shift_row.org_id = target_org_id
        and shift_row.deleted_at is null
      limit 1
    ),
    false
  );
$$;

drop policy if exists schedules_select_scope on public.schedules;
create policy schedules_select_scope
on public.schedules
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    status = 'published'
    or public.has_role('MANAGER')
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or public.has_shift_assignment_in_schedule(id, org_id)
  )
);

drop policy if exists schedules_select_team_lead on public.schedules;
create policy schedules_select_team_lead
on public.schedules
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and public.is_team_lead_for_department(department)
);

drop policy if exists schedules_insert_team_lead on public.schedules;
create policy schedules_insert_team_lead
on public.schedules
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and public.is_team_lead_for_department(department)
);

drop policy if exists schedules_update_team_lead on public.schedules;
create policy schedules_update_team_lead
on public.schedules
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and public.is_team_lead_for_department(department)
)
with check (
  org_id = public.get_user_org_id()
  and public.is_team_lead_for_department(department)
);

drop policy if exists schedules_delete_team_lead on public.schedules;
create policy schedules_delete_team_lead
on public.schedules
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and public.is_team_lead_for_department(department)
);

drop policy if exists shifts_select_team_lead on public.shifts;
create policy shifts_select_team_lead
on public.shifts
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and public.team_lead_can_access_schedule(schedule_id, org_id)
);

drop policy if exists shifts_insert_team_lead on public.shifts;
create policy shifts_insert_team_lead
on public.shifts
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and public.team_lead_can_access_schedule(schedule_id, org_id)
);

drop policy if exists shifts_update_team_lead on public.shifts;
create policy shifts_update_team_lead
on public.shifts
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and public.team_lead_can_access_schedule(schedule_id, org_id)
)
with check (
  org_id = public.get_user_org_id()
  and public.team_lead_can_access_schedule(schedule_id, org_id)
);

drop policy if exists shifts_delete_team_lead on public.shifts;
create policy shifts_delete_team_lead
on public.shifts
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and public.team_lead_can_access_schedule(schedule_id, org_id)
);

drop policy if exists shift_swaps_select_team_lead on public.shift_swaps;
create policy shift_swaps_select_team_lead
on public.shift_swaps
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and public.team_lead_can_access_shift(shift_id, org_id)
);

drop policy if exists shift_swaps_update_team_lead on public.shift_swaps;
create policy shift_swaps_update_team_lead
on public.shift_swaps
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and public.team_lead_can_access_shift(shift_id, org_id)
)
with check (
  org_id = public.get_user_org_id()
  and public.team_lead_can_access_shift(shift_id, org_id)
);

drop policy if exists shift_swaps_delete_team_lead on public.shift_swaps;
create policy shift_swaps_delete_team_lead
on public.shift_swaps
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and public.team_lead_can_access_shift(shift_id, org_id)
);

commit;
