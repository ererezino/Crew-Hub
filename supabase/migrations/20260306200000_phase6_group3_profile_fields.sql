-- Phase 6 Group 3: Profile fields, system onboarding templates, avatars bucket

-- Additional profile columns
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(200);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(30);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS emergency_contact_relationship VARCHAR(100);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pronouns VARCHAR(50);

-- System default flag for onboarding templates
ALTER TABLE onboarding_templates ADD COLUMN IF NOT EXISTS is_system_default BOOLEAN DEFAULT FALSE;

-- Allow org_id to be null for system-level templates
ALTER TABLE onboarding_templates ALTER COLUMN org_id DROP NOT NULL;

-- Avatars storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for avatars
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Users can upload own avatar'
  ) THEN
    CREATE POLICY "Users can upload own avatar" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'avatars');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Users can update own avatar'
  ) THEN
    CREATE POLICY "Users can update own avatar" ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'avatars');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Users can delete own avatar'
  ) THEN
    CREATE POLICY "Users can delete own avatar" ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'avatars');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Avatars are publicly readable'
  ) THEN
    CREATE POLICY "Avatars are publicly readable" ON storage.objects
      FOR SELECT TO public
      USING (bucket_id = 'avatars');
  END IF;
END $$;

-- Seed system default onboarding templates per country
-- Nigeria (NG)
INSERT INTO onboarding_templates (org_id, name, type, country_code, department, is_system_default, tasks)
VALUES (
  NULL,
  'Nigeria Default Onboarding',
  'onboarding',
  'NG',
  NULL,
  TRUE,
  '[
    {"title": "Submit Tax Identification Number (TIN)", "description": "Provide your TIN for payroll tax compliance.", "due_days_offset": 3, "assigned_to_role": "employee"},
    {"title": "Provide Bank Verification Number (BVN)", "description": "Required for salary account verification.", "due_days_offset": 3, "assigned_to_role": "employee"},
    {"title": "Pension Fund Administrator (PFA) enrollment", "description": "Enroll with a PFA for pension contributions.", "due_days_offset": 7, "assigned_to_role": "employee"},
    {"title": "Sign employment agreement", "description": "Review and sign your employment contract.", "due_days_offset": 1, "assigned_to_role": "employee"},
    {"title": "Read employee handbook", "description": "Read through the company handbook and policies.", "due_days_offset": 5, "assigned_to_role": "employee"},
    {"title": "Set up Slack", "description": "Join the team workspace and introduce yourself.", "due_days_offset": 1, "assigned_to_role": "employee"},
    {"title": "Meet your manager", "description": "Schedule a 1:1 with your manager.", "due_days_offset": 2, "assigned_to_role": "employee"},
    {"title": "Complete first-week checklist", "description": "Go through the first-week orientation tasks.", "due_days_offset": 5, "assigned_to_role": "employee"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

-- Ghana (GH)
INSERT INTO onboarding_templates (org_id, name, type, country_code, department, is_system_default, tasks)
VALUES (
  NULL,
  'Ghana Default Onboarding',
  'onboarding',
  'GH',
  NULL,
  TRUE,
  '[
    {"title": "Submit SSNIT number", "description": "Provide your Social Security number for contributions.", "due_days_offset": 3, "assigned_to_role": "employee"},
    {"title": "Provide Ghana Card", "description": "Submit a copy of your Ghana Card for verification.", "due_days_offset": 3, "assigned_to_role": "employee"},
    {"title": "Sign employment agreement", "description": "Review and sign your employment contract.", "due_days_offset": 1, "assigned_to_role": "employee"},
    {"title": "Read employee handbook", "description": "Read through the company handbook and policies.", "due_days_offset": 5, "assigned_to_role": "employee"},
    {"title": "Set up tools", "description": "Get access to Slack, email, and work tools.", "due_days_offset": 2, "assigned_to_role": "employee"},
    {"title": "Meet your manager", "description": "Schedule a 1:1 with your manager.", "due_days_offset": 2, "assigned_to_role": "employee"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

-- Kenya (KE)
INSERT INTO onboarding_templates (org_id, name, type, country_code, department, is_system_default, tasks)
VALUES (
  NULL,
  'Kenya Default Onboarding',
  'onboarding',
  'KE',
  NULL,
  TRUE,
  '[
    {"title": "NHIF registration", "description": "Register with the National Hospital Insurance Fund.", "due_days_offset": 5, "assigned_to_role": "employee"},
    {"title": "KRA PIN submission", "description": "Submit your Kenya Revenue Authority PIN.", "due_days_offset": 3, "assigned_to_role": "employee"},
    {"title": "NSSF registration", "description": "Register with the National Social Security Fund.", "due_days_offset": 5, "assigned_to_role": "employee"},
    {"title": "Sign employment agreement", "description": "Review and sign your employment contract.", "due_days_offset": 1, "assigned_to_role": "employee"},
    {"title": "Read employee handbook", "description": "Read through the company handbook and policies.", "due_days_offset": 5, "assigned_to_role": "employee"},
    {"title": "Set up tools", "description": "Get access to Slack, email, and work tools.", "due_days_offset": 2, "assigned_to_role": "employee"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

-- South Africa (ZA)
INSERT INTO onboarding_templates (org_id, name, type, country_code, department, is_system_default, tasks)
VALUES (
  NULL,
  'South Africa Default Onboarding',
  'onboarding',
  'ZA',
  NULL,
  TRUE,
  '[
    {"title": "Submit ID for UIF registration", "description": "Provide your ID for Unemployment Insurance Fund registration.", "due_days_offset": 3, "assigned_to_role": "employee"},
    {"title": "Tax reference number", "description": "Submit your SARS tax reference number.", "due_days_offset": 3, "assigned_to_role": "employee"},
    {"title": "Sign employment agreement", "description": "Review and sign your employment contract.", "due_days_offset": 1, "assigned_to_role": "employee"},
    {"title": "Read employee handbook", "description": "Read through the company handbook and policies.", "due_days_offset": 5, "assigned_to_role": "employee"},
    {"title": "Set up tools", "description": "Get access to Slack, email, and work tools.", "due_days_offset": 2, "assigned_to_role": "employee"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

-- Canada (CA)
INSERT INTO onboarding_templates (org_id, name, type, country_code, department, is_system_default, tasks)
VALUES (
  NULL,
  'Canada Default Onboarding',
  'onboarding',
  'CA',
  NULL,
  TRUE,
  '[
    {"title": "Submit Social Insurance Number (SIN)", "description": "Provide your SIN for payroll and tax purposes.", "due_days_offset": 3, "assigned_to_role": "employee"},
    {"title": "Complete TD1 form", "description": "Fill out the federal and provincial TD1 Personal Tax Credits Return.", "due_days_offset": 3, "assigned_to_role": "employee"},
    {"title": "Sign employment agreement", "description": "Review and sign your employment contract.", "due_days_offset": 1, "assigned_to_role": "employee"},
    {"title": "Read employee handbook", "description": "Read through the company handbook and policies.", "due_days_offset": 5, "assigned_to_role": "employee"},
    {"title": "Set up tools", "description": "Get access to Slack, email, and work tools.", "due_days_offset": 2, "assigned_to_role": "employee"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

-- Universal fallback template (no country)
INSERT INTO onboarding_templates (org_id, name, type, country_code, department, is_system_default, tasks)
VALUES (
  NULL,
  'Default Onboarding',
  'onboarding',
  NULL,
  NULL,
  TRUE,
  '[
    {"title": "Sign employment agreement", "description": "Review and sign your employment contract.", "due_days_offset": 1, "assigned_to_role": "employee"},
    {"title": "Read employee handbook", "description": "Read through the company handbook and policies.", "due_days_offset": 5, "assigned_to_role": "employee"},
    {"title": "Set up tools", "description": "Get access to Slack, email, and work tools.", "due_days_offset": 2, "assigned_to_role": "employee"},
    {"title": "Meet your manager", "description": "Schedule a 1:1 with your manager.", "due_days_offset": 2, "assigned_to_role": "employee"},
    {"title": "Complete first-week checklist", "description": "Go through the first-week orientation tasks.", "due_days_offset": 5, "assigned_to_role": "employee"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;
