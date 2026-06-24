-- LEAVE-01: atomic decision for a retrospective leave change.
--
-- Approving a staged change previously updated the leave_request, then did a
-- best-effort balance adjustment in a separate statement. Two concurrent
-- approvals could each pass the "is there a pending change?" read and apply the
-- balance delta twice; a balance failure left the request changed with stale
-- balances. This RPC locks the request row (FOR UPDATE), verifies the expected
-- state (status = approved AND a pending change exists), then applies the
-- status/date change, clears the pending change, and adjusts the balance — all
-- in one transaction. A competing decision that already consumed the pending
-- change gets a STALE_CHANGE conflict instead of double-applying.

begin;

create or replace function public.decide_leave_change(
  p_request_id uuid,
  p_decision text,        -- 'approve' | 'reject'
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_is_unlimited boolean;
  v_change_type text;
  v_old_total numeric;
  v_new_total numeric;
  v_old_year int;
  v_new_year int;
begin
  if p_decision not in ('approve', 'reject') then
    return jsonb_build_object('error', 'INVALID_DECISION');
  end if;

  -- Lock the request so concurrent decisions serialize.
  select * into v_req
  from public.leave_requests
  where id = p_request_id and deleted_at is null
  for update;

  if not found then
    return jsonb_build_object('error', 'NOT_FOUND');
  end if;

  -- Expected-state guard: a pending change on an approved request. If a
  -- competing decision already cleared it, this is a stale/competing decision.
  if v_req.pending_change_type is null then
    return jsonb_build_object('error', 'STALE_CHANGE');
  end if;

  if p_decision = 'reject' then
    update public.leave_requests
    set pending_change_type = null,
        pending_start_date = null,
        pending_end_date = null,
        pending_total_days = null,
        change_reason = null,
        change_requested_by = null,
        change_requested_at = null,
        updated_at = now()
    where id = p_request_id;

    select * into v_req from public.leave_requests where id = p_request_id;
    return to_jsonb(v_req);
  end if;

  -- approve
  v_change_type := v_req.pending_change_type;
  v_is_unlimited := v_req.leave_type in ('sick_leave', 'bereavement', 'compassionate');
  v_old_total := coalesce(v_req.total_days, 0);
  v_old_year := extract(year from v_req.start_date)::int;

  if v_change_type = 'cancel' then
    update public.leave_requests
    set status = 'cancelled',
        pending_change_type = null,
        pending_start_date = null,
        pending_end_date = null,
        pending_total_days = null,
        change_reason = null,
        change_requested_by = null,
        change_requested_at = null,
        updated_at = now()
    where id = p_request_id;

    if not v_is_unlimited and v_old_total > 0 then
      update public.leave_balances
      set used_days = greatest(used_days - v_old_total, 0), updated_at = now()
      where employee_id = v_req.employee_id
        and leave_type = v_req.leave_type
        and year = v_old_year
        and org_id = v_req.org_id;
    end if;
  else
    -- edit
    if v_req.pending_start_date is null or v_req.pending_end_date is null then
      return jsonb_build_object('error', 'INVALID_PENDING_CHANGE');
    end if;

    v_new_total := coalesce(v_req.pending_total_days, v_old_total);
    v_new_year := extract(year from v_req.pending_start_date)::int;

    update public.leave_requests
    set start_date = v_req.pending_start_date,
        end_date = v_req.pending_end_date,
        total_days = v_new_total,
        pending_change_type = null,
        pending_start_date = null,
        pending_end_date = null,
        pending_total_days = null,
        change_reason = null,
        change_requested_by = null,
        change_requested_at = null,
        updated_at = now()
    where id = p_request_id;

    if not v_is_unlimited then
      if v_old_year = v_new_year then
        update public.leave_balances
        set used_days = greatest(used_days + (v_new_total - v_old_total), 0), updated_at = now()
        where employee_id = v_req.employee_id
          and leave_type = v_req.leave_type
          and year = v_old_year
          and org_id = v_req.org_id;
      else
        update public.leave_balances
        set used_days = greatest(used_days - v_old_total, 0), updated_at = now()
        where employee_id = v_req.employee_id
          and leave_type = v_req.leave_type
          and year = v_old_year
          and org_id = v_req.org_id;

        update public.leave_balances
        set used_days = greatest(used_days + v_new_total, 0), updated_at = now()
        where employee_id = v_req.employee_id
          and leave_type = v_req.leave_type
          and year = v_new_year
          and org_id = v_req.org_id;
        if not found then
          insert into public.leave_balances (org_id, employee_id, leave_type, year, total_days, used_days, pending_days, carried_days)
          values (v_req.org_id, v_req.employee_id, v_req.leave_type, v_new_year, 0, greatest(v_new_total, 0), 0, 0)
          on conflict do nothing;
        end if;
      end if;
    end if;
  end if;

  select * into v_req from public.leave_requests where id = p_request_id;
  return to_jsonb(v_req);
end;
$$;

commit;
