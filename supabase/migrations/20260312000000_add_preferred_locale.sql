-- ---------------------------------------------------------------------------
-- Add preferred_locale column to profiles for i18n support
-- ---------------------------------------------------------------------------

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS preferred_locale VARCHAR(5) NOT NULL DEFAULT 'en';

ALTER TABLE profiles
  ADD CONSTRAINT profiles_preferred_locale_check
  CHECK (preferred_locale IN ('en', 'fr'));

COMMENT ON COLUMN profiles.preferred_locale
  IS 'User language preference. Supported: en (English), fr (French). Used for UI and email localization.';
