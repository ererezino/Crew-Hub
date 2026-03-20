-- Phase 2c: Make created_by immutable and enforce state invariants.
--
-- Without this, a user with direct Supabase access could rewrite created_by
-- on their own pending record, then approve it — bypassing separation of duties.

begin;

-- ── 1. Trigger: created_by is immutable after insert ──

create or replace function public.immutable_created_by()
returns trigger
language plpgsql
as $$
begin
  if OLD.created_by is not null and NEW.created_by is distinct from OLD.created_by then
    raise exception 'created_by is immutable after insert'
      using errcode = '23514'; -- check_violation
  end if;
  return NEW;
end;
$$;

drop trigger if exists enforce_immutable_created_by on public.compensation_records;
create trigger enforce_immutable_created_by
before update on public.compensation_records
for each row
execute function public.immutable_created_by();

-- ── 2. CHECK constraints: salary_status state invariants ──
-- pending  => approved_by IS NULL AND approved_at IS NULL
-- approved => approved_by IS NOT NULL AND approved_at IS NOT NULL

alter table public.compensation_records
  drop constraint if exists compensation_records_approval_state_check;

alter table public.compensation_records
  add constraint compensation_records_approval_state_check
  check (
    (salary_status = 'pending' and approved_by is null and approved_at is null)
    or
    (salary_status = 'approved' and approved_by is not null and approved_at is not null)
  );

commit;
