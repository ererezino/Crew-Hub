-- Phase 6A: Performance Goals
CREATE TABLE performance_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  employee_id UUID NOT NULL REFERENCES profiles(id),
  cycle_id UUID REFERENCES review_cycles(id),
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'cancelled')),
  progress_pct SMALLINT NOT NULL DEFAULT 0
    CHECK (progress_pct BETWEEN 0 AND 100),
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_performance_goals_org ON performance_goals(org_id);
CREATE INDEX idx_performance_goals_employee ON performance_goals(employee_id);
CREATE INDEX idx_performance_goals_cycle ON performance_goals(cycle_id) WHERE cycle_id IS NOT NULL;
CREATE INDEX idx_performance_goals_status ON performance_goals(org_id, status) WHERE deleted_at IS NULL;

ALTER TABLE performance_goals ENABLE ROW LEVEL SECURITY;

-- Employee can see own goals + manager can see direct reports' goals
CREATE POLICY "goals_select" ON performance_goals
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND org_id IN (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL)
    AND (
      employee_id = auth.uid()
      OR employee_id IN (
        SELECT p2.id FROM profiles p2 WHERE p2.manager_id = auth.uid() AND p2.deleted_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM profiles p3
        WHERE p3.id = auth.uid()
          AND p3.deleted_at IS NULL
          AND p3.roles && ARRAY['HR_ADMIN', 'SUPER_ADMIN']::text[]
      )
    )
  );

CREATE POLICY "goals_insert" ON performance_goals
  FOR INSERT
  WITH CHECK (
    org_id IN (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL)
    AND (
      employee_id = auth.uid()
      OR employee_id IN (
        SELECT p2.id FROM profiles p2 WHERE p2.manager_id = auth.uid() AND p2.deleted_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM profiles p3
        WHERE p3.id = auth.uid()
          AND p3.deleted_at IS NULL
          AND p3.roles && ARRAY['HR_ADMIN', 'SUPER_ADMIN']::text[]
      )
    )
  );

CREATE POLICY "goals_update" ON performance_goals
  FOR UPDATE
  USING (
    deleted_at IS NULL
    AND org_id IN (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL)
    AND (
      employee_id = auth.uid()
      OR employee_id IN (
        SELECT p2.id FROM profiles p2 WHERE p2.manager_id = auth.uid() AND p2.deleted_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM profiles p3
        WHERE p3.id = auth.uid()
          AND p3.deleted_at IS NULL
          AND p3.roles && ARRAY['HR_ADMIN', 'SUPER_ADMIN']::text[]
      )
    )
  );

-- Phase 6B: Review Sharing and Acknowledgment
ALTER TABLE review_assignments
  ADD COLUMN shared_at TIMESTAMPTZ,
  ADD COLUMN shared_by UUID REFERENCES profiles(id),
  ADD COLUMN acknowledged_at TIMESTAMPTZ;
