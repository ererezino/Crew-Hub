-- Time-Off System Overhaul: sick leave, personal days, birthday leave, AFK tracking
-- Adds date_of_birth to profiles, is_unlimited to leave_policies,
-- requires_documentation to leave_requests, and creates afk_logs table.

-- 1. Profiles: birthday support
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- 2. Leave policies: unlimited marker (for sick leave)
ALTER TABLE leave_policies ADD COLUMN IF NOT EXISTS is_unlimited BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Leave requests: sick leave documentation flag
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS requires_documentation BOOLEAN NOT NULL DEFAULT FALSE;

-- 4. AFK logs: separate table for sub-day absence tracking
CREATE TABLE IF NOT EXISTS afk_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES orgs(id),
  employee_id UUID NOT NULL REFERENCES profiles(id),
  date DATE NOT NULL,
  start_time VARCHAR(5) NOT NULL,
  end_time VARCHAR(5) NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  reclassified_as VARCHAR(50),
  leave_request_id UUID REFERENCES leave_requests(id),
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_afk_logs_employee_date ON afk_logs(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_afk_logs_org_id ON afk_logs(org_id);

-- 5. Enable RLS on afk_logs
ALTER TABLE afk_logs ENABLE ROW LEVEL SECURITY;

-- RLS: employees can read own AFK logs
CREATE POLICY afk_logs_select_own ON afk_logs
  FOR SELECT USING (employee_id = auth.uid());

-- RLS: managers can read direct reports' AFK logs
CREATE POLICY afk_logs_select_manager ON afk_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = afk_logs.employee_id
        AND p.manager_id = auth.uid()
        AND p.deleted_at IS NULL
    )
  );

-- RLS: admins can read all AFK logs in their org
CREATE POLICY afk_logs_select_admin ON afk_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.org_id = afk_logs.org_id
        AND (p.roles && ARRAY['HR_ADMIN', 'SUPER_ADMIN']::text[])
        AND p.deleted_at IS NULL
    )
  );

-- RLS: employees can insert own AFK logs
CREATE POLICY afk_logs_insert_own ON afk_logs
  FOR INSERT WITH CHECK (employee_id = auth.uid());

-- RLS: admins can insert AFK logs
CREATE POLICY afk_logs_insert_admin ON afk_logs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.org_id = afk_logs.org_id
        AND (p.roles && ARRAY['HR_ADMIN', 'SUPER_ADMIN']::text[])
        AND p.deleted_at IS NULL
    )
  );

-- 6. Auto-update updated_at trigger for afk_logs
CREATE TRIGGER set_afk_logs_updated_at
  BEFORE UPDATE ON afk_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
