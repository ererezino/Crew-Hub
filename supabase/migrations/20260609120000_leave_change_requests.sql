-- Retrospective leave cancellation / date change with manager approval.
--
-- An employee can request to cancel or move an *already-approved* leave (e.g. leave
-- booked in May that was never taken, or a leave whose dates shifted). The request is
-- staged on the leave row as a pending change and only takes effect once a manager
-- approves it. Keeping the change attached to the leave (rather than a separate table)
-- means the existing approval/balance plumbing and the live schedule conflict checks
-- continue to work unchanged once the change is applied.

alter table public.leave_requests
  add column if not exists pending_change_type varchar(20),
  add column if not exists pending_start_date date,
  add column if not exists pending_end_date date,
  add column if not exists pending_total_days numeric(6, 2),
  add column if not exists change_reason text,
  add column if not exists change_requested_by uuid references public.profiles(id),
  add column if not exists change_requested_at timestamptz;

alter table public.leave_requests
  drop constraint if exists leave_requests_pending_change_type_check;

alter table public.leave_requests
  add constraint leave_requests_pending_change_type_check
    check (pending_change_type is null or pending_change_type in ('cancel', 'edit'));

-- For an 'edit' change the proposed dates must be present and well-ordered.
alter table public.leave_requests
  drop constraint if exists leave_requests_pending_edit_dates_check;

alter table public.leave_requests
  add constraint leave_requests_pending_edit_dates_check
    check (
      pending_change_type is distinct from 'edit'
      or (
        pending_start_date is not null
        and pending_end_date is not null
        and pending_end_date >= pending_start_date
      )
    );

-- Surface leaves awaiting a change decision to the approvals queue quickly.
create index if not exists idx_leave_requests_pending_change
  on public.leave_requests(org_id, pending_change_type)
  where pending_change_type is not null and deleted_at is null;
