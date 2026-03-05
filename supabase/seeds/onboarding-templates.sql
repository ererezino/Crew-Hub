-- System default onboarding templates for all 5 countries
-- These are identified by is_system_default = true and org_id IS NULL

-- Universal default template (all countries)
INSERT INTO onboarding_templates (id, org_id, name, type, country_code, department, is_system_default, tasks, created_at, updated_at)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  NULL,
  'Universal Onboarding',
  'onboarding',
  NULL,
  NULL,
  TRUE,
  '[
    {"title": "Upload government-issued ID", "description": "Upload a scan or photo of your government-issued identification document.", "category": "Documentation", "dueOffsetDays": 3},
    {"title": "Upload proof of address", "description": "Upload a recent utility bill or bank statement showing your current address.", "category": "Documentation", "dueOffsetDays": 5},
    {"title": "Complete emergency contact form", "description": "Provide details for your emergency contact person.", "category": "Documentation", "dueOffsetDays": 3},
    {"title": "Enter bank account details for payroll", "description": "Add your bank account information for salary payments.", "category": "Payroll & Finance", "dueOffsetDays": 5, "taskType": "link", "linkUrl": "/me/pay?tab=payment-details"},
    {"title": "Confirm tax identification number", "description": "Verify your tax identification number is on file.", "category": "Payroll & Finance", "dueOffsetDays": 5},
    {"title": "Review your compensation summary", "description": "Review your salary breakdown and benefits.", "category": "Payroll & Finance", "dueOffsetDays": 7, "taskType": "link", "linkUrl": "/me/pay?tab=compensation"},
    {"title": "Set up profile photo and bio", "description": "Add a profile photo and write a short bio to introduce yourself to the team.", "category": "Company Setup", "dueOffsetDays": 3, "taskType": "link", "linkUrl": "/settings?tab=profile"},
    {"title": "Review and accept data privacy policy", "description": "Read and sign the company data privacy policy.", "category": "Company Setup", "dueOffsetDays": 5, "taskType": "e_signature"},
    {"title": "Complete security training", "description": "Complete the mandatory security awareness training course.", "category": "Company Setup", "dueOffsetDays": 14, "taskType": "link", "linkUrl": "/learning"},
    {"title": "Review the employee handbook", "description": "Read through the employee handbook for company policies and procedures.", "category": "Company Setup", "dueOffsetDays": 7, "taskType": "e_signature"},
    {"title": "Schedule a 1:1 with your manager", "description": "Set up an introductory meeting with your direct manager.", "category": "First Week", "dueOffsetDays": 5},
    {"title": "Meet your team", "description": "Arrange introductions with your immediate team members.", "category": "First Week", "dueOffsetDays": 5}
  ]'::jsonb,
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  tasks = EXCLUDED.tasks,
  is_system_default = TRUE,
  updated_at = NOW();

