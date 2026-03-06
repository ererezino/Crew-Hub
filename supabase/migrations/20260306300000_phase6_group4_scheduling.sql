-- Schedule day notes table
CREATE TABLE IF NOT EXISTS schedule_day_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  note_date DATE NOT NULL,
  content TEXT NOT NULL,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(schedule_id, note_date)
);

ALTER TABLE schedule_day_notes ENABLE ROW LEVEL SECURITY;

-- RLS for schedule_day_notes
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE schedule_day_notes TO authenticated;

CREATE POLICY schedule_day_notes_select ON schedule_day_notes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY schedule_day_notes_manage ON schedule_day_notes
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- Schedule type on profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS schedule_type VARCHAR(20) DEFAULT 'weekday'
  CHECK (schedule_type IN ('weekday','weekend_primary','weekend_rotation','flexible'));
