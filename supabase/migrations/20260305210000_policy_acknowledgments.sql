-- Policy acknowledgment tracking

-- First, create the compliance_policies table if it does not exist
CREATE TABLE IF NOT EXISTS compliance_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  category VARCHAR(60) NOT NULL DEFAULT 'general',
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT compliance_policies_status_check CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT compliance_policies_name_check CHECK (char_length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_compliance_policies_org
  ON compliance_policies(org_id, status);

ALTER TABLE compliance_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compliance_policies_select_scope ON compliance_policies;
CREATE POLICY compliance_policies_select_scope
  ON compliance_policies FOR SELECT
  TO authenticated
  USING (
    org_id = public.get_user_org_id()
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS compliance_policies_insert_scope ON compliance_policies;
CREATE POLICY compliance_policies_insert_scope
  ON compliance_policies FOR INSERT
  TO authenticated
  WITH CHECK (
    org_id = public.get_user_org_id()
    AND (
      public.has_role('HR_ADMIN')
      OR public.has_role('SUPER_ADMIN')
    )
  );

DROP POLICY IF EXISTS compliance_policies_update_scope ON compliance_policies;
CREATE POLICY compliance_policies_update_scope
  ON compliance_policies FOR UPDATE
  TO authenticated
  USING (
    org_id = public.get_user_org_id()
    AND deleted_at IS NULL
    AND (
      public.has_role('HR_ADMIN')
      OR public.has_role('SUPER_ADMIN')
    )
  )
  WITH CHECK (
    org_id = public.get_user_org_id()
    AND (
      public.has_role('HR_ADMIN')
      OR public.has_role('SUPER_ADMIN')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE compliance_policies TO authenticated;

-- Now create the policy_acknowledgments table
CREATE TABLE IF NOT EXISTS policy_acknowledgments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  policy_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  acknowledged_at TIMESTAMPTZ,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(policy_id, employee_id)
);

ALTER TABLE policy_acknowledgments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own acknowledgments"
  ON policy_acknowledgments FOR SELECT
  USING (employee_id = auth.uid());

CREATE POLICY "Admins can view all acknowledgments"
  ON policy_acknowledgments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.org_id = policy_acknowledgments.org_id
        AND (profiles.roles::text[] && ARRAY['HR_ADMIN', 'SUPER_ADMIN'])
    )
  );

CREATE POLICY "Users can acknowledge policies"
  ON policy_acknowledgments FOR UPDATE
  USING (employee_id = auth.uid())
  WITH CHECK (employee_id = auth.uid());

CREATE POLICY "System can create acknowledgment records"
  ON policy_acknowledgments FOR INSERT
  WITH CHECK (true);

CREATE INDEX idx_policy_ack_policy ON policy_acknowledgments(policy_id);
CREATE INDEX idx_policy_ack_employee ON policy_acknowledgments(employee_id);
CREATE INDEX idx_policy_ack_org ON policy_acknowledgments(org_id);

GRANT SELECT, INSERT, UPDATE ON TABLE policy_acknowledgments TO authenticated;