-- Nigeria onboarding template
INSERT INTO onboarding_templates (id, org_id, name, type, country_code, department, is_system_default, tasks, created_at, updated_at)
VALUES (
  'a0000000-0000-0000-0000-000000000002',
  NULL,
  'Nigeria Onboarding',
  'onboarding',
  'NG',
  NULL,
  TRUE,
  '[
    {"title": "Upload government-issued ID", "description": "Upload a scan or photo of your NIN slip, international passport, or drivers licence.", "category": "Documentation", "dueOffsetDays": 3},
    {"title": "Upload proof of address", "description": "Upload a recent utility bill or bank statement showing your current address.", "category": "Documentation", "dueOffsetDays": 5},
    {"title": "Complete emergency contact form", "description": "Provide details for your emergency contact person.", "category": "Documentation", "dueOffsetDays": 3},
    {"title": "Enter bank account details for payroll", "description": "Add your Nigerian bank account information for salary payments.", "category": "Payroll & Finance", "dueOffsetDays": 5, "taskType": "link", "linkUrl": "/me/pay?tab=payment-details"},
    {"title": "Confirm tax identification number", "description": "Verify your TIN is on file with the Federal Inland Revenue Service.", "category": "Payroll & Finance", "dueOffsetDays": 5},
    {"title": "Submit NHF registration details", "description": "Provide your National Housing Fund registration details.", "category": "Payroll & Finance", "dueOffsetDays": 10},
    {"title": "Provide PENCOM RSA PIN", "description": "Submit your Pension Commission Retirement Savings Account PIN.", "category": "Payroll & Finance", "dueOffsetDays": 10},
    {"title": "Confirm NSITF registration", "description": "Confirm your Nigeria Social Insurance Trust Fund registration.", "category": "Payroll & Finance", "dueOffsetDays": 10},
    {"title": "Review your compensation summary", "description": "Review your salary breakdown and benefits.", "category": "Payroll & Finance", "dueOffsetDays": 7, "taskType": "link", "linkUrl": "/me/pay?tab=compensation"},
    {"title": "Set up profile photo and bio", "description": "Add a profile photo and write a short bio.", "category": "Company Setup", "dueOffsetDays": 3, "taskType": "link", "linkUrl": "/settings?tab=profile"},
    {"title": "Review and accept data privacy policy", "description": "Read and sign the company data privacy policy.", "category": "Company Setup", "dueOffsetDays": 5, "taskType": "e_signature"},
    {"title": "Complete security training", "description": "Complete the mandatory security awareness training course.", "category": "Company Setup", "dueOffsetDays": 14, "taskType": "link", "linkUrl": "/learning"},
    {"title": "Review the employee handbook", "description": "Read through the employee handbook.", "category": "Company Setup", "dueOffsetDays": 7, "taskType": "e_signature"},
    {"title": "Schedule a 1:1 with your manager", "description": "Set up an introductory meeting with your direct manager.", "category": "First Week", "dueOffsetDays": 5},
    {"title": "Meet your team", "description": "Arrange introductions with your immediate team members.", "category": "First Week", "dueOffsetDays": 5}
  ]'::jsonb,
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  tasks = EXCLUDED.tasks,
  is_system_default = TRUE,
  updated_at = NOW();

-- Ghana onboarding template
INSERT INTO onboarding_templates (id, org_id, name, type, country_code, department, is_system_default, tasks, created_at, updated_at)
VALUES (
  'a0000000-0000-0000-0000-000000000003',
  NULL,
  'Ghana Onboarding',
  'onboarding',
  'GH',
  NULL,
  TRUE,
  '[
    {"title": "Upload government-issued ID", "description": "Upload a scan of your Ghana Card or passport.", "category": "Documentation", "dueOffsetDays": 3},
    {"title": "Upload proof of address", "description": "Upload a recent utility bill showing your current address.", "category": "Documentation", "dueOffsetDays": 5},
    {"title": "Complete emergency contact form", "description": "Provide details for your emergency contact.", "category": "Documentation", "dueOffsetDays": 3},
    {"title": "Enter bank account details for payroll", "description": "Add your bank account for salary payments.", "category": "Payroll & Finance", "dueOffsetDays": 5, "taskType": "link", "linkUrl": "/me/pay?tab=payment-details"},
    {"title": "Provide SSNIT number", "description": "Submit your Social Security and National Insurance Trust number.", "category": "Payroll & Finance", "dueOffsetDays": 10},
    {"title": "Confirm Ghana Revenue Authority TIN", "description": "Verify your Ghana Revenue Authority Tax Identification Number.", "category": "Payroll & Finance", "dueOffsetDays": 10},
    {"title": "Review your compensation summary", "description": "Review your salary breakdown and benefits.", "category": "Payroll & Finance", "dueOffsetDays": 7, "taskType": "link", "linkUrl": "/me/pay?tab=compensation"},
    {"title": "Set up profile photo and bio", "description": "Add a profile photo and write a short bio.", "category": "Company Setup", "dueOffsetDays": 3, "taskType": "link", "linkUrl": "/settings?tab=profile"},
    {"title": "Review and accept data privacy policy", "description": "Read and sign the company data privacy policy.", "category": "Company Setup", "dueOffsetDays": 5, "taskType": "e_signature"},
    {"title": "Complete security training", "description": "Complete the mandatory security awareness training course.", "category": "Company Setup", "dueOffsetDays": 14, "taskType": "link", "linkUrl": "/learning"},
    {"title": "Review the employee handbook", "description": "Read through the employee handbook.", "category": "Company Setup", "dueOffsetDays": 7, "taskType": "e_signature"},
    {"title": "Schedule a 1:1 with your manager", "description": "Set up an introductory meeting with your direct manager.", "category": "First Week", "dueOffsetDays": 5},
    {"title": "Meet your team", "description": "Arrange introductions with your team.", "category": "First Week", "dueOffsetDays": 5}
  ]'::jsonb,
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  tasks = EXCLUDED.tasks,
  is_system_default = TRUE,
  updated_at = NOW();

