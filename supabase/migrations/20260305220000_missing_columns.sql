ALTER TABLE signature_signers ADD COLUMN IF NOT EXISTS signature_image_path TEXT;
ALTER TABLE signature_signers ADD COLUMN IF NOT EXISTS signature_mode VARCHAR(10) DEFAULT 'typed';

CREATE TABLE IF NOT EXISTS review_action_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL,
  description TEXT NOT NULL,
  due_date DATE,
  assigned_to UUID,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE review_action_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS first_login_at TIMESTAMPTZ;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_policy BOOLEAN DEFAULT FALSE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS requires_acknowledgment BOOLEAN DEFAULT FALSE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS policy_version VARCHAR(20);
