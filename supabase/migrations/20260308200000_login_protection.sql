-- Failed login attempt tracking for account lockout
CREATE TABLE IF NOT EXISTS failed_login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  ip_address text NOT NULL DEFAULT 'unknown',
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_failed_login_attempts_email_time
  ON failed_login_attempts (email, attempted_at DESC);

-- Auto-cleanup: remove attempts older than 24 hours on insert
-- (keeps table small without a separate cron)
CREATE OR REPLACE FUNCTION cleanup_old_login_attempts()
RETURNS trigger AS $$
BEGIN
  DELETE FROM failed_login_attempts
  WHERE attempted_at < now() - interval '24 hours';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_cleanup_login_attempts
  AFTER INSERT ON failed_login_attempts
  FOR EACH STATEMENT
  EXECUTE FUNCTION cleanup_old_login_attempts();

-- Account lockout tracking
CREATE TABLE IF NOT EXISTS account_lockouts (
  email text PRIMARY KEY,
  locked_until timestamptz NOT NULL,
  reason text NOT NULL DEFAULT 'excessive_failed_logins',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: service role only (these tables are not user-facing)
ALTER TABLE failed_login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_lockouts ENABLE ROW LEVEL SECURITY;

-- No RLS policies = only service_role can access these tables
