-- Travel support workflow v2: multi-country + HR draft + signature steps
-- New flow: pending → hr_draft → pending_signature → approved/rejected

-- 1. Add destination_countries array column
ALTER TABLE public.travel_support_requests
  ADD COLUMN IF NOT EXISTS destination_countries TEXT[] DEFAULT '{}';

-- 2. Migrate existing single country to array
UPDATE public.travel_support_requests
  SET destination_countries = ARRAY[destination_country]
  WHERE destination_country IS NOT NULL AND destination_countries = '{}';

-- 3. Add HR draft fields
ALTER TABLE public.travel_support_requests
  ADD COLUMN IF NOT EXISTS hr_drafted_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS hr_drafted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS letter_body TEXT;

-- 4. Drop the old enum type constraint and replace with text + check
-- First, change the column type from enum to text
ALTER TABLE public.travel_support_requests
  ALTER COLUMN status TYPE TEXT USING status::TEXT;

-- Drop the old enum type (cascade drops nothing since the column is already text)
DROP TYPE IF EXISTS travel_letter_status;

-- Add a check constraint for the expanded statuses
ALTER TABLE public.travel_support_requests
  DROP CONSTRAINT IF EXISTS travel_support_requests_status_check;

ALTER TABLE public.travel_support_requests
  ADD CONSTRAINT travel_support_requests_status_check
  CHECK (status IN ('pending', 'hr_draft', 'pending_signature', 'approved', 'rejected'));

-- 5. Default remains 'pending'
ALTER TABLE public.travel_support_requests
  ALTER COLUMN status SET DEFAULT 'pending';
