-- Phase 8: Onboarding Templates, E-Signatures in Onboarding, Offboarding

-- 8A: Default onboarding templates
ALTER TABLE onboarding_templates
  ADD COLUMN IF NOT EXISTS is_system_default BOOLEAN NOT NULL DEFAULT FALSE;

-- 8B: E-Signature flow in onboarding tasks
ALTER TABLE onboarding_tasks
  ADD COLUMN IF NOT EXISTS task_type VARCHAR(50) NOT NULL DEFAULT 'manual'
    CHECK (task_type IN ('manual', 'e_signature', 'link', 'form')),
  ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES documents(id),
  ADD COLUMN IF NOT EXISTS signature_request_id UUID REFERENCES signature_requests(id);

-- 8C: Offboarding — notice period end date on profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notice_period_end_date DATE;
