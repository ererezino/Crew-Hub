-- ---------------------------------------------------------------------------
-- Scheduling Redesign: monthly schedules, schedule_track, roster table
-- ---------------------------------------------------------------------------

-- 1A. Rename week_start/week_end to start_date/end_date on schedules
ALTER TABLE schedules RENAME COLUMN week_start TO start_date;
ALTER TABLE schedules RENAME COLUMN week_end TO end_date;

-- 1B. Relax the 7-day window constraint → allow multi-month ranges
ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_week_window_check;
ALTER TABLE schedules ADD CONSTRAINT schedules_date_range_check
  CHECK (end_date >= start_date);

-- 1C. Add schedule_track column (weekday or weekend)
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS schedule_track VARCHAR(10) DEFAULT 'weekday'
  CHECK (schedule_track IN ('weekday', 'weekend'));

-- 1D. Update indexes to use new column names
DROP INDEX IF EXISTS idx_schedules_org_week;
DROP INDEX IF EXISTS idx_schedules_org_status_week;
CREATE INDEX IF NOT EXISTS idx_schedules_org_start ON public.schedules(org_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_schedules_org_status_start ON public.schedules(org_id, status, start_date DESC);

-- 2. Create schedule_roster junction table
CREATE TABLE IF NOT EXISTS schedule_roster (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES profiles(id),
  weekend_hours VARCHAR(6) DEFAULT NULL CHECK (weekend_hours IN ('2', '3', '4', '8')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(schedule_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_schedule_roster_schedule ON schedule_roster(schedule_id);
CREATE INDEX IF NOT EXISTS idx_schedule_roster_employee ON schedule_roster(employee_id);

-- Enable RLS on schedule_roster
ALTER TABLE schedule_roster ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schedule_roster_org_isolation" ON schedule_roster
  USING (
    schedule_id IN (
      SELECT id FROM schedules
      WHERE org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
    )
  );

-- 3. Add default weekend_shift_hours to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS weekend_shift_hours VARCHAR(6) DEFAULT '8'
  CHECK (weekend_shift_hours IN ('2', '3', '4', '8'));
