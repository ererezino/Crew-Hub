-- Payroll semimonthly realignment migration
--
-- Reshapes the payroll model from a generic payout-cycle engine
-- to an opinionated semimonthly worksheet model:
--   - Exactly two cycles per month (Cycle 1 = first Friday, Cycle 2 = third Friday)
--   - Default 50/50 salary split
--   - Per-cycle approval workflow (submitted → approved → paid)
--   - Frozen approval snapshots as the authoritative record
--   - Row-level worksheet columns for finance editing
--
-- All changes are additive — no existing columns or tables are dropped.

begin;

-- ══════════════════════════════════════════════════════════════════════
-- 1. payroll_runs: add cycle date columns
-- ══════════════════════════════════════════════════════════════════════

-- Explicit first-Friday and third-Friday dates for the month
alter table public.payroll_runs
  add column if not exists cycle_1_date date;

alter table public.payroll_runs
  add column if not exists cycle_2_date date;

-- ══════════════════════════════════════════════════════════════════════
-- 2. payroll_items: add worksheet columns for semimonthly planning
-- ══════════════════════════════════════════════════════════════════════

-- Cycle 1 (first Friday) planning columns
alter table public.payroll_items
  add column if not exists cycle_1_base_amount bigint not null default 0;

alter table public.payroll_items
  add column if not exists cycle_1_overtime_hours numeric(8, 2) not null default 0
    check (cycle_1_overtime_hours >= 0);

alter table public.payroll_items
  add column if not exists cycle_1_overtime_amount bigint not null default 0
    check (cycle_1_overtime_amount >= 0);

alter table public.payroll_items
  add column if not exists cycle_1_included boolean not null default true;

-- Cycle 2 (third Friday) planning columns
alter table public.payroll_items
  add column if not exists cycle_2_base_amount bigint not null default 0;

alter table public.payroll_items
  add column if not exists cycle_2_overtime_hours numeric(8, 2) not null default 0
    check (cycle_2_overtime_hours >= 0);

alter table public.payroll_items
  add column if not exists cycle_2_overtime_amount bigint not null default 0
    check (cycle_2_overtime_amount >= 0);

alter table public.payroll_items
  add column if not exists cycle_2_included boolean not null default true;

-- Worksheet edit columns (fees, bonus, comment, exception tracking)
alter table public.payroll_items
  add column if not exists fees bigint not null default 0;

alter table public.payroll_items
  add column if not exists bonus bigint not null default 0;

alter table public.payroll_items
  add column if not exists comment text;

alter table public.payroll_items
  add column if not exists exception_reason text;

-- Designation snapshot (from profile at calculation time)
alter table public.payroll_items
  add column if not exists designation text;

-- Accrue username snapshot
alter table public.payroll_items
  add column if not exists accrue_username text;

-- ══════════════════════════════════════════════════════════════════════
-- 3. payroll_cycles: add cycle number, approval workflow, payment ref
-- ══════════════════════════════════════════════════════════════════════

-- Cycle number: 1 or 2 (the two normal semimonthly cycles)
alter table public.payroll_cycles
  add column if not exists cycle_number smallint
    check (cycle_number is null or cycle_number in (1, 2));

-- Per-cycle submission audit
alter table public.payroll_cycles
  add column if not exists submitted_at timestamptz;

alter table public.payroll_cycles
  add column if not exists submitted_by uuid references public.profiles(id);

-- Per-cycle approval audit
alter table public.payroll_cycles
  add column if not exists approved_at timestamptz;

alter table public.payroll_cycles
  add column if not exists approved_by uuid references public.profiles(id);

-- Per-cycle rejection audit
alter table public.payroll_cycles
  add column if not exists rejected_at timestamptz;

alter table public.payroll_cycles
  add column if not exists rejected_by uuid references public.profiles(id);

alter table public.payroll_cycles
  add column if not exists rejection_reason text;

-- Payment completion fields
alter table public.payroll_cycles
  add column if not exists payment_reference text;

alter table public.payroll_cycles
  add column if not exists payment_note text;

-- Frozen approval snapshot: THE authoritative record after submission.
-- Approval review, payment evidence, exports, and audit all read from this.
alter table public.payroll_cycles
  add column if not exists approval_snapshot jsonb;

-- Total overtime for the cycle
alter table public.payroll_cycles
  add column if not exists total_overtime bigint not null default 0
    check (total_overtime >= 0);

-- Total bonus for the cycle
alter table public.payroll_cycles
  add column if not exists total_bonus bigint not null default 0
    check (total_bonus >= 0);

-- Total fees for the cycle
alter table public.payroll_cycles
  add column if not exists total_fees bigint not null default 0;

-- ══════════════════════════════════════════════════════════════════════
-- 4. Update payroll_cycles status enum to include submitted/approved/rejected
-- ══════════════════════════════════════════════════════════════════════

-- Drop the old check constraint
alter table public.payroll_cycles
  drop constraint if exists payroll_cycles_status_check;

-- Add expanded status enum
alter table public.payroll_cycles
  add constraint payroll_cycles_status_check
    check (status in (
      'draft',
      'submitted',
      'approved',
      'rejected',
      'ready',
      'processing',
      'paid',
      'failed',
      'cancelled'
    ));

-- ══════════════════════════════════════════════════════════════════════
-- 5. Backfill existing payroll_items with default 50/50 split
-- ══════════════════════════════════════════════════════════════════════

-- For existing items, split the net_amount 50/50 across cycles
update public.payroll_items
set
  cycle_1_base_amount = (net_amount / 2),
  cycle_2_base_amount = (net_amount - (net_amount / 2))
where cycle_1_base_amount = 0
  and cycle_2_base_amount = 0
  and net_amount > 0
  and deleted_at is null;

-- ══════════════════════════════════════════════════════════════════════
-- 6. Indexes for new columns
-- ══════════════════════════════════════════════════════════════════════

create index if not exists idx_payroll_cycles_cycle_number
  on public.payroll_cycles(payroll_run_id, cycle_number)
  where deleted_at is null and cycle_number is not null;

create index if not exists idx_payroll_cycles_submitted
  on public.payroll_cycles(org_id, status)
  where deleted_at is null and status = 'submitted';

commit;
