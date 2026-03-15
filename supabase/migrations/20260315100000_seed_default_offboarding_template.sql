-- Seed the default Accrue offboarding template with dual-track tasks
-- (employee + operations).
-- This is inserted for ALL existing orgs that don't already have one.

DO $$
DECLARE
  v_org_id uuid;
  v_template_json jsonb;
BEGIN
  v_template_json := '[
    {
      "title": "Complete knowledge transfer document",
      "category": "Handover",
      "track": "employee",
      "dueOffsetDays": -5,
      "taskType": "manual"
    },
    {
      "title": "Return company equipment",
      "category": "Equipment",
      "track": "employee",
      "dueOffsetDays": -1,
      "taskType": "manual"
    },
    {
      "title": "Remove personal data from company devices",
      "category": "Equipment",
      "track": "employee",
      "dueOffsetDays": -1,
      "taskType": "manual"
    },
    {
      "title": "Revoke email access",
      "category": "IT Offboarding",
      "track": "operations",
      "dueOffsetDays": 0,
      "taskType": "manual"
    },
    {
      "title": "Revoke Slack access",
      "category": "IT Offboarding",
      "track": "operations",
      "dueOffsetDays": 0,
      "taskType": "manual"
    },
    {
      "title": "Revoke 1Password access",
      "category": "IT Offboarding",
      "track": "operations",
      "dueOffsetDays": 0,
      "taskType": "manual"
    },
    {
      "title": "Process final payroll",
      "category": "Finance",
      "track": "operations",
      "dueOffsetDays": 5,
      "taskType": "manual"
    },
    {
      "title": "Settle outstanding expenses",
      "category": "Finance",
      "track": "operations",
      "dueOffsetDays": 5,
      "taskType": "manual"
    },
    {
      "title": "Reassign direct reports",
      "category": "Handover",
      "track": "operations",
      "dueOffsetDays": -3,
      "taskType": "manual"
    },
    {
      "title": "Conduct exit interview",
      "category": "HR & Admin",
      "track": "operations",
      "dueOffsetDays": -2,
      "taskType": "manual"
    }
  ]'::jsonb;

  -- Insert for each existing org that doesn't already have a default offboarding template
  FOR v_org_id IN
    SELECT id FROM public.orgs
    WHERE NOT EXISTS (
      SELECT 1 FROM public.onboarding_templates t
      WHERE t.org_id = orgs.id
        AND t.name = 'Default Offboarding'
        AND t.type = 'offboarding'
        AND t.deleted_at IS NULL
    )
  LOOP
    INSERT INTO public.onboarding_templates (org_id, name, type, tasks)
    VALUES (v_org_id, 'Default Offboarding', 'offboarding', v_template_json);
  END LOOP;

  -- Also insert a system-level default (org_id = NULL) if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM public.onboarding_templates
    WHERE org_id IS NULL
      AND name = 'Default Offboarding'
      AND type = 'offboarding'
      AND is_system_default = true
      AND deleted_at IS NULL
  ) THEN
    INSERT INTO public.onboarding_templates (id, org_id, name, type, tasks, is_system_default, country_code, department)
    VALUES (gen_random_uuid(), NULL, 'Default Offboarding', 'offboarding', v_template_json, true, NULL, NULL);
  END IF;
END
$$;
