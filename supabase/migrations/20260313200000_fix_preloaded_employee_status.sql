-- Fix preloaded existing employees who were incorrectly marked as "onboarding".
--
-- Phase 1 (automated, zero false-positive risk):
-- Corrects employees provably created via bulk upload OR explicitly marked
-- as existing employees in the single-create flow.
--
-- Phase 2 (manual admin review):
-- Remaining ambiguous cases are left for admin review using the Edit panel.
--
-- This migration is idempotent — running it twice has no effect.

-- Step 1: Cancel orphaned onboarding instances for bulk-uploaded
-- or explicitly-existing employees whose tasks have not been started.
UPDATE onboarding_instances oi
SET status = 'cancelled', completed_at = now(), updated_at = now()
WHERE oi.status = 'active'
  AND oi.employee_id IN (
    SELECT al.record_id::uuid
    FROM audit_log al
    WHERE al.action = 'created'
      AND al.table_name = 'profiles'
      AND (
        al.new_value->>'source' = 'bulk_upload'
        OR (al.new_value->>'isNewEmployee')::text = 'false'
      )
  )
  -- Extra safety: only cancel if no task has been started
  AND NOT EXISTS (
    SELECT 1 FROM onboarding_tasks ot
    WHERE ot.instance_id = oi.id AND ot.status != 'pending'
  );

-- Step 2: Set status to 'active' for these employees (only those still
-- in 'onboarding' — idempotent because already-active rows are skipped).
UPDATE profiles p
SET status = 'active', updated_at = now()
WHERE p.status = 'onboarding'
  AND EXISTS (
    SELECT 1 FROM audit_log al
    WHERE al.record_id::uuid = p.id
      AND al.action = 'created'
      AND al.table_name = 'profiles'
      AND (
        al.new_value->>'source' = 'bulk_upload'
        OR (al.new_value->>'isNewEmployee')::text = 'false'
      )
  );
