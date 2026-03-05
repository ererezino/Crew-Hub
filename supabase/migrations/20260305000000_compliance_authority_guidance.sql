-- PROD-21: Add authority_url and local_guidance columns to compliance_items
-- These columns store per-country regulatory guidance and links to authority portals.

ALTER TABLE compliance_items
  ADD COLUMN IF NOT EXISTS authority_url text,
  ADD COLUMN IF NOT EXISTS local_guidance text;

-- Backfill authority URLs and local guidance for existing seed data.
-- Nigeria (NG)
UPDATE compliance_items SET
  authority_url = 'https://www.firs.gov.ng',
  local_guidance = 'Pay As You Earn (PAYE) is the income tax withheld from employee salaries and remitted to the Federal Inland Revenue Service (FIRS). Due monthly by the 10th. HR or Finance typically handles the remittance via the FIRS TaxPro Max portal.'
WHERE country_code = 'NG' AND requirement ILIKE '%PAYE%' AND authority_url IS NULL;

UPDATE compliance_items SET
  authority_url = 'https://www.pencom.gov.ng',
  local_guidance = 'Pension contributions under the Pension Reform Act. Employer contributes a minimum of 10% and employee 8% of basic salary, housing, and transport. Remit monthly to the employee''s chosen Pension Fund Administrator (PFA) via the PenCom portal.'
WHERE country_code = 'NG' AND requirement ILIKE '%pension%' AND authority_url IS NULL;

UPDATE compliance_items SET
  authority_url = 'https://www.fmbn.gov.ng',
  local_guidance = 'National Housing Fund contribution. Employees earning above the threshold contribute 2.5% of basic salary. Remit monthly to the Federal Mortgage Bank of Nigeria. Managed by HR/Payroll.'
WHERE country_code = 'NG' AND requirement ILIKE '%NHF%' AND authority_url IS NULL;

UPDATE compliance_items SET
  authority_url = 'https://www.nsitf.gov.ng',
  local_guidance = 'Nigeria Social Insurance Trust Fund contribution for employee compensation. Employer pays 1% of monthly payroll. Remit via the NSITF portal or designated bank.'
WHERE country_code = 'NG' AND requirement ILIKE '%NSITF%' AND authority_url IS NULL;

UPDATE compliance_items SET
  authority_url = 'https://www.itf.gov.ng',
  local_guidance = 'Industrial Training Fund levy. Employers with 5+ employees or turnover above threshold pay 1% of annual payroll. Filed annually with the ITF.'
WHERE country_code = 'NG' AND requirement ILIKE '%ITF%' AND authority_url IS NULL;

-- Ghana (GH)
UPDATE compliance_items SET
  authority_url = 'https://gra.gov.gh',
  local_guidance = 'PAYE is the income tax deducted from employee salaries and remitted to the Ghana Revenue Authority (GRA). Due by the 15th of the following month. File via the GRA Taxpayer Portal.'
WHERE country_code = 'GH' AND requirement ILIKE '%PAYE%' AND authority_url IS NULL;

UPDATE compliance_items SET
  authority_url = 'https://www.ssnit.org.gh',
  local_guidance = 'Social Security and National Insurance Trust (SSNIT) contributions. Employer pays 13% and employee pays 5.5% of basic salary. Remit monthly to SSNIT by the 14th of the following month.'
WHERE country_code = 'GH' AND requirement ILIKE '%SSNIT%' AND authority_url IS NULL;

-- South Africa (ZA)
UPDATE compliance_items SET
  authority_url = 'https://www.sars.gov.za',
  local_guidance = 'EMP201 is the Monthly Employer Declaration submitted to SARS. It covers PAYE, SDL (Skills Development Levy), and UIF (Unemployment Insurance Fund) contributions. Due by the 7th of the following month via SARS eFiling.'
WHERE country_code = 'ZA' AND requirement ILIKE '%EMP201%' AND authority_url IS NULL;

UPDATE compliance_items SET
  authority_url = 'https://www.ufiling.co.za',
  local_guidance = 'Unemployment Insurance Fund contributions. Both employer and employee contribute 1% of remuneration (2% total). Remit monthly via uFiling portal or included in EMP201.'
WHERE country_code = 'ZA' AND requirement ILIKE '%UIF%' AND authority_url IS NULL;

UPDATE compliance_items SET
  authority_url = 'https://www.sars.gov.za',
  local_guidance = 'Skills Development Levy. Employers with annual payroll exceeding R500,000 pay 1% of total remuneration. Included in the monthly EMP201 submission to SARS.'
WHERE country_code = 'ZA' AND requirement ILIKE '%SDL%' AND authority_url IS NULL;

-- Kenya (KE)
UPDATE compliance_items SET
  authority_url = 'https://www.kra.go.ke',
  local_guidance = 'Pay As You Earn deducted from employee salaries per Kenya Revenue Authority rates. Due by the 9th of the following month. File and remit via KRA iTax portal.'
WHERE country_code = 'KE' AND requirement ILIKE '%PAYE%' AND authority_url IS NULL;

UPDATE compliance_items SET
  authority_url = 'https://www.nssf.or.ke',
  local_guidance = 'National Social Security Fund contributions. Both employer and employee contribute. Remit monthly by the 15th via the NSSF portal. Rates set by the NSSF Act.'
WHERE country_code = 'KE' AND requirement ILIKE '%NSSF%' AND authority_url IS NULL;

UPDATE compliance_items SET
  authority_url = 'https://www.nhif.or.ke',
  local_guidance = 'National Hospital Insurance Fund contribution. Employee-borne contribution based on salary bands. Employer deducts and remits monthly to NHIF by the 9th of the following month.'
WHERE country_code = 'KE' AND requirement ILIKE '%NHIF%' AND authority_url IS NULL;

-- Canada (CA)
UPDATE compliance_items SET
  authority_url = 'https://www.canada.ca/en/revenue-agency.html',
  local_guidance = 'Canada Pension Plan contributions. Both employer and employee contribute. Remit to CRA along with income tax source deductions. Due by the 15th of the following month for most employers.'
WHERE country_code = 'CA' AND requirement ILIKE '%CPP%' AND authority_url IS NULL;

UPDATE compliance_items SET
  authority_url = 'https://www.canada.ca/en/revenue-agency.html',
  local_guidance = 'Employment Insurance premiums. Employer pays 1.4x the employee rate. Remit to CRA with other source deductions by the 15th of the following month.'
WHERE country_code = 'CA' AND requirement ILIKE '%EI %' AND authority_url IS NULL;
