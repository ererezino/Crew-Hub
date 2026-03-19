-- Add 'partially_paid' to payroll_items.payment_status to support
-- split-cycle disbursements where only part of net has been paid.

ALTER TABLE public.payroll_items
  DROP CONSTRAINT IF EXISTS payroll_items_payment_status_check;

ALTER TABLE public.payroll_items
  ADD CONSTRAINT payroll_items_payment_status_check
  CHECK (payment_status IN ('pending', 'processing', 'partially_paid', 'paid', 'failed', 'cancelled'));
