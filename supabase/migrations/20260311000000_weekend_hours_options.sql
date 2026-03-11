-- ---------------------------------------------------------------------------
-- Expand weekend_hours from (full, part) to (2, 3, 4, 8) — numeric hour values
-- ---------------------------------------------------------------------------

-- 1. Migrate existing data in schedule_roster
UPDATE schedule_roster SET weekend_hours = '8' WHERE weekend_hours = 'full';
UPDATE schedule_roster SET weekend_hours = '4' WHERE weekend_hours = 'part';

-- 2. Drop old constraint on schedule_roster and add new one
ALTER TABLE schedule_roster DROP CONSTRAINT IF EXISTS schedule_roster_weekend_hours_check;
ALTER TABLE schedule_roster ADD CONSTRAINT schedule_roster_weekend_hours_check
  CHECK (weekend_hours IN ('2', '3', '4', '8'));

-- 3. Migrate existing data in profiles
UPDATE profiles SET weekend_shift_hours = '8' WHERE weekend_shift_hours = 'full';
UPDATE profiles SET weekend_shift_hours = '4' WHERE weekend_shift_hours = 'part';

-- 4. Drop old constraint on profiles and add new one
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_weekend_shift_hours_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_weekend_shift_hours_check
  CHECK (weekend_shift_hours IN ('2', '3', '4', '8'));

-- 5. Update default values
ALTER TABLE profiles ALTER COLUMN weekend_shift_hours SET DEFAULT '8';
ALTER TABLE schedule_roster ALTER COLUMN weekend_hours SET DEFAULT NULL;
