-- Add tracking fields for Crew Hub access state.
-- These are application-managed fields, NOT derived from Supabase auth tables
-- (which are unreliable due to createUser/email_confirm side effects).

BEGIN;

-- First real Crew Hub sign-in timestamp.
-- Set once by the login audit route after genuine signInWithPassword + MFA.
-- NULL = user has never signed into Crew Hub.
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS crew_hub_joined_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.profiles.crew_hub_joined_at IS
  'First Crew Hub sign-in timestamp. Set once by the login audit route on first real sign-in. NULL = never signed in.';

-- Timestamp of the first Crew Hub invite sent by an admin.
-- Set once by the invite route (idempotent — does not overwrite on re-invite).
-- NULL = admin has never sent a Crew Hub invite for this user.
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS first_invited_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.profiles.first_invited_at IS
  'Timestamp of the first Crew Hub invite sent by an admin. Set once by the invite route. NULL = never invited.';

COMMIT;
