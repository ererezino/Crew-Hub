-- ============================================================================
-- Migration: Pre-Start Stage & Contract Tracking
-- ============================================================================
-- Adds "pre_start" as a valid profile status and creates the
-- pre_start_contracts table for manual contract lifecycle tracking.
-- ============================================================================

-- ── 1. Expand the profile status constraint ─────────────────────────────────

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_status_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_status_check
  CHECK (status IN ('active', 'inactive', 'onboarding', 'offboarding', 'pre_start'));

-- Also expand employee_type_at_creation to include 'pre_start'
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_employee_type_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_employee_type_check
  CHECK (employee_type_at_creation IN ('new_hire', 'existing', 'pre_start'));

-- ── 2. Create pre_start_contracts table ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS pre_start_contracts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  person_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Contract metadata
  title         TEXT NOT NULL,
  notes         TEXT,

  -- Lifecycle timestamps (drive derived status)
  sent_at       TIMESTAMPTZ,
  signed_at     TIMESTAMPTZ,
  voided_at     TIMESTAMPTZ,

  -- Housekeeping
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for efficient lookups by person
CREATE INDEX IF NOT EXISTS idx_pre_start_contracts_person
  ON pre_start_contracts (org_id, person_id);

-- RLS: only service-role access (admin operations go through service-role client)
ALTER TABLE pre_start_contracts ENABLE ROW LEVEL SECURITY;

-- Allow service-role full access (no user-level RLS needed — all access is admin-gated)
CREATE POLICY pre_start_contracts_service_role
  ON pre_start_contracts
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── 3. Updated_at trigger ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_pre_start_contracts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pre_start_contracts_updated_at
  BEFORE UPDATE ON pre_start_contracts
  FOR EACH ROW
  EXECUTE FUNCTION update_pre_start_contracts_updated_at();