-- South Africa onboarding template
INSERT INTO onboarding_templates (id, org_id, name, type, country_code, department, is_system_default, tasks, created_at, updated_at)
VALUES (
  'a0000000-0000-0000-0000-000000000004',
  NULL,
  'South Africa Onboarding',
  'onboarding',
  'ZA',
  NULL,
  TRUE,
  '[
    {"title": "Upload government-issued ID", "description": "Upload a scan of your South African ID or passport.", "category": "Documentation", "dueOffsetDays": 3},
    {"title": "Upload proof of address", "description": "Upload a recent utility bill or bank statement.", "category": "Documentation", "dueOffsetDays": 5},
    {"title": "Complete emergency contact form", "description": "Provide details for your emergency contact.", "category": "Documentation", "dueOffsetDays": 3},
    {"title": "Enter bank account details for payroll", "description": "Add your bank account for salary payments.", "category": "Payroll & Finance", "dueOffsetDays": 5, "taskType": "link", "linkUrl": "/me/pay?tab=payment-details"},
    {"title": "Provide UIF registration details", "description": "Submit your Unemployment Insurance Fund registration details.", "category": "Payroll & Finance", "dueOffsetDays": 10},
    {"title": "Submit tax directive if applicable", "description": "Submit your IT3a tax directive if applicable to your employment.", "category": "Payroll & Finance", "dueOffsetDays": 10},
    {"title": "Confirm Skills Development Levy registration", "description": "Confirm your Skills Development Levy registration status.", "category": "Payroll & Finance", "dueOffsetDays": 10},
    {"title": "Review your compensation summary", "description": "Review your salary breakdown and benefits.", "category": "Payroll & Finance", "dueOffsetDays": 7, "taskType": "link", "linkUrl": "/me/pay?tab=compensation"},
    {"title": "Set up profile photo and bio", "description": "Add a profile photo and write a short bio.", "category": "Company Setup", "dueOffsetDays": 3, "taskType": "link", "linkUrl": "/settings?tab=profile"},
    {"title": "Review and accept data privacy policy", "description": "Read and sign the company data privacy policy.", "category": "Company Setup", "dueOffsetDays": 5, "taskType": "e_signature"},
    {"title": "Complete security training", "description": "Complete the mandatory security awareness training.", "category": "Company Setup", "dueOffsetDays": 14, "taskType": "link", "linkUrl": "/learning"},
    {"title": "Review the employee handbook", "description": "Read through the employee handbook.", "category": "Company Setup", "dueOffsetDays": 7, "taskType": "e_signature"},
    {"title": "Schedule a 1:1 with your manager", "description": "Set up an introductory meeting with your manager.", "category": "First Week", "dueOffsetDays": 5},
    {"title": "Meet your team", "description": "Arrange introductions with your team.", "category": "First Week", "dueOffsetDays": 5}
  ]'::jsonb,
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  tasks = EXCLUDED.tasks,
  is_system_default = TRUE,
  updated_at = NOW();

