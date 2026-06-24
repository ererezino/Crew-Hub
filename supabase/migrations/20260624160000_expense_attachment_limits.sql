-- EXPENSE-01: enforce attachment count limits at the DATABASE level, where they
-- are race-free, instead of only with a read-then-write check in the route.
--
--   * Maximum: an expense may hold at most 10 active attachments (matches
--     MAX_EXPENSE_ATTACHMENTS in lib/expenses). Concurrent adds that each pass
--     the app's count check can no longer both commit and exceed the cap.
--   * Minimum: the LAST active attachment of an expense that has reached an
--     approved/paid state cannot be soft-deleted — approved evidence must not be
--     reducible to zero by a concurrent pair of "delete the last file" requests.
--
-- Atomicity comes from locking the parent expense row (FOR UPDATE) before
-- counting, so concurrent inserts/deletes for the same expense serialize.

begin;

create or replace function public.enforce_expense_attachment_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active_count int;
  v_status text;
  v_max constant int := 10;
begin
  -- Serialize concurrent attachment writes for this expense.
  select status into v_status from public.expenses where id = NEW.expense_id for update;

  if tg_op = 'INSERT' then
    select count(*) into v_active_count
    from public.expense_attachments
    where expense_id = NEW.expense_id and deleted_at is null;

    if v_active_count >= v_max then
      raise exception 'expense % already has the maximum of % attachments', NEW.expense_id, v_max
        using errcode = 'check_violation';
    end if;

  elsif tg_op = 'UPDATE' then
    -- Only guard the soft-delete transition (active → deleted).
    if OLD.deleted_at is null and NEW.deleted_at is not null then
      select count(*) into v_active_count
      from public.expense_attachments
      where expense_id = NEW.expense_id and deleted_at is null and id <> NEW.id;

      if v_active_count = 0
         and v_status in ('manager_approved', 'additional_approved', 'approved', 'reimbursed', 'partially_paid') then
        raise exception 'cannot remove the last evidence attachment from an approved expense %', NEW.expense_id
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_expense_attachment_limits_ins on public.expense_attachments;
create trigger trg_expense_attachment_limits_ins
  before insert on public.expense_attachments
  for each row execute function public.enforce_expense_attachment_limits();

drop trigger if exists trg_expense_attachment_limits_upd on public.expense_attachments;
create trigger trg_expense_attachment_limits_upd
  before update on public.expense_attachments
  for each row execute function public.enforce_expense_attachment_limits();

commit;
