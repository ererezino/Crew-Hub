-- Fix: The original CHECK constraint still referenced the old `wise_recipient_id` column
-- and `'wise'` enum value after the rename migration. This caused all crew_tag writes to
-- be rejected by the database, making the payment method unusable.

ALTER TABLE public.employee_payment_details
  DROP CONSTRAINT IF EXISTS employee_payment_details_method_fields_check;

ALTER TABLE public.employee_payment_details
  ADD CONSTRAINT employee_payment_details_method_fields_check
  CHECK (
    (
      payment_method = 'bank_transfer'::public.payment_method_type
      AND bank_name_encrypted IS NOT NULL
      AND bank_account_name_encrypted IS NOT NULL
      AND bank_account_number_encrypted IS NOT NULL
      AND bank_account_last4 IS NOT NULL
      AND mobile_money_provider_encrypted IS NULL
      AND mobile_money_number_encrypted IS NULL
      AND mobile_money_last4 IS NULL
      AND crew_tag IS NULL
    )
    OR
    (
      payment_method = 'mobile_money'::public.payment_method_type
      AND mobile_money_provider_encrypted IS NOT NULL
      AND mobile_money_number_encrypted IS NOT NULL
      AND mobile_money_last4 IS NOT NULL
      AND bank_name_encrypted IS NULL
      AND bank_account_name_encrypted IS NULL
      AND bank_account_number_encrypted IS NULL
      AND bank_routing_number_encrypted IS NULL
      AND bank_account_last4 IS NULL
      AND crew_tag IS NULL
    )
    OR
    (
      payment_method = 'crew_tag'::public.payment_method_type
      AND crew_tag IS NOT NULL
      AND char_length(trim(crew_tag)) > 0
      AND bank_name_encrypted IS NULL
      AND bank_account_name_encrypted IS NULL
      AND bank_account_number_encrypted IS NULL
      AND bank_routing_number_encrypted IS NULL
      AND bank_account_last4 IS NULL
      AND mobile_money_provider_encrypted IS NULL
      AND mobile_money_number_encrypted IS NULL
      AND mobile_money_last4 IS NULL
    )
  );
