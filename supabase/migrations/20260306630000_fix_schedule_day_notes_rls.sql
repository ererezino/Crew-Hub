-- Fix schedule_day_notes RLS: replace permissive USING(true) policies
-- with org-scoped policies that join through schedules.org_id.

-- Drop the overly permissive policies
DROP POLICY IF EXISTS schedule_day_notes_select ON schedule_day_notes;
DROP POLICY IF EXISTS schedule_day_notes_manage ON schedule_day_notes;

-- SELECT: user can only see notes for schedules in their org
CREATE POLICY schedule_day_notes_select ON schedule_day_notes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM schedules s
      WHERE s.id = schedule_day_notes.schedule_id
        AND s.org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
        AND s.deleted_at IS NULL
    )
  );

-- INSERT: user can only create notes for schedules in their org
CREATE POLICY schedule_day_notes_insert ON schedule_day_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM schedules s
      WHERE s.id = schedule_day_notes.schedule_id
        AND s.org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
        AND s.deleted_at IS NULL
    )
  );

-- UPDATE: user can only update notes for schedules in their org
CREATE POLICY schedule_day_notes_update ON schedule_day_notes
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM schedules s
      WHERE s.id = schedule_day_notes.schedule_id
        AND s.org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
        AND s.deleted_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM schedules s
      WHERE s.id = schedule_day_notes.schedule_id
        AND s.org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
        AND s.deleted_at IS NULL
    )
  );

-- DELETE: user can only delete notes for schedules in their org
CREATE POLICY schedule_day_notes_delete ON schedule_day_notes
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM schedules s
      WHERE s.id = schedule_day_notes.schedule_id
        AND s.org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
        AND s.deleted_at IS NULL
    )
  );
