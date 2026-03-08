-- Presence system: heartbeat-based online/away/offline tracking + auto-expiring statuses.

-- When a user sets AFK/OOO with a duration, status_expires_at records when to revert to available.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status_expires_at TIMESTAMPTZ;

-- Updated on every heartbeat (mouse move, keypress, etc.). Used to derive online/away/offline.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- Index for efficient presence queries (super admin dashboard)
CREATE INDEX IF NOT EXISTS idx_profiles_last_seen_at
  ON profiles(org_id, last_seen_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

-- Index for auto-expire background check
CREATE INDEX IF NOT EXISTS idx_profiles_status_expires_at
  ON profiles(status_expires_at)
  WHERE status_expires_at IS NOT NULL AND deleted_at IS NULL;
