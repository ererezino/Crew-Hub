-- Normalize legacy leave_type short forms to canonical _leave suffixed forms
-- across all time-off tables for consistency with application constants.
--
-- Edge case: org may already have both "annual" AND "annual_leave" policies
-- for the same country. In that case, soft-delete the duplicate "annual" row.

BEGIN;

-- 1. leave_policies --

-- "sick" → "sick_leave" (no conflicts expected)
UPDATE public.leave_policies
  SET leave_type = 'sick_leave', updated_at = now()
  WHERE leave_type = 'sick'
    AND NOT EXISTS (
      SELECT 1 FROM public.leave_policies lp2
      WHERE lp2.org_id = leave_policies.org_id
        AND lp2.country_code = leave_policies.country_code
        AND lp2.leave_type = 'sick_leave'
        AND lp2.deleted_at IS NULL
    );

-- "annual" → soft-delete if "annual_leave" already exists for same org+country
UPDATE public.leave_policies
  SET deleted_at = now(), updated_at = now()
  WHERE leave_type = 'annual'
    AND EXISTS (
      SELECT 1 FROM public.leave_policies lp2
      WHERE lp2.org_id = leave_policies.org_id
        AND lp2.country_code = leave_policies.country_code
        AND lp2.leave_type = 'annual_leave'
        AND lp2.deleted_at IS NULL
    );

-- "annual" → rename if no "annual_leave" exists
UPDATE public.leave_policies
  SET leave_type = 'annual_leave', updated_at = now()
  WHERE leave_type = 'annual'
    AND deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.leave_policies lp2
      WHERE lp2.org_id = leave_policies.org_id
        AND lp2.country_code = leave_policies.country_code
        AND lp2.leave_type = 'annual_leave'
        AND lp2.deleted_at IS NULL
    );

-- 2. leave_balances --

-- "sick" → "sick_leave"
UPDATE public.leave_balances
  SET leave_type = 'sick_leave', updated_at = now()
  WHERE leave_type = 'sick'
    AND NOT EXISTS (
      SELECT 1 FROM public.leave_balances lb2
      WHERE lb2.employee_id = leave_balances.employee_id
        AND lb2.leave_type = 'sick_leave'
        AND lb2.year = leave_balances.year
    );

-- For "annual" balances where "annual_leave" already exists: merge used/pending into annual_leave, then soft-delete
UPDATE public.leave_balances AS target
  SET
    used_days = target.used_days + source.used_days,
    pending_days = target.pending_days + source.pending_days,
    updated_at = now()
  FROM public.leave_balances AS source
  WHERE source.employee_id = target.employee_id
    AND source.year = target.year
    AND source.leave_type = 'annual'
    AND target.leave_type = 'annual_leave'
    AND source.deleted_at IS NULL
    AND target.deleted_at IS NULL;

UPDATE public.leave_balances
  SET deleted_at = now(), updated_at = now()
  WHERE leave_type = 'annual'
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.leave_balances lb2
      WHERE lb2.employee_id = leave_balances.employee_id
        AND lb2.leave_type = 'annual_leave'
        AND lb2.year = leave_balances.year
        AND lb2.deleted_at IS NULL
    );

-- "annual" → rename where no conflict
UPDATE public.leave_balances
  SET leave_type = 'annual_leave', updated_at = now()
  WHERE leave_type = 'annual'
    AND deleted_at IS NULL;

-- 3. leave_requests (no uniqueness constraint on leave_type — safe to rename all)
UPDATE public.leave_requests
  SET leave_type = 'sick_leave', updated_at = now()
  WHERE leave_type = 'sick';

UPDATE public.leave_requests
  SET leave_type = 'annual_leave', updated_at = now()
  WHERE leave_type = 'annual';

COMMIT;
