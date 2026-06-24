-- LEAVE-01: atomic decision for a retrospective leave change.
--
-- Approving a staged change previously updated the leave_request, then did a
-- best-effort balance adjustment in a separate statement. Two concurrent
-- approvals could each pass the "is there a pending change?" read and apply the
-- balance delta twice; a balance failure left the request changed with stale
-- balances. This RPC locks the request row (FOR UPDATE), verifies the expected
-- state (the request belongs to the actor's org, status = approved, AND a
-- pending change exists), then applies the status/date change, clears the
-- pending change, adjusts the balance, and writes a transactional audit row —
-- all in one transaction. A competing decision that already consumed the
-- pending change gets a STALE_CHANGE conflict instead of double-applying.
--
-- P0-1/P0-3: SECURITY DEFINER and tenant/state-scoped INSIDE the function, and
-- callable only by the server's service-role client (EXECUTE revoked from
-- anon/authenticated) — route-level checks cannot protect a directly-callable
-- PostgREST RPC.

begin;

drop function if exists public.decide_leave_change(uuid, text, uuid);

create or replace function public.decide_leave_change(
  p_request_id uuid,
  p_org_id uuid,
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

  -- Tenant guard: the request must belong to the acting org. Treat a mismatch as
  -- not-found so we never leak existence across organizations.
  if v_req.org_id is distinct from p_org_id then
    return jsonb_build_object('error', 'NOT_FOUND');
  end if;

  -- Expected-state guard: only an APPROVED request with a pending change may be
  -- decided. A competing decision that already cleared it, or a request no
  -- longer approved, is a stale/competing decision.
  if v_req.status <> 'approved' then
    return jsonb_build_object('error', 'INVALID_STATUS');
  end if;
  if v_req.pending_change_type is null then
    return jsonb_build_object('error', 'STALE_CHANGE');
  end if;

  v_change_type := v_req.pending_change_type;

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

    insert into public.audit_log (org_id, actor_user_id, action, table_name, record_id, old_value, new_value, created_at)
    values (p_org_id, p_actor_id, 'rejected', 'leave_requests', p_request_id,
      jsonb_build_object('pending_change_type', v_change_type),
      jsonb_build_object('change_decision', 'rejected'), now());

    select * into v_req from public.leave_requests where id = p_request_id;
    return to_jsonb(v_req);
  end if;

  -- approve
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

  insert into public.audit_log (org_id, actor_user_id, action, table_name, record_id, old_value, new_value, created_at)
  values (p_org_id, p_actor_id, case when v_change_type = 'cancel' then 'cancelled' else 'updated' end,
    'leave_requests', p_request_id,
    jsonb_build_object('status', 'approved', 'change_type', v_change_type),
    jsonb_build_object('change_decision', 'approved', 'change_type', v_change_type), now());

  select * into v_req from public.leave_requests where id = p_request_id;
  return to_jsonb(v_req);
end;
$$;

-- P0-1: server-only.
revoke all on function public.decide_leave_change(uuid, uuid, text, uuid) from public;
revoke all on function public.decide_leave_change(uuid, uuid, text, uuid) from anon;
revoke all on function public.decide_leave_change(uuid, uuid, text, uuid) from authenticated;
grant execute on function public.decide_leave_change(uuid, uuid, text, uuid) to service_role;

commit;
