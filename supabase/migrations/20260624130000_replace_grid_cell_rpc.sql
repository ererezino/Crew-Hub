-- SCHED-03: atomic, tenant-safe weekly-grid cell replacement.
--
-- The grid "save a cell" operation must set EXACTLY which weekdays a crew
-- member works one shift slot for one week. Before this RPC the route did:
--   1) soft-delete the old slot shifts, then 2) insert the new ones — as two
-- separate statements with no transaction. An insert failure left the old cell
-- gone (data loss). It also accepted an arbitrary employee UUID under the
-- service role with no proof the employee belongs to the org.
--
-- This function performs clear + insert + swap-state cleanup in ONE
-- transaction, locking the affected rows (FOR UPDATE) so concurrent saves to
-- the same cell can't interleave. It supports an optional expected-shift-id
-- guard for optimistic concurrency (stale-cell → conflict). Times are compared
-- and built in UTC to match the application (which stores shift_date + HH:MM as
-- a UTC timestamp and rolls overnight ends to the next day).
--
-- Employee org/active/eligibility validation is enforced by the CALLER before
-- invoking this function (the route reads the profile under the service role
-- and checks org_id + status + deleted_at), so the id reaching here is already
-- proven to be an eligible member of the schedule's organization.

begin;

create or replace function public.replace_schedule_grid_cell(
  p_org_id uuid,
  p_schedule_id uuid,
  p_employee_id uuid,
  p_slot_start text,            -- 'HH:MM' (UTC wall-clock)
  p_slot_end text,             -- 'HH:MM' (UTC wall-clock)
  p_slot_name text,
  p_week_dates date[],         -- in-range Mon..Sun dates of the target week (clear scope)
  p_target_dates date[],       -- selected in-range dates to (re)create
  p_expected_shift_ids uuid[] default null  -- optimistic guard; null = skip
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid[];
  v_expected_sorted uuid[];
  v_existing_sorted uuid[];
  v_created int := 0;
  v_removed int := 0;
  d date;
  v_start timestamptz;
  v_end timestamptz;
begin
  -- Lock and collect this crew member's CURRENT shifts for THIS slot across the
  -- in-range week window. UTC comparison mirrors the app's extractIsoTime.
  -- NOTE: row locking (FOR UPDATE) is not permitted on an aggregate query, so we
  -- lock the concrete shift rows in a subquery and aggregate the locked ids.
  select coalesce(array_agg(locked.id order by locked.id), '{}'::uuid[])
  into v_existing
  from (
    select s.id
    from public.shifts s
    where s.org_id = p_org_id
      and s.schedule_id = p_schedule_id
      and s.employee_id = p_employee_id
      and s.shift_date = any(p_week_dates)
      and s.deleted_at is null
      and s.status <> 'cancelled'
      and to_char(s.start_time at time zone 'UTC', 'HH24:MI') = p_slot_start
      and to_char(s.end_time at time zone 'UTC', 'HH24:MI') = p_slot_end
    for update
  ) locked;

  -- Optimistic guard: if the caller told us what it expected to replace and the
  -- live set differs, the cell changed under them — signal a stale conflict.
  if p_expected_shift_ids is not null then
    select coalesce(array_agg(x order by x), '{}'::uuid[]) into v_expected_sorted
    from unnest(p_expected_shift_ids) as x;
    select coalesce(array_agg(x order by x), '{}'::uuid[]) into v_existing_sorted
    from unnest(v_existing) as x;
    if v_expected_sorted is distinct from v_existing_sorted then
      return jsonb_build_object('error', 'STALE_CELL');
    end if;
  end if;

  -- Clear: soft-delete dependent swap state first, then the shifts themselves.
  if array_length(v_existing, 1) is not null then
    update public.shift_swaps
    set deleted_at = now()
    where org_id = p_org_id
      and shift_id = any(v_existing)
      and deleted_at is null;

    update public.shifts
    set deleted_at = now(), status = 'cancelled', updated_at = now()
    where org_id = p_org_id
      and id = any(v_existing);

    v_removed := array_length(v_existing, 1);
  end if;

  -- Insert the selected weekdays (overnight end rolls to the next day).
  if p_target_dates is not null then
    foreach d in array p_target_dates loop
      v_start := (d::text || ' ' || p_slot_start || ':00')::timestamp at time zone 'UTC';
      v_end := (d::text || ' ' || p_slot_end || ':00')::timestamp at time zone 'UTC';
      if v_end <= v_start then
        v_end := v_end + interval '1 day';
      end if;

      insert into public.shifts (
        org_id, schedule_id, employee_id, shift_date,
        start_time, end_time, break_minutes, status, notes
      ) values (
        p_org_id, p_schedule_id, p_employee_id, d,
        v_start, v_end, 0, 'scheduled', p_slot_name
      );
      v_created := v_created + 1;
    end loop;
  end if;

  return jsonb_build_object('created', v_created, 'removed', v_removed);
end;
$$;

-- P0-1: this SECURITY DEFINER mutation must never be callable directly by a
-- browser session. PostgREST exposes public-schema functions as RPC and grants
-- EXECUTE to anon/authenticated by default, which would bypass the route's
-- authorization. Lock it down to the server's service-role client only.
revoke all on function public.replace_schedule_grid_cell(uuid, uuid, uuid, text, text, text, date[], date[], uuid[]) from public;
revoke all on function public.replace_schedule_grid_cell(uuid, uuid, uuid, text, text, text, date[], date[], uuid[]) from anon;
revoke all on function public.replace_schedule_grid_cell(uuid, uuid, uuid, text, text, text, date[], date[], uuid[]) from authenticated;
grant execute on function public.replace_schedule_grid_cell(uuid, uuid, uuid, text, text, text, date[], date[], uuid[]) to service_role;

commit;
