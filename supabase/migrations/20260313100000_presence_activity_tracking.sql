-- Add last_active_at for activity-based presence tracking
-- last_seen_at = last heartbeat received (tab is open)
-- last_active_at = last heartbeat where user had mouse/keyboard activity (user is at desk)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_last_active_at ON profiles (last_active_at);
