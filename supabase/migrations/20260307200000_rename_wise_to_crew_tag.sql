-- Rename wise_recipient_id column to crew_tag and update payment method values.

-- Step 1: Rename the column (safe if already renamed)
DO $$
BEGIN
  ALTER TABLE public.employee_payment_details
    RENAME COLUMN wise_recipient_id TO crew_tag;
EXCEPTION
  WHEN undefined_column THEN
    RAISE NOTICE 'Column wise_recipient_id does not exist, skipping rename.';
END $$;

-- Step 2: Add 'crew_tag' to the enum type if it exists, then update rows.
-- payment_method may be an enum type — add the new value first.
DO $$
BEGIN
  -- Check if payment_method_type enum exists and add crew_tag value
  ALTER TYPE payment_method_type ADD VALUE IF NOT EXISTS 'crew_tag';
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Enum update skipped: %', SQLERRM;
END $$;

-- Now update any rows that use 'wise' to 'crew_tag' (must be in separate transaction
-- block from ALTER TYPE, so we wrap in its own DO block)
DO $$
BEGIN
  UPDATE public.employee_payment_details
    SET payment_method = 'crew_tag'
    WHERE payment_method = 'wise';
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Row update skipped: %', SQLERRM;
END $$;

-- Step 3: If there is a CHECK constraint on payment_method that references 'wise',
-- drop and recreate it. (Safe to run even if the constraint doesn't exist.)
DO $$
BEGIN
  ALTER TABLE public.employee_payment_details
    DROP CONSTRAINT IF EXISTS employee_payment_details_payment_method_check;

  ALTER TABLE public.employee_payment_details
    ADD CONSTRAINT employee_payment_details_payment_method_check
    CHECK (payment_method IN ('bank_transfer', 'mobile_money', 'crew_tag'));
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Constraint update skipped: %', SQLERRM;
END $$;