-- Kenya onboarding template
INSERT INTO onboarding_templates (id, org_id, name, type, country_code, department, is_system_default, tasks, created_at, updated_at)
VALUES (
  'a0000000-0000-0000-0000-000000000005',
  NULL,
  'Kenya Onboarding',
  'onboarding',
  'KE',
  NULL,
  TRUE,
  '[
    {"title": "Upload government-issued ID", "description": "Upload a scan of your national ID or passport.", "category": "Documentation", "dueOffsetDays": 3},
    {"title": "Upload proof of address", "description": "Upload a recent utility bill or bank statement.", "category": "Documentation", "dueOffsetDays": 5},
    {"title": "Complete emergency contact form", "description": "Provide details for your emergency contact.", "category": "Documentation", "dueOffsetDays": 3},
    {"title": "Enter bank account details for payroll", "description": "Add your bank account for salary payments.", "category": "Payroll & Finance", "dueOffsetDays": 5, "taskType": "link", "linkUrl": "/me/pay?tab=payment-details"},
    {"title": "Provide NSSF number", "description": "Submit your National Social Security Fund number.", "category": "Payroll & Finance", "dueOffsetDays": 10},
    {"title": "Provide NHIF number", "description": "Submit your National Hospital Insurance Fund number.", "category": "Payroll & Finance", "dueOffsetDays": 10},
    {"title": "Confirm KRA PIN", "description": "Verify your Kenya Revenue Authority PIN is on file.", "category": "Payroll & Finance", "dueOffsetDays": 10},
    {"title": "Review your compensation summary", "description": "Review your salary breakdown and benefits.", "category": "Payroll & Finance", "dueOffsetDays": 7, "taskType": "link", "linkUrl": "/me/pay?tab=compensation"},
    {"title": "Set up profile photo and bio", "description": "Add a profile photo and write a short bio.", "category": "Company Setup", "dueOffsetDays": 3, "taskType": "link", "linkUrl": "/settings?tab=profile"},
    {"title": "Review and accept data privacy policy", "description": "Read and sign the company data privacy policy.", "category": "Company Setup", "dueOffsetDays": 5, "taskType": "e_signature"},
    {"title": "Complete security training", "description": "Complete the mandatory security awareness training.", "category": "Company Setup", "dueOffsetDays": 14, "taskType": "link", "linkUrl": "/learning"},
    {"title": "Review the employee handbook", "description": "Read through the employee handbook.", "category": "Company Setup", "dueOffsetDays": 7, "taskType": "e_signature"},
    {"title": "Schedule a 1:1 with your manager", "description": "Set up an introductory meeting with your manager.", "category": "First Week", "dueOffsetDays": 5},
    {"title": "Meet your team", "description": "Arrange introductions with your team.", "category": "First Week", "dueOffsetDays": 5}
  ]'::jsonb,
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  tasks = EXCLUDED.tasks,
  is_system_default = TRUE,
  updated_at = NOW();

-- Canada onboarding template
INSERT INTO onboarding_templates (id, org_id, name, type, country_code, department, is_system_default, tasks, created_at, updated_at)
VALUES (
  'a0000000-0000-0000-0000-000000000006',
  NULL,
  'Canada Onboarding',
  'onboarding',
  'CA',
  NULL,
  TRUE,
  '[
    {"title": "Upload government-issued ID", "description": "Upload a scan of your Canadian passport, drivers licence, or provincial ID.", "category": "Documentation", "dueOffsetDays": 3},
    {"title": "Upload proof of address", "description": "Upload a recent utility bill or bank statement.", "category": "Documentation", "dueOffsetDays": 5},
    {"title": "Complete emergency contact form", "description": "Provide details for your emergency contact.", "category": "Documentation", "dueOffsetDays": 3},
    {"title": "Enter bank account details for payroll", "description": "Add your Canadian bank account for salary payments.", "category": "Payroll & Finance", "dueOffsetDays": 5, "taskType": "link", "linkUrl": "/me/pay?tab=payment-details"},
    {"title": "Provide SIN", "description": "Submit your Social Insurance Number.", "category": "Payroll & Finance", "dueOffsetDays": 5},
    {"title": "Confirm provincial health coverage enrollment", "description": "Verify your enrollment in provincial health coverage.", "category": "Payroll & Finance", "dueOffsetDays": 14},
    {"title": "Review your compensation summary", "description": "Review your salary breakdown and benefits.", "category": "Payroll & Finance", "dueOffsetDays": 7, "taskType": "link", "linkUrl": "/me/pay?tab=compensation"},
    {"title": "Set up profile photo and bio", "description": "Add a profile photo and write a short bio.", "category": "Company Setup", "dueOffsetDays": 3, "taskType": "link", "linkUrl": "/settings?tab=profile"},
    {"title": "Review and accept data privacy policy", "description": "Read and sign the company data privacy policy.", "category": "Company Setup", "dueOffsetDays": 5, "taskType": "e_signature"},
    {"title": "Complete security training", "description": "Complete the mandatory security awareness training.", "category": "Company Setup", "dueOffsetDays": 14, "taskType": "link", "linkUrl": "/learning"},
    {"title": "Review the employee handbook", "description": "Read through the employee handbook.", "category": "Company Setup", "dueOffsetDays": 7, "taskType": "e_signature"},
    {"title": "Schedule a 1:1 with your manager", "description": "Set up an introductory meeting with your manager.", "category": "First Week", "dueOffsetDays": 5},
    {"title": "Meet your team", "description": "Arrange introductions with your team.", "category": "First Week", "dueOffsetDays": 5}
  ]'::jsonb,
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  tasks = EXCLUDED.tasks,
  is_system_default = TRUE,
  updated_at = NOW();

-- System default offboarding templates (5 countries + universal)

