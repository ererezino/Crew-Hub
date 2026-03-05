-- =============================================================================
-- Data Integrity Checks
-- =============================================================================
-- A collection of diagnostic queries for spotting referential, logical, and
-- workflow inconsistencies across the Crew Hub database.
--
-- Run ad-hoc against the production or staging database.  Every query returns
-- rows only when an anomaly exists; an empty result set means the check passes.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. Payroll run totals mismatch
-- ---------------------------------------------------------------------------
-- Compare the SUM of net_amount across payroll_items for each payroll run
-- against the total_net JSONB stored on the payroll_runs row.
--
-- total_net is a JSONB object keyed by currency (e.g. {"USD": 450000}).
-- payroll_items.net_amount is stored in minor units (bigint) with a currency
-- column.  We aggregate items per run per currency and compare.
-- ---------------------------------------------------------------------------

WITH item_totals AS (
  SELECT
    pi.payroll_run_id,
    pi.currency,
    SUM(pi.net_amount)  AS sum_net_amount
  FROM public.payroll_items pi
  WHERE pi.deleted_at IS NULL
  GROUP BY pi.payroll_run_id, pi.currency
),
run_totals AS (
  SELECT
    pr.id              AS payroll_run_id,
    kv.key             AS currency,
    kv.value::bigint   AS declared_net
  FROM public.payroll_runs pr,
       LATERAL jsonb_each_text(pr.total_net) AS kv
  WHERE pr.deleted_at IS NULL
)
SELECT
  rt.payroll_run_id,
  rt.currency,
  rt.declared_net       AS run_total_net,
  COALESCE(it.sum_net_amount, 0) AS items_sum_net,
  rt.declared_net - COALESCE(it.sum_net_amount, 0) AS difference
FROM run_totals rt
LEFT JOIN item_totals it
  ON it.payroll_run_id = rt.payroll_run_id
 AND it.currency       = rt.currency
WHERE rt.declared_net <> COALESCE(it.sum_net_amount, 0)
ORDER BY rt.payroll_run_id, rt.currency;


-- ---------------------------------------------------------------------------
-- 2. Expenses stuck after manager approval for 7+ days
-- ---------------------------------------------------------------------------
-- Expenses with status = 'manager_approved' whose manager_approved_at
-- timestamp is more than 7 days old.  These should have been picked up by
-- finance for final approval or reimbursement.
-- ---------------------------------------------------------------------------

SELECT
  e.id             AS expense_id,
  e.org_id,
  e.employee_id,
  e.description,
  e.amount,
  e.currency,
  e.status,
  e.manager_approved_at,
  NOW() - e.manager_approved_at  AS time_since_manager_approval
FROM public.expenses e
WHERE e.status = 'manager_approved'
  AND e.manager_approved_at IS NOT NULL
  AND e.manager_approved_at < NOW() - INTERVAL '7 days'
  AND e.deleted_at IS NULL
ORDER BY e.manager_approved_at ASC;


-- ---------------------------------------------------------------------------
-- 3. Signature requests marked complete with unsigned signers
-- ---------------------------------------------------------------------------
-- A signature_request with status = 'completed' should have every associated
-- signer in 'signed' status.  This query surfaces completed requests that
-- still have at least one signer whose status is not 'signed'.
-- ---------------------------------------------------------------------------

SELECT
  sr.id              AS signature_request_id,
  sr.org_id,
  sr.title,
  sr.status          AS request_status,
  sr.completed_at,
  ss.id              AS signer_id,
  ss.signer_user_id,
  ss.status          AS signer_status,
  ss.signed_at
FROM public.signature_requests sr
JOIN public.signature_signers ss
  ON ss.signature_request_id = sr.id
 AND ss.deleted_at IS NULL
WHERE sr.status = 'completed'
  AND sr.deleted_at IS NULL
  AND ss.status <> 'signed'
ORDER BY sr.id, ss.signer_order;


-- ---------------------------------------------------------------------------
-- 4. Cross-org manager references
-- ---------------------------------------------------------------------------
-- Every employee's manager_id should point to a profile in the same org.
-- This query finds profiles whose manager belongs to a different organisation.
-- ---------------------------------------------------------------------------

SELECT
  emp.id             AS employee_id,
  emp.full_name      AS employee_name,
  emp.org_id         AS employee_org_id,
  emp.manager_id,
  mgr.full_name      AS manager_name,
  mgr.org_id         AS manager_org_id
FROM public.profiles emp
JOIN public.profiles mgr
  ON mgr.id = emp.manager_id
WHERE emp.manager_id IS NOT NULL
  AND emp.deleted_at IS NULL
  AND mgr.deleted_at IS NULL
  AND emp.org_id <> mgr.org_id
ORDER BY emp.org_id, emp.full_name;


-- ---------------------------------------------------------------------------
-- 5. Active contractors missing payout setup
-- ---------------------------------------------------------------------------
-- Active profiles with employment_type = 'contractor' that have no primary
-- employee_payment_details record.  Without a payment method on file these
-- contractors cannot be included in a payment batch.
-- ---------------------------------------------------------------------------

SELECT
  p.id               AS profile_id,
  p.full_name,
  p.email,
  p.org_id,
  p.employment_type,
  p.status
FROM public.profiles p
WHERE p.employment_type = 'contractor'
  AND p.status = 'active'
  AND p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.employee_payment_details epd
    WHERE epd.employee_id = p.id
      AND epd.is_primary = true
      AND epd.deleted_at IS NULL
  )
ORDER BY p.org_id, p.full_name;
