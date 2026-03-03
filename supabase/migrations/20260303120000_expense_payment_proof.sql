-- ============================================================================
-- Migration: Add payment proof receipt to expenses
-- Purpose: Allow finance team to upload proof of payment (bank receipt/screenshot)
--          when disbursing expense reimbursements.
-- ============================================================================

-- Add payment proof column (nullable — only populated after finance disburses)
alter table public.expenses
  add column if not exists reimbursement_receipt_path text;

-- Add a comment for documentation
comment on column public.expenses.reimbursement_receipt_path
  is 'Supabase storage path for the payment proof receipt uploaded by finance during disbursement.';
