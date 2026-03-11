-- Add multi-rail payment destination columns to expenses
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS vendor_payment_method VARCHAR(50) DEFAULT 'bank_transfer',
  ADD COLUMN IF NOT EXISTS vendor_mobile_money_provider TEXT,
  ADD COLUMN IF NOT EXISTS vendor_mobile_money_number TEXT,
  ADD COLUMN IF NOT EXISTS vendor_crew_tag TEXT,
  ADD COLUMN IF NOT EXISTS vendor_wire_bank_name TEXT,
  ADD COLUMN IF NOT EXISTS vendor_wire_account_number TEXT,
  ADD COLUMN IF NOT EXISTS vendor_wire_swift_bic TEXT,
  ADD COLUMN IF NOT EXISTS vendor_wire_iban TEXT,
  ADD COLUMN IF NOT EXISTS vendor_wire_bank_country TEXT,
  ADD COLUMN IF NOT EXISTS vendor_wire_currency VARCHAR(3);

-- Add multi-rail payment destination columns to vendor beneficiaries
ALTER TABLE public.vendor_beneficiaries
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'bank_transfer',
  ADD COLUMN IF NOT EXISTS mobile_money_provider TEXT,
  ADD COLUMN IF NOT EXISTS mobile_money_number TEXT,
  ADD COLUMN IF NOT EXISTS crew_tag TEXT,
  ADD COLUMN IF NOT EXISTS wire_bank_name TEXT,
  ADD COLUMN IF NOT EXISTS wire_account_number TEXT,
  ADD COLUMN IF NOT EXISTS wire_swift_bic TEXT,
  ADD COLUMN IF NOT EXISTS wire_iban TEXT,
  ADD COLUMN IF NOT EXISTS wire_bank_country TEXT,
  ADD COLUMN IF NOT EXISTS wire_currency VARCHAR(3);