-- Universal offboarding
INSERT INTO onboarding_templates (id, org_id, name, type, country_code, department, is_system_default, tasks, created_at, updated_at)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  NULL,
  'Universal Offboarding',
  'offboarding',
  NULL,
  NULL,
  TRUE,
  '[
    {"title": "Return company equipment", "description": "Return all company-issued equipment including laptop, phone, and access cards.", "category": "Equipment & Access", "dueOffsetDays": 5},
    {"title": "Complete knowledge transfer document", "description": "Document all ongoing projects, processes, and key contacts.", "category": "Knowledge Transfer", "dueOffsetDays": 10},
    {"title": "Revoke system access", "description": "Disable all system accounts and revoke access credentials.", "category": "Equipment & Access", "dueOffsetDays": 1},
    {"title": "Final payroll run", "description": "Process final salary payment including any outstanding leave balance.", "category": "Payroll & Finance", "dueOffsetDays": 14},
    {"title": "Complete exit survey", "description": "Complete the company exit survey to provide feedback.", "category": "HR Process", "dueOffsetDays": 5},
    {"title": "Exit interview scheduling", "description": "Schedule and complete the exit interview with HR.", "category": "HR Process", "dueOffsetDays": 7}
  ]'::jsonb,
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  tasks = EXCLUDED.tasks,
  is_system_default = TRUE,
  updated_at = NOW();

-- Nigeria offboarding
INSERT INTO onboarding_templates (id, org_id, name, type, country_code, department, is_system_default, tasks, created_at, updated_at)
VALUES (
  'b0000000-0000-0000-0000-000000000002',
  NULL,
  'Nigeria Offboarding',
  'offboarding',
  'NG',
  NULL,
  TRUE,
  '[
    {"title": "Return company equipment", "description": "Return all company-issued equipment.", "category": "Equipment & Access", "dueOffsetDays": 5},
    {"title": "Complete knowledge transfer document", "description": "Document all ongoing projects and key contacts.", "category": "Knowledge Transfer", "dueOffsetDays": 10},
    {"title": "Revoke system access", "description": "Disable all system accounts.", "category": "Equipment & Access", "dueOffsetDays": 1},
    {"title": "Final payroll run", "description": "Process final salary and pension contributions.", "category": "Payroll & Finance", "dueOffsetDays": 14},
    {"title": "Process PENCOM transfer", "description": "Initiate pension account transfer documentation.", "category": "Payroll & Finance", "dueOffsetDays": 14},
    {"title": "Complete exit survey", "description": "Complete the company exit survey.", "category": "HR Process", "dueOffsetDays": 5},
    {"title": "Exit interview scheduling", "description": "Schedule the exit interview with HR.", "category": "HR Process", "dueOffsetDays": 7}
  ]'::jsonb,
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET tasks = EXCLUDED.tasks, is_system_default = TRUE, updated_at = NOW();

-- Ghana offboarding
INSERT INTO onboarding_templates (id, org_id, name, type, country_code, department, is_system_default, tasks, created_at, updated_at)
VALUES (
  'b0000000-0000-0000-0000-000000000003',
  NULL,
  'Ghana Offboarding',
  'offboarding',
  'GH',
  NULL,
  TRUE,
  '[
    {"title": "Return company equipment", "description": "Return all company-issued equipment.", "category": "Equipment & Access", "dueOffsetDays": 5},
    {"title": "Complete knowledge transfer document", "description": "Document all ongoing projects and key contacts.", "category": "Knowledge Transfer", "dueOffsetDays": 10},
    {"title": "Revoke system access", "description": "Disable all system accounts.", "category": "Equipment & Access", "dueOffsetDays": 1},
    {"title": "Final payroll run", "description": "Process final salary and SSNIT contributions.", "category": "Payroll & Finance", "dueOffsetDays": 14},
    {"title": "SSNIT final contribution", "description": "Process final SSNIT contribution and submit documentation.", "category": "Payroll & Finance", "dueOffsetDays": 14},
    {"title": "Complete exit survey", "description": "Complete the company exit survey.", "category": "HR Process", "dueOffsetDays": 5},
    {"title": "Exit interview scheduling", "description": "Schedule the exit interview with HR.", "category": "HR Process", "dueOffsetDays": 7}
  ]'::jsonb,
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET tasks = EXCLUDED.tasks, is_system_default = TRUE, updated_at = NOW();

