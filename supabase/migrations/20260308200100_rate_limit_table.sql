-- Durable rate limit tracking for serverless environments
CREATE TABLE IF NOT EXISTS rate_limit_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket text NOT NULL,
  key text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_bucket_key_time
  ON rate_limit_entries (bucket, key, attempted_at DESC);

-- Auto-cleanup: remove entries older than 5 minutes on insert
CREATE OR REPLACE FUNCTION cleanup_old_rate_limit_entries()
RETURNS trigger AS $$
BEGIN
  DELETE FROM rate_limit_entries
  WHERE attempted_at < now() - interval '5 minutes';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_cleanup_rate_limit
  AFTER INSERT ON rate_limit_entries
  FOR EACH STATEMENT
  EXECUTE FUNCTION cleanup_old_rate_limit_entries();

-- RLS: service role only
ALTER TABLE rate_limit_entries ENABLE ROW LEVEL SECURITY;
