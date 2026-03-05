-- ═══════════════════════════════════════════════════════════════
-- Compliance Items Seed — All 5 Countries
-- Usage: Run with a valid org_id, e.g.:
--   \set org_id '''your-org-uuid-here'''
--   \i supabase/seeds/compliance-items.sql
-- Or replace the placeholder directly before running.
-- Uses INSERT ... ON CONFLICT DO NOTHING for idempotency.
-- ═══════════════════════════════════════════════════════════════

-- Helper: create a function that accepts org_id so this seed can
-- be called programmatically as well.

CREATE OR REPLACE FUNCTION public.seed_compliance_items(p_org_id uuid)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer := 0;
BEGIN

  -- ─────────────────────────────────────────────
  -- NIGERIA (NG) — 8 items
  -- ─────────────────────────────────────────────

  INSERT INTO public.compliance_items (org_id, country_code, authority, requirement, description, cadence, category)
  VALUES
    (p_org_id, 'NG', 'FIRS', 'PAYE remittance',
     'Monthly Pay As You Earn tax remittance to FIRS. Due by the 10th of the following month.',
     'monthly', 'tax'),

    (p_org_id, 'NG', 'PenCom/PFA', 'Pension contribution',
     'Employer (10%) + employee (8%) pension contributions to the employee''s PFA. Due within 7 days of salary payment.',
     'monthly', 'pension'),

    (p_org_id, 'NG', 'FMBN', 'National Housing Fund',
     '2.5% of employee''s basic salary deducted and remitted to Federal Mortgage Bank. Due by the 10th of the following month.',
     'monthly', 'housing_fund'),

    (p_org_id, 'NG', 'NSITF', 'NSITF contribution',
     '1% of total payroll remitted to Nigeria Social Insurance Trust Fund. Due by the 1st of the following month.',
     'monthly', 'insurance'),

    (p_org_id, 'NG', 'ITF', 'ITF levy',
     '1% of annual payroll cost remitted to Industrial Training Fund. Due by March 31 each year.',
     'annual', 'levy'),

    (p_org_id, 'NG', 'FIRS', 'FIRS annual returns',
     'Annual personal income tax returns for all employees. Due by June 30 each year.',
     'annual', 'tax'),

    (p_org_id, 'NG', 'FIRS', 'Annual payroll reconciliation',
     'Annual reconciliation of PAYE deductions and remittances. Attached to annual tax return.',
     'annual', 'tax'),

    (p_org_id, 'NG', 'Lagos State IRS', 'Business premises renewal',
     'Annual renewal of business premises permit. Due by March 31.',
     'annual', 'regulatory')
  ON CONFLICT DO NOTHING;

  -- ─────────────────────────────────────────────
  -- GHANA (GH) — 5 items
  -- ─────────────────────────────────────────────

  INSERT INTO public.compliance_items (org_id, country_code, authority, requirement, description, cadence, category)
  VALUES
    (p_org_id, 'GH', 'GRA', 'PAYE remittance',
     'Monthly PAYE remittance to Ghana Revenue Authority. Due by the 15th of the following month.',
     'monthly', 'tax'),

    (p_org_id, 'GH', 'SSNIT', 'SSNIT employer contribution',
     '13% employer SSNIT contribution on basic salary. Due by the 14th of the following month.',
     'monthly', 'pension'),

    (p_org_id, 'GH', 'SSNIT', 'SSNIT employee deduction',
     '5.5% employee SSNIT deduction remittance. Due by the 14th of the following month.',
     'monthly', 'pension'),

    (p_org_id, 'GH', 'GRA', 'Annual withholding tax return',
     'Annual withholding tax return for all employees. Due by April 30.',
     'annual', 'tax'),

    (p_org_id, 'GH', 'GRA', 'NHIL levy',
     'National Health Insurance Levy remittance. Due with PAYE.',
     'monthly', 'health')
  ON CONFLICT DO NOTHING;

  -- ─────────────────────────────────────────────
  -- SOUTH AFRICA (ZA) — 7 items
  -- ─────────────────────────────────────────────

  INSERT INTO public.compliance_items (org_id, country_code, authority, requirement, description, cadence, category)
  VALUES
    (p_org_id, 'ZA', 'SARS', 'PAYE EMP201',
     'Monthly PAYE employer return EMP201. Due by the 7th (manual) or 25th (eFiling) of the following month.',
     'monthly', 'tax'),

    (p_org_id, 'ZA', 'SARS', 'UIF contribution',
     'Unemployment Insurance Fund: 1% employer + 1% employee. Due with EMP201.',
     'monthly', 'insurance'),

    (p_org_id, 'ZA', 'SARS', 'SDL levy',
     'Skills Development Levy: 1% of monthly payroll. Due with EMP201.',
     'monthly', 'levy'),

    (p_org_id, 'ZA', 'SARS', 'Annual EMP501 reconciliation',
     'Annual employer reconciliation of PAYE, SDL, and UIF. Due by May 31.',
     'annual', 'tax'),

    (p_org_id, 'ZA', 'SARS', 'IRP5/IT3a certificates',
     'Employee tax certificates issued to all employees and submitted to SARS. Due by May 31.',
     'annual', 'tax'),

    (p_org_id, 'ZA', 'Compensation Fund', 'COIDA annual return',
     'Workmen''s Compensation annual return on payroll. Due by March 31.',
     'annual', 'insurance'),

    (p_org_id, 'ZA', 'DoEL', 'Employment Equity report',
     'Annual Employment Equity report for employers with 50+ employees. Due by January 15.',
     'annual', 'regulatory')
  ON CONFLICT DO NOTHING;

  -- ─────────────────────────────────────────────
  -- KENYA (KE) — 5 items
  -- ─────────────────────────────────────────────

  INSERT INTO public.compliance_items (org_id, country_code, authority, requirement, description, cadence, category)
  VALUES
    (p_org_id, 'KE', 'KRA', 'PAYE remittance',
     'Monthly PAYE remittance to Kenya Revenue Authority. Due by the 9th of the following month.',
     'monthly', 'tax'),

    (p_org_id, 'KE', 'NSSF', 'NSSF contribution',
     'National Social Security Fund: employer + employee contributions. Due by the 9th of the following month.',
     'monthly', 'pension'),

    (p_org_id, 'KE', 'NHIF', 'NHIF deduction',
     'National Hospital Insurance Fund employee deduction remittance. Due by the 9th of the following month.',
     'monthly', 'health'),

    (p_org_id, 'KE', 'KRA', 'Annual PAYE return',
     'Annual PAYE return with P9A forms for all employees. Due by end of February.',
     'annual', 'tax'),

    (p_org_id, 'KE', 'NITA', 'NITA levy',
     'National Industrial Training Authority levy on payroll. Due annually.',
     'annual', 'levy')
  ON CONFLICT DO NOTHING;

  -- ─────────────────────────────────────────────
  -- CANADA (CA) — 6 items
  -- ─────────────────────────────────────────────

  INSERT INTO public.compliance_items (org_id, country_code, authority, requirement, description, cadence, category)
  VALUES
    (p_org_id, 'CA', 'CRA', 'CPP deductions remittance',
     'Canada Pension Plan employer + employee deductions remittance. Frequency varies by payroll size; monthly is most common. Due by the 15th of the following month.',
     'monthly', 'pension'),

    (p_org_id, 'CA', 'CRA', 'EI deductions remittance',
     'Employment Insurance employer + employee premiums remittance. Same schedule as CPP.',
     'monthly', 'insurance'),

    (p_org_id, 'CA', 'CRA', 'Income tax withholding',
     'Federal + provincial income tax withholding remittance. Same schedule as CPP/EI.',
     'monthly', 'tax'),

    (p_org_id, 'CA', 'CRA', 'T4 slips to employees',
     'T4 information slips issued to all employees. Due by the last day of February.',
     'annual', 'reporting'),

    (p_org_id, 'CA', 'CRA', 'T4 Summary to CRA',
     'T4 Summary return submitted to Canada Revenue Agency. Due by the last day of February.',
     'annual', 'reporting'),

    (p_org_id, 'CA', 'Service Canada', 'Record of Employment',
     'ROE issued to employee within 5 days of any interruption in earnings (departure, leave, etc.).',
     'ongoing', 'reporting')
  ON CONFLICT DO NOTHING;

  -- Count total inserted
  SELECT count(*) INTO v_count
  FROM public.compliance_items
  WHERE org_id = p_org_id AND deleted_at IS NULL;

  RETURN v_count;
END;
$$;

-- To seed for a specific org, call:
-- SELECT public.seed_compliance_items('your-org-uuid-here'::uuid);
