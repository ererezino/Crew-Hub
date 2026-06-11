-- Offline submission idempotency
--
-- Employees on weak networks get an offline queue for expense submissions
-- and leave requests. A submission that times out may still have reached
-- the server, so retries must be idempotent: the client generates a
-- client_request_id (UUID) per logical submission, and a unique index per
-- org guarantees a replay can never create a duplicate. The API returns
-- the previously created row when it sees a known client_request_id.
--
-- Columns are nullable: only the offline-queue client path sets them.

alter table public.expenses
  add column if not exists client_request_id uuid;

alter table public.leave_requests
  add column if not exists client_request_id uuid;

create unique index if not exists expenses_org_client_request_id_key
  on public.expenses (org_id, client_request_id)
  where client_request_id is not null;

create unique index if not exists leave_requests_org_client_request_id_key
  on public.leave_requests (org_id, client_request_id)
  where client_request_id is not null;
