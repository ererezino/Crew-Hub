-- ONBOARD-01 / P1-6: atomic onboarding task completion + dependency unlock.
--
-- Completing a task (manually or by signature) must, in ONE transaction:
--   1. enforce dependencies with EXACT-MATCH semantics — every declared
--      prerequisite must exist (same instance, not deleted) AND be completed.
--      A missing/deleted prerequisite record is NOT treated as satisfied, so a
--      blocked task with vanished prerequisites can never be completed early
--      (this closes the `.every([])` empty-set bypass in the signatures route).
--   2. mark the task completed, and
--   3. flip every now-eligible blocked sibling 'blocked' → 'pending'.
--
-- For the unlock (liveness) pass a missing prerequisite IS treated as satisfied,
-- mirroring findUnlockableTasks, so dependents never get permanently stuck.
--
-- SECURITY DEFINER + service-role-only: the signing/route layer authorizes the
-- actor; this function performs the state transition atomically.

begin;

create or replace function public.complete_onboarding_task_with_unlock(
  p_task_id uuid,
  p_org_id uuid,
  p_completed_by uuid,
  p_enforce_dependencies boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task record;
  v_instance uuid;
  v_dep_ids uuid[];
  v_satisfied int;
  v_dep_count int;
  v_unlocked uuid[] := '{}';
  r record;
begin
  select * into v_task
  from public.onboarding_tasks
  where id = p_task_id and org_id = p_org_id and deleted_at is null
  for update;

  if not found then
    return jsonb_build_object('error', 'NOT_FOUND');
  end if;

  if v_task.status = 'completed' then
    return jsonb_build_object('completed', true, 'already', true, 'unlocked', v_unlocked);
  end if;

  v_instance := v_task.instance_id;
  v_dep_ids := coalesce(v_task.depends_on_task_ids, '{}'::uuid[]);
  v_dep_count := coalesce(array_length(v_dep_ids, 1), 0);

  -- Exact-match enforcement (fail closed).
  if p_enforce_dependencies and v_dep_count > 0 then
    select count(*) into v_satisfied
    from public.onboarding_tasks d
    where d.id = any(v_dep_ids)
      and d.instance_id = v_instance
      and d.org_id = p_org_id
      and d.deleted_at is null
      and d.status = 'completed';

    if v_satisfied <> v_dep_count then
      return jsonb_build_object('error', 'TASK_BLOCKED');
    end if;
  end if;

  update public.onboarding_tasks
  set status = 'completed', completed_by = p_completed_by, completed_at = now(), updated_at = now()
  where id = p_task_id;

  -- Unlock pass (liveness: a missing prerequisite counts as satisfied).
  if v_instance is not null then
    for r in
      select t.id, t.depends_on_task_ids
      from public.onboarding_tasks t
      where t.instance_id = v_instance
        and t.org_id = p_org_id
        and t.status = 'blocked'
        and t.deleted_at is null
        and t.depends_on_task_ids is not null
        and array_length(t.depends_on_task_ids, 1) > 0
      for update
    loop
      if not exists (
        select 1
        from unnest(r.depends_on_task_ids) as dep(id)
        join public.onboarding_tasks pt
          on pt.id = dep.id
         and pt.instance_id = v_instance
         and pt.org_id = p_org_id
         and pt.deleted_at is null
        where pt.status <> 'completed'
      ) then
        update public.onboarding_tasks
        set status = 'pending', updated_at = now()
        where id = r.id and status = 'blocked';
        v_unlocked := array_append(v_unlocked, r.id);
      end if;
    end loop;
  end if;

  return jsonb_build_object('completed', true, 'unlocked', v_unlocked);
end;
$$;

revoke all on function public.complete_onboarding_task_with_unlock(uuid, uuid, uuid, boolean) from public;
revoke all on function public.complete_onboarding_task_with_unlock(uuid, uuid, uuid, boolean) from anon;
revoke all on function public.complete_onboarding_task_with_unlock(uuid, uuid, uuid, boolean) from authenticated;
grant execute on function public.complete_onboarding_task_with_unlock(uuid, uuid, uuid, boolean) to service_role;

commit;