-- South Africa offboarding
INSERT INTO onboarding_templates (id, org_id, name, type, country_code, department, is_system_default, tasks, created_at, updated_at)
VALUES (
  'b0000000-0000-0000-0000-000000000004',
  NULL,
  'South Africa Offboarding',
  'offboarding',
  'ZA',
  NULL,
  TRUE,
  '[
    {"title": "Return company equipment", "description": "Return all company-issued equipment.", "category": "Equipment & Access", "dueOffsetDays": 5},
    {"title": "Complete knowledge transfer document", "description": "Document all ongoing projects and key contacts.", "category": "Knowledge Transfer", "dueOffsetDays": 10},
    {"title": "Revoke system access", "description": "Disable all system accounts.", "category": "Equipment & Access", "dueOffsetDays": 1},
    {"title": "Final payroll run", "description": "Process final salary and UIF contributions.", "category": "Payroll & Finance", "dueOffsetDays": 14},
    {"title": "UIF final submission", "description": "Submit final UIF documentation to the Department of Labour.", "category": "Payroll & Finance", "dueOffsetDays": 14},
    {"title": "Complete exit survey", "description": "Complete the company exit survey.", "category": "HR Process", "dueOffsetDays": 5},
    {"title": "Exit interview scheduling", "description": "Schedule the exit interview with HR.", "category": "HR Process", "dueOffsetDays": 7}
  ]'::jsonb,
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET tasks = EXCLUDED.tasks, is_system_default = TRUE, updated_at = NOW();

-- Kenya offboarding
INSERT INTO onboarding_templates (id, org_id, name, type, country_code, department, is_system_default, tasks, created_at, updated_at)
VALUES (
  'b0000000-0000-0000-0000-000000000005',
  NULL,
  'Kenya Offboarding',
  'offboarding',
  'KE',
  NULL,
  TRUE,
  '[
    {"title": "Return company equipment", "description": "Return all company-issued equipment.", "category": "Equipment & Access", "dueOffsetDays": 5},
    {"title": "Complete knowledge transfer document", "description": "Document all ongoing projects and key contacts.", "category": "Knowledge Transfer", "dueOffsetDays": 10},
    {"title": "Revoke system access", "description": "Disable all system accounts.", "category": "Equipment & Access", "dueOffsetDays": 1},
    {"title": "Final payroll run", "description": "Process final salary, NSSF and NHIF contributions.", "category": "Payroll & Finance", "dueOffsetDays": 14},
    {"title": "NSSF/NHIF final contribution", "description": "Process final NSSF and NHIF contribution and submit documentation.", "category": "Payroll & Finance", "dueOffsetDays": 14},
    {"title": "Complete exit survey", "description": "Complete the company exit survey.", "category": "HR Process", "dueOffsetDays": 5},
    {"title": "Exit interview scheduling", "description": "Schedule the exit interview with HR.", "category": "HR Process", "dueOffsetDays": 7}
  ]'::jsonb,
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET tasks = EXCLUDED.tasks, is_system_default = TRUE, updated_at = NOW();

-- Canada offboarding
INSERT INTO onboarding_templates (id, org_id, name, type, country_code, department, is_system_default, tasks, created_at, updated_at)
VALUES (
  'b0000000-0000-0000-0000-000000000006',
  NULL,
  'Canada Offboarding',
  'offboarding',
  'CA',
  NULL,
  TRUE,
  '[
    {"title": "Return company equipment", "description": "Return all company-issued equipment.", "category": "Equipment & Access", "dueOffsetDays": 5},
    {"title": "Complete knowledge transfer document", "description": "Document all ongoing projects and key contacts.", "category": "Knowledge Transfer", "dueOffsetDays": 10},
    {"title": "Revoke system access", "description": "Disable all system accounts.", "category": "Equipment & Access", "dueOffsetDays": 1},
    {"title": "Final payroll run", "description": "Process final salary and CPP/EI contributions.", "category": "Payroll & Finance", "dueOffsetDays": 14},
    {"title": "Issue Record of Employment", "description": "Generate and submit ROE to Service Canada.", "category": "Payroll & Finance", "dueOffsetDays": 5},
    {"title": "Complete exit survey", "description": "Complete the company exit survey.", "category": "HR Process", "dueOffsetDays": 5},
    {"title": "Exit interview scheduling", "description": "Schedule the exit interview with HR.", "category": "HR Process", "dueOffsetDays": 7}
  ]'::jsonb,
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET tasks = EXCLUDED.tasks, is_system_default = TRUE, updated_at = NOW();
