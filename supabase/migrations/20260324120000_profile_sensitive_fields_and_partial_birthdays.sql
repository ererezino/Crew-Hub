ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS birthday_month SMALLINT,
  ADD COLUMN IF NOT EXISTS birthday_day SMALLINT,
  ADD COLUMN IF NOT EXISTS home_address TEXT,
  ADD COLUMN IF NOT EXISTS government_id_url TEXT;

CREATE TABLE IF NOT EXISTS profile_id_document_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  document_url TEXT NOT NULL,
  replaced_by_url TEXT,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_profile_id_document_history_employee_archived
  ON profile_id_document_history (employee_id, archived_at DESC);

ALTER TABLE profile_id_document_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_birthday_parts_pair_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_birthday_parts_pair_check
      CHECK (
        (birthday_month IS NULL AND birthday_day IS NULL)
        OR (
          birthday_month BETWEEN 1 AND 12
          AND birthday_day BETWEEN 1 AND 31
        )
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION sync_profile_birthday_parts()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.date_of_birth IS NOT NULL THEN
    NEW.birthday_month := EXTRACT(MONTH FROM NEW.date_of_birth)::SMALLINT;
    NEW.birthday_day := EXTRACT(DAY FROM NEW.date_of_birth)::SMALLINT;
  ELSIF NEW.birthday_month IS NULL OR NEW.birthday_day IS NULL THEN
    NEW.birthday_month := NULL;
    NEW.birthday_day := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION archive_profile_id_document_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.government_id_url IS NOT NULL
     AND OLD.government_id_url IS DISTINCT FROM NEW.government_id_url THEN
    INSERT INTO profile_id_document_history (
      org_id,
      employee_id,
      document_url,
      replaced_by_url,
      removed_at
    )
    VALUES (
      OLD.org_id,
      OLD.id,
      OLD.government_id_url,
      NEW.government_id_url,
      CASE
        WHEN NEW.government_id_url IS NULL THEN NOW()
        ELSE NULL
      END
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_birthday_parts ON profiles;
DROP TRIGGER IF EXISTS trg_archive_profile_id_document_changes ON profiles;

CREATE TRIGGER trg_sync_profile_birthday_parts
BEFORE INSERT OR UPDATE OF date_of_birth, birthday_month, birthday_day
ON profiles
FOR EACH ROW
EXECUTE FUNCTION sync_profile_birthday_parts();

CREATE TRIGGER trg_archive_profile_id_document_changes
BEFORE UPDATE OF government_id_url
ON profiles
FOR EACH ROW
EXECUTE FUNCTION archive_profile_id_document_changes();

UPDATE profiles
SET
  birthday_month = EXTRACT(MONTH FROM date_of_birth)::SMALLINT,
  birthday_day = EXTRACT(DAY FROM date_of_birth)::SMALLINT
WHERE
  date_of_birth IS NOT NULL
  AND (
    birthday_month IS DISTINCT FROM EXTRACT(MONTH FROM date_of_birth)::SMALLINT
    OR birthday_day IS DISTINCT FROM EXTRACT(DAY FROM date_of_birth)::SMALLINT
  );

CREATE INDEX IF NOT EXISTS idx_profiles_org_birthday_parts
  ON profiles (org_id, birthday_month, birthday_day)
  WHERE deleted_at IS NULL;
