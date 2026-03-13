-- Fix invite status tracking: add invited_at column, reset incorrect account_setup_at,
-- normalize departments to match the canonical DEPARTMENTS list, and correct
-- pre-added employee statuses.

BEGIN;

-- ─── 1. Add invited_at column ───
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS invited_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.profiles.invited_at IS
  'Timestamp when an admin explicitly invited this user. NULL means never invited.';

-- ─── 2. Backfill invited_at from audit_log ───
-- The invite route logs an audit entry with "invitedBy" in new_value.
UPDATE public.profiles p
SET invited_at = sub.invited_time
FROM (
  SELECT DISTINCT ON (a.record_id)
    a.record_id,
    a.created_at AS invited_time
  FROM public.audit_log a
  WHERE a.action = 'updated'
    AND a.table_name = 'profiles'
    AND a.new_value->>'invitedBy' IS NOT NULL
  ORDER BY a.record_id, a.created_at ASC
) sub
WHERE p.id = sub.record_id
  AND p.invited_at IS NULL;

-- ─── 3. Reset account_setup_at for profiles that never actually signed in ───
-- Only keep account_setup_at for users who have actually signed in via Supabase Auth.
-- If a user has never signed in (last_sign_in_at IS NULL in auth.users), they haven't
-- set up their account — the account_setup_at was incorrectly set.
UPDATE public.profiles p
SET account_setup_at = NULL
WHERE p.account_setup_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM auth.users au
    WHERE au.id = p.id
      AND au.last_sign_in_at IS NULL
  );

-- ─── 4. Fix pre-added employee statuses ───
-- All employees who were pre-loaded (not new hires going through onboarding)
-- should be 'active', not 'onboarding'. We identify pre-added employees as those
-- who have no onboarding instance in 'active' status AND are currently 'onboarding'.
UPDATE public.profiles p
SET status = 'active', updated_at = NOW()
WHERE p.status = 'onboarding'
  AND p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.onboarding_instances oi
    WHERE oi.employee_id = p.id
      AND oi.status = 'active'
      AND oi.deleted_at IS NULL
  );

-- ─── 5. Normalize departments ───
-- Merge separate "Marketing" and "Growth" into "Marketing & Growth"
UPDATE public.profiles
SET department = 'Marketing & Growth', updated_at = NOW()
WHERE department IN ('Marketing', 'Growth')
  AND deleted_at IS NULL;

COMMIT;
