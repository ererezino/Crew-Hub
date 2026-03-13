-- Onboarding dual-track system + employee type at creation
begin;

-- 1. Add track column to onboarding_tasks
-- Defaults to 'employee' so existing tasks remain assigned to the employee track.
ALTER TABLE onboarding_tasks
  ADD COLUMN IF NOT EXISTS track VARCHAR(20) NOT NULL DEFAULT 'employee';

-- Add CHECK constraint (separate statement for IF NOT EXISTS compatibility)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_tasks_track_check'
  ) THEN
    ALTER TABLE onboarding_tasks
      ADD CONSTRAINT onboarding_tasks_track_check
      CHECK (track IN ('employee', 'operations'));
  END IF;
END$$;

-- Index for per-track progress queries
CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_instance_track
  ON onboarding_tasks (instance_id, track);

-- 2. Add employee_type_at_creation to profiles
-- Set once at creation, never changes. Answers: "Was this person onboarded as
-- a new hire or preloaded as an existing employee?"
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS employee_type_at_creation VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_employee_type_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_employee_type_check
      CHECK (employee_type_at_creation IN ('new_hire', 'existing'));
  END IF;
END$$;

-- 3. Add acknowledged_version to policy_acknowledgments for version tracking
ALTER TABLE policy_acknowledgments
  ADD COLUMN IF NOT EXISTS acknowledged_version INTEGER;

-- 4. Add sign-off metadata to compliance_policies
ALTER TABLE compliance_policies
  ADD COLUMN IF NOT EXISTS signed_by_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS signed_by_title VARCHAR(200),
  ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;

commit;
