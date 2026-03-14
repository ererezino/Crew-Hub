-- Fix: the pre_start_contracts migration dropped the wrong constraint name.
-- The original constraint is "profiles_employee_type_check" (not "profiles_employee_type_at_creation_check").
-- Also drop the incorrectly-named constraint that was added.

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_employee_type_at_creation_check;

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_employee_type_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_employee_type_check
  CHECK (employee_type_at_creation IN ('new_hire', 'existing', 'pre_start'));
