-- SCHED-06: atomic, all-or-nothing schedule duplication.
--
-- The duplicate endpoint previously created the schedule, then copied the
-- roster (ignoring errors), then inserted shifts — three separate statements.
-- A failure after step 1 left an orphan/partial draft, and retrying created
-- another. It also silently dropped template_id and color when copying shifts.
--
-- This RPC creates the schedule, its roster, and all its shifts in ONE
-- transaction. Any error rolls everything back (no orphan draft). Every copied
-- employee id is validated against the target organization first. An optional
-- operation key makes retries idempotent: a second call with the same key
-- returns the already-created schedule instead of making a duplicate.

begin;

-- Idempotency key for duplication retries (nullable; only set by the duplicate flow).
alter table public.schedules
  add column if not exists duplicate_op_key text;

create unique index if not exists schedules_duplicate_op_key_unique
  on public.schedules (org_id, duplicate_op_key)
  where duplicate_op_key is not null;

create or replace function public.duplicate_schedule(
  p_org_id uuid,
  p_name text,
  p_department text,
  p_start_date date,
  p_end_date date,
  p_schedule_track text,
  p_roster jsonb,   -- [{ "employee_id": uuid, "weekend_hours": text|null }]
  p_shifts jsonb,   -- [{ employee_id, shift_date, start_time, end_time, break_minutes, notes, template_id, color }]
  p_op_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.schedules%rowtype;
  v_new_id uuid;
  v_employee_ids uuid[];
  v_invalid_count int;
  v_created_schedule jsonb;
begin
  -- Idempotent retry: same op key → return the schedule already created.
  if p_op_key is not null then
    select * into v_existing
    from public.schedules
    where org_id = p_org_id and duplicate_op_key = p_op_key and deleted_at is null
    limit 1;
    if found then
      return jsonb_build_object('schedule', to_jsonb(v_existing), 'idempotent', true);
    end if;
  end if;

  -- Validate every referenced employee belongs to the target org and is not deleted.
  select coalesce(array_agg(distinct eid), '{}'::uuid[])
  into v_employee_ids
  from (
    select (r->>'employee_id')::uuid as eid from jsonb_array_elements(coalesce(p_roster, '[]'::jsonb)) r
    where r->>'employee_id' is not null
    union
    select (s->>'employee_id')::uuid as eid from jsonb_array_elements(coalesce(p_shifts, '[]'::jsonb)) s
    where s->>'employee_id' is not null
  ) ids;

  if array_length(v_employee_ids, 1) is not null then
    select count(*) into v_invalid_count
    from unnest(v_employee_ids) as e(id)
    where not exists (
      select 1 from public.profiles p
      where p.id = e.id and p.org_id = p_org_id and p.deleted_at is null
    );
    if v_invalid_count > 0 then
      return jsonb_build_object('error', 'CROSS_ORG_EMPLOYEE');
    end if;
  end if;

  -- 1) Schedule.
  insert into public.schedules (org_id, name, department, start_date, end_date, schedule_track, status, duplicate_op_key)
  values (p_org_id, p_name, p_department, p_start_date, p_end_date, p_schedule_track, 'draft', p_op_key)
  returning id into v_new_id;

  -- 2) Roster.
  insert into public.schedule_roster (schedule_id, employee_id, weekend_hours)
  select v_new_id, (r->>'employee_id')::uuid, nullif(r->>'weekend_hours', '')
  from jsonb_array_elements(coalesce(p_roster, '[]'::jsonb)) r
  where r->>'employee_id' is not null;

  -- 3) Shifts (preserving template_id, color, break, notes, overnight timestamps).
  insert into public.shifts (
    org_id, schedule_id, employee_id, template_id, shift_date,
    start_time, end_time, break_minutes, status, notes, color
  )
  select
    p_org_id,
    v_new_id,
    nullif(s->>'employee_id', '')::uuid,
    nullif(s->>'template_id', '')::uuid,
    (s->>'shift_date')::date,
    (s->>'start_time')::timestamptz,
    (s->>'end_time')::timestamptz,
    coalesce((s->>'break_minutes')::int, 0),
    'scheduled',
    nullif(s->>'notes', ''),
    nullif(s->>'color', '')
  from jsonb_array_elements(coalesce(p_shifts, '[]'::jsonb)) s;

  select to_jsonb(sch) into v_created_schedule from public.schedules sch where sch.id = v_new_id;
  return jsonb_build_object('schedule', v_created_schedule, 'idempotent', false);
end;
$$;

commit;
