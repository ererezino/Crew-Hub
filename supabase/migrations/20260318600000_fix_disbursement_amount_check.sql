-- Add non-negative constraint to payroll_cycle_items.disbursement_amount.
-- Omitted from 20260318500000; enforces the invariant that cycle payout
-- amounts must never go negative at the database layer.

alter table public.payroll_cycle_items
  add constraint payroll_cycle_items_disbursement_amount_nonneg
    check (disbursement_amount >= 0);
