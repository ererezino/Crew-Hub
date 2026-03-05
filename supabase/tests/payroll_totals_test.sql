-- Regression test: recalculate_payroll_run_totals accumulates deductions across items
-- Verifies fix for TECH-1 where v_total_deductions was overwritten per iteration.

BEGIN;

-- 1. Create a test org
INSERT INTO organizations (id, name) VALUES
  ('00000000-0000-0000-0000-000000000099', 'Test Org Payroll')
ON CONFLICT (id) DO NOTHING;

-- 2. Create a draft payroll run
INSERT INTO payroll_runs (id, org_id, period_label, status, pay_date, total_gross, total_net)
VALUES (
  '00000000-0000-0000-0000-aaaaaaaaaaaa',
  '00000000-0000-0000-0000-000000000099',
  'Test Run',
  'draft',
  CURRENT_DATE,
  0,
  '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- 3. Insert 3 payroll items with different deduction amounts
INSERT INTO payroll_items (id, payroll_run_id, org_id, employee_id, gross_amount, net_amount, pay_currency, deductions)
VALUES
  (
    '00000000-0000-0000-0000-bbbbbbbbbb01',
    '00000000-0000-0000-0000-aaaaaaaaaaaa',
    '00000000-0000-0000-0000-000000000099',
    '00000000-0000-0000-0000-000000000001',
    50000, 40000, 'USD',
    '{"tax": 8000, "pension": 2000}'::jsonb
  ),
  (
    '00000000-0000-0000-0000-bbbbbbbbbb02',
    '00000000-0000-0000-0000-aaaaaaaaaaaa',
    '00000000-0000-0000-0000-000000000099',
    '00000000-0000-0000-0000-000000000002',
    60000, 47000, 'USD',
    '{"tax": 10000, "pension": 3000}'::jsonb
  ),
  (
    '00000000-0000-0000-0000-bbbbbbbbbb03',
    '00000000-0000-0000-0000-aaaaaaaaaaaa',
    '00000000-0000-0000-0000-000000000099',
    '00000000-0000-0000-0000-000000000003',
    40000, 34000, 'USD',
    '{"tax": 4000, "pension": 2000}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

-- 4. Call the RPC
SELECT recalculate_payroll_run_totals('00000000-0000-0000-0000-aaaaaaaaaaaa') AS result;

-- 5. Assert totals
-- Expected: gross = 150000, net = 121000, deductions = 29000 (10000 + 13000 + 6000)
DO $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT recalculate_payroll_run_totals('00000000-0000-0000-0000-aaaaaaaaaaaa') INTO v_result;

  ASSERT (v_result ->> 'total_gross')::NUMERIC = 150000,
    'total_gross mismatch: expected 150000, got ' || (v_result ->> 'total_gross');

  ASSERT (v_result ->> 'total_deductions')::NUMERIC = 29000,
    'total_deductions mismatch: expected 29000 (accumulated across 3 items), got ' || (v_result ->> 'total_deductions');

  ASSERT (v_result -> 'total_net' ->> 'USD')::NUMERIC = 121000,
    'total_net USD mismatch: expected 121000, got ' || (v_result -> 'total_net' ->> 'USD');

  RAISE NOTICE 'PASS: recalculate_payroll_run_totals accumulates correctly across items';
END $$;

ROLLBACK;
