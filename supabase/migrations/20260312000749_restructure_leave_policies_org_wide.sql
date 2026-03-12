-- Restructure leave_policies from per-country to org-wide.
-- The Accrue time-off policy is a single org-wide policy, not per-country.
-- Also add personal_days leave type and fix sick_leave to be unlimited.

BEGIN;

-- 1. Drop the per-country unique constraint
ALTER TABLE public.leave_policies
  DROP CONSTRAINT IF EXISTS leave_policies_unique_org_country_type;

-- 2. Drop the CHECK constraint on country_code that prevents NULL
--    (existing constraint: country_code ~ '^[A-Z]{2}$' does not allow NULL)
ALTER TABLE public.leave_policies
  DROP CONSTRAINT IF EXISTS leave_policies_country_code_check;

-- 3. Make country_code nullable (no longer required)
ALTER TABLE public.leave_policies
  ALTER COLUMN country_code DROP NOT NULL;

-- 4. Re-add CHECK constraint allowing NULL (org-wide) OR valid 2-letter code
ALTER TABLE public.leave_policies
  ADD CONSTRAINT leave_policies_country_code_check
  CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');

-- 5. Consolidate duplicate per-country annual_leave into one org-wide policy.
--    Keep the NG row (arbitrary), soft-delete the CM and GH duplicates.
UPDATE public.leave_policies
  SET deleted_at = now(), updated_at = now()
  WHERE leave_type = 'annual_leave'
    AND country_code IN ('CM', 'GH')
    AND deleted_at IS NULL
    AND org_id = '0c0e516f-5896-4f3b-a163-42e8460e5faa';

-- 6. Set the remaining annual_leave policy to org-wide (null country_code)
--    Also ensure correct values: 20 days, annual_upfront accrual
UPDATE public.leave_policies
  SET country_code = NULL,
      default_days_per_year = 20,
      accrual_type = 'annual_upfront',
      updated_at = now()
  WHERE leave_type = 'annual_leave'
    AND country_code = 'NG'
    AND deleted_at IS NULL
    AND org_id = '0c0e516f-5896-4f3b-a163-42e8460e5faa';

-- 7. Fix sick_leave: make org-wide and unlimited (per company policy)
--    Soft-delete duplicates first (keep one)
WITH sick_to_keep AS (
  SELECT id FROM public.leave_policies
  WHERE leave_type = 'sick_leave'
    AND deleted_at IS NULL
    AND org_id = '0c0e516f-5896-4f3b-a163-42e8460e5faa'
  ORDER BY created_at ASC
  LIMIT 1
)
UPDATE public.leave_policies
  SET deleted_at = now(), updated_at = now()
  WHERE leave_type = 'sick_leave'
    AND deleted_at IS NULL
    AND org_id = '0c0e516f-5896-4f3b-a163-42e8460e5faa'
    AND id NOT IN (SELECT id FROM sick_to_keep);

UPDATE public.leave_policies
  SET country_code = NULL,
      is_unlimited = true,
      default_days_per_year = 0,
      notes = 'Unlimited sick leave. Doctor''s note required after 2+ consecutive working days.',
      updated_at = now()
  WHERE leave_type = 'sick_leave'
    AND deleted_at IS NULL
    AND org_id = '0c0e516f-5896-4f3b-a163-42e8460e5faa';

-- 8. Fix birthday_leave: make org-wide (soft-delete duplicates, keep one)
WITH bday_to_keep AS (
  SELECT id FROM public.leave_policies
  WHERE leave_type = 'birthday_leave'
    AND deleted_at IS NULL
    AND org_id = '0c0e516f-5896-4f3b-a163-42e8460e5faa'
  ORDER BY created_at ASC
  LIMIT 1
)
UPDATE public.leave_policies
  SET deleted_at = now(), updated_at = now()
  WHERE leave_type = 'birthday_leave'
    AND deleted_at IS NULL
    AND org_id = '0c0e516f-5896-4f3b-a163-42e8460e5faa'
    AND id NOT IN (SELECT id FROM bday_to_keep);

UPDATE public.leave_policies
  SET country_code = NULL, updated_at = now()
  WHERE leave_type = 'birthday_leave'
    AND deleted_at IS NULL
    AND org_id = '0c0e516f-5896-4f3b-a163-42e8460e5faa';

-- 9. Insert personal_days leave type (5 days/year, org-wide)
--    Only if it doesn't already exist
INSERT INTO public.leave_policies (
  id, org_id, country_code, leave_type, default_days_per_year, accrual_type,
  carry_over, is_unlimited, notes, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  '0c0e516f-5896-4f3b-a163-42e8460e5faa',
  NULL,
  'personal_days',
  5,
  'annual_upfront',
  false,
  false,
  'For non-leisure obligations: moving, weddings, caring for loved ones, mental health days, doctor appointments.',
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.leave_policies
  WHERE leave_type = 'personal_days'
    AND deleted_at IS NULL
    AND org_id = '0c0e516f-5896-4f3b-a163-42e8460e5faa'
);

-- 10. Add new unique constraint: one policy per org per leave_type (org-wide only)
CREATE UNIQUE INDEX IF NOT EXISTS leave_policies_unique_org_type
  ON public.leave_policies (org_id, leave_type)
  WHERE deleted_at IS NULL AND country_code IS NULL;

-- 11. Drop the old country-based index, add new org-level index
DROP INDEX IF EXISTS idx_leave_policies_org_country;
CREATE INDEX IF NOT EXISTS idx_leave_policies_org
  ON public.leave_policies (org_id, leave_type)
  WHERE deleted_at IS NULL;

COMMIT;
