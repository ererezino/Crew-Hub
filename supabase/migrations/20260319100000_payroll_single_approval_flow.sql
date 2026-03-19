-- Replace the two-step payroll approval model (pending_first_approval /
-- pending_final_approval) with a single-step flow using submitted / rejected.
--
-- Status flow after this migration:
--   draft → calculated → submitted → approved → processing → completed
--                            ↓
--                        rejected  (returns to calculated on resubmission)
--                        cancelled (terminal)

-- 1. Drop the old CHECK constraint first so we can write new status values.
alter table public.payroll_runs
  drop constraint if exists payroll_runs_status_check;

-- 2. Migrate existing runs stuck in old statuses → submitted.
--    pending_first_approval  → submitted  (no approval yet)
--    pending_final_approval  → submitted  (had first approval, treat as submitted)
update public.payroll_runs
  set status = 'submitted',
      submitted_at = coalesce(submitted_at, updated_at),
      submitted_by = coalesce(submitted_by, initiated_by)
  where status in ('pending_first_approval', 'pending_final_approval');

-- 3. Add the new CHECK constraint with the updated status values.
alter table public.payroll_runs
  add constraint payroll_runs_status_check
    check (
      status in (
        'draft',
        'calculated',
        'submitted',
        'rejected',
        'approved',
        'processing',
        'completed',
        'cancelled'
      )
    );
