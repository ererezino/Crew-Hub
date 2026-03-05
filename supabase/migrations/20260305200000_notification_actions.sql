-- Add inline actions column to notifications for approve/decline/navigate buttons
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actions JSONB DEFAULT '[]'::jsonb;
