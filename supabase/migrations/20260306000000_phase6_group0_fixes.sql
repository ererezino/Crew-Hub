-- Phase 6 Group 0: Fix broken pages
-- 0.1 Performance: ensure review_assignments columns exist
-- 0.2 Approvals: ensure approve/reject RPCs exist with GRANT + self-approval block
-- 0.3 People: add TEAM_LEAD RLS policy for profiles
-- 0.4 Notifications: ensure actions column exists with proper default

-- ─── 0.1 Performance: missing columns on review_assignments ───
ALTER TABLE review_assignments ADD COLUMN IF NOT EXISTS shared_at TIMESTAMPTZ;
ALTER TABLE review_assignments ADD COLUMN IF NOT EXISTS shared_by UUID REFERENCES profiles(id);
ALTER TABLE review_assignments ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
ALTER TABLE review_assignments ADD COLUMN IF NOT EXISTS discussion_summary TEXT;

-- ─── 0.3 People: TEAM_LEAD RLS policy for profiles ───
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles' AND policyname = 'profiles_select_team_lead_scope'
  ) THEN
    CREATE POLICY profiles_select_team_lead_scope
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (
      public.has_role('TEAM_LEAD')
      AND org_id = public.get_user_org_id()
      AND deleted_at IS NULL
      AND (
        id = auth.uid()
        OR (
          department IS NOT NULL
          AND lower(trim(department)) = lower(trim(
            (SELECT p.department FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1)
          ))
        )
      )
    );
  END IF;
END
$$;

-- ─── 0.4 Notifications: ensure actions column exists ───
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actions JSONB DEFAULT '[]'::jsonb;

-- Update any existing NULL actions to empty array
UPDATE notifications SET actions = '[]'::jsonb WHERE actions IS NULL;

-- ─── 0.2 Approvals: recreate approve/reject RPCs with self-approval block and GRANT ───
CREATE OR REPLACE FUNCTION approve_leave_request(
  p_request_id UUID,
  p_approver_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_request RECORD;
  v_total_days NUMERIC;
  v_year INT;
  v_is_unlimited BOOLEAN;
BEGIN
  -- Lock the leave_request row
  SELECT *
  INTO v_request
  FROM leave_requests
  WHERE id = p_request_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Leave request not found.');
  END IF;

  IF v_request.status != 'pending' THEN
    RETURN jsonb_build_object('error', 'Only pending requests can be approved. Current status: ' || v_request.status);
  END IF;

  -- Block self-approval
  IF v_request.employee_id = p_approver_id THEN
    RETURN jsonb_build_object('error', 'You cannot approve your own leave request. It must be approved by your manager or HR.');
  END IF;

  v_total_days := COALESCE(v_request.total_days, 0);
  v_year := EXTRACT(YEAR FROM v_request.start_date)::INT;
  v_is_unlimited := v_request.leave_type IN ('sick_leave', 'bereavement', 'compassionate');

  UPDATE leave_requests
  SET status = 'approved',
      approver_id = p_approver_id,
      rejection_reason = NULL,
      updated_at = NOW()
  WHERE id = p_request_id;

  IF NOT v_is_unlimited AND v_total_days > 0 THEN
    UPDATE leave_balances
    SET used_days = used_days + v_total_days,
        pending_days = GREATEST(pending_days - v_total_days, 0),
        updated_at = NOW()
    WHERE employee_id = v_request.employee_id
      AND leave_type = v_request.leave_type
      AND year = v_year
      AND org_id = v_request.org_id;

    IF NOT FOUND THEN
      INSERT INTO leave_balances (org_id, employee_id, leave_type, year, allocated_days, used_days, pending_days)
      VALUES (v_request.org_id, v_request.employee_id, v_request.leave_type, v_year, 0, v_total_days, 0)
      ON CONFLICT (org_id, employee_id, leave_type, year) DO UPDATE
      SET used_days = leave_balances.used_days + v_total_days,
          pending_days = GREATEST(leave_balances.pending_days - v_total_days, 0),
          updated_at = NOW();
    END IF;
  END IF;

  INSERT INTO audit_log (org_id, actor_user_id, action, table_name, record_id, old_value, new_value)
  VALUES (
    v_request.org_id,
    p_approver_id,
    'approve',
    'leave_requests',
    p_request_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', 'approved')
  );

  RETURN (
    SELECT to_jsonb(r)
    FROM (
      SELECT id, org_id, employee_id, leave_type, start_date, end_date,
             total_days, status, reason, approver_id, rejection_reason,
             created_at, updated_at
      FROM leave_requests
      WHERE id = p_request_id
    ) r
  );
END;
$$;

CREATE OR REPLACE FUNCTION reject_leave_request(
  p_request_id UUID,
  p_approver_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_request RECORD;
  v_total_days NUMERIC;
  v_year INT;
  v_is_unlimited BOOLEAN;
BEGIN
  SELECT *
  INTO v_request
  FROM leave_requests
  WHERE id = p_request_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Leave request not found.');
  END IF;

  IF v_request.status != 'pending' THEN
    RETURN jsonb_build_object('error', 'Only pending requests can be rejected. Current status: ' || v_request.status);
  END IF;

  -- Block self-rejection
  IF v_request.employee_id = p_approver_id THEN
    RETURN jsonb_build_object('error', 'You cannot reject your own leave request. Use the cancel option instead.');
  END IF;

  v_total_days := COALESCE(v_request.total_days, 0);
  v_year := EXTRACT(YEAR FROM v_request.start_date)::INT;
  v_is_unlimited := v_request.leave_type IN ('sick_leave', 'bereavement', 'compassionate');

  UPDATE leave_requests
  SET status = 'rejected',
      approver_id = p_approver_id,
      rejection_reason = p_reason,
      updated_at = NOW()
  WHERE id = p_request_id;

  IF NOT v_is_unlimited AND v_total_days > 0 THEN
    UPDATE leave_balances
    SET pending_days = GREATEST(pending_days - v_total_days, 0),
        updated_at = NOW()
    WHERE employee_id = v_request.employee_id
      AND leave_type = v_request.leave_type
      AND year = v_year
      AND org_id = v_request.org_id;
  END IF;

  INSERT INTO audit_log (org_id, actor_user_id, action, table_name, record_id, old_value, new_value)
  VALUES (
    v_request.org_id,
    p_approver_id,
    'reject',
    'leave_requests',
    p_request_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', 'rejected', 'rejection_reason', p_reason)
  );

  RETURN (
    SELECT to_jsonb(r)
    FROM (
      SELECT id, org_id, employee_id, leave_type, start_date, end_date,
             total_days, status, reason, approver_id, rejection_reason,
             created_at, updated_at
      FROM leave_requests
      WHERE id = p_request_id
    ) r
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION approve_leave_request(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_leave_request(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION reject_leave_request(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_leave_request(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION recalculate_payroll_run_totals(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION recalculate_payroll_run_totals(UUID) TO service_role;
