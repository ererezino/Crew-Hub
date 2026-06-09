CREATE TABLE IF NOT EXISTS profile_address_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  address_text TEXT NOT NULL,
  replaced_by_address TEXT,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_profile_address_history_employee_archived
  ON profile_address_history (employee_id, archived_at DESC);

ALTER TABLE profile_address_history ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION archive_profile_home_address_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.home_address IS NOT NULL
     AND OLD.home_address IS DISTINCT FROM NEW.home_address THEN
    INSERT INTO profile_address_history (
      org_id,
      employee_id,
      address_text,
      replaced_by_address,
      removed_at
    )
    VALUES (
      OLD.org_id,
      OLD.id,
      OLD.home_address,
      NEW.home_address,
      CASE
        WHEN NEW.home_address IS NULL THEN NOW()
        ELSE NULL
      END
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_archive_profile_home_address_changes ON profiles;

CREATE TRIGGER trg_archive_profile_home_address_changes
BEFORE UPDATE OF home_address
ON profiles
FOR EACH ROW
EXECUTE FUNCTION archive_profile_home_address_changes();
