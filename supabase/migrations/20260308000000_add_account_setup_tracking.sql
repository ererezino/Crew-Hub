-- Track when a user has actually completed their account setup
-- (clicked invite link and set their password).
-- This is the ONLY reliable way to know — Supabase auth fields like
-- last_sign_in_at and email_confirmed_at are set by admin operations
-- and cannot be trusted for detecting real sign-ins.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS account_setup_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.profiles.account_setup_at IS
  'Timestamp when the user completed their initial account setup (set their password). NULL means they have not set up yet.';
