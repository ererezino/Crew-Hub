-- Change payment details hold duration from 48 hours to 2 hours
ALTER TABLE public.employee_payment_details
  ALTER COLUMN change_effective_at SET DEFAULT (now() + interval '2 hours');
