-- Phase 6 Group 1: Navigation and availability status

-- ─── Availability status columns on profiles ───
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS availability_status VARCHAR(20) DEFAULT 'available'
  CHECK (availability_status IN ('available','in_meeting','on_break','focusing','afk','ooo'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status_note TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;

-- ─── Password change required flag ───
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_change_required BOOLEAN DEFAULT FALSE;
