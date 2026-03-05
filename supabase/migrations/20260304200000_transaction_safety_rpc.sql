-- Phase 2C: Atomic database transaction functions
-- All-or-nothing operations for leave approval, rejection, and payroll recalculation.

-- ─── Function 1: approve_leave_request ───
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
  -- 1. Lock the leave_request row to prevent race conditions
  SELECT *
  INTO v_request
  FROM leave_requests
  WHERE id = p_request_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Leave request not found.');
  END IF;

  -- 2. Verify current status is exactly pending
  IF v_request.status != 'pending' THEN
    RETURN jsonb_build_object('error', 'Only pending requests can be approved. Current status: ' || v_request.status);
  END IF;

  v_total_days := COALESCE(v_request.total_days, 0);
  v_year := EXTRACT(YEAR FROM v_request.start_date)::INT;
  v_is_unlimited := v_request.leave_type IN ('sick_leave', 'bereavement', 'compassionate');

  -- 3. Update leave_requests status
  UPDATE leave_requests
  SET status = 'approved',
      approver_id = p_approver_id,
      rejection_reason = NULL,
      updated_at = NOW()
  WHERE id = p_request_id;

  -- 4. Update leave_balances (skip for unlimited leave types)
  IF NOT v_is_unlimited AND v_total_days > 0 THEN
    UPDATE leave_balances
    SET used_days = used_days + v_total_days,
        pending_days = GREATEST(pending_days - v_total_days, 0),
        updated_at = NOW()
    WHERE employee_id = v_request.employee_id
      AND leave_type = v_request.leave_type
      AND year = v_year
      AND org_id = v_request.org_id;

    -- If no balance row existed, insert one
    IF NOT FOUND THEN
      INSERT INTO leave_balances (org_id, employee_id, leave_type, year, allocated_days, used_days, pending_days)
      VALUES (v_request.org_id, v_request.employee_id, v_request.leave_type, v_year, 0, v_total_days, 0)
      ON CONFLICT (org_id, employee_id, leave_type, year) DO UPDATE
      SET used_days = leave_balances.used_days + v_total_days,
          pending_days = GREATEST(leave_balances.pending_days - v_total_days, 0),
          updated_at = NOW();
    END IF;
  END IF;

  -- 5. Insert audit_log entry
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

  -- 6. Return the updated leave_request
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


-- ─── Function 2: reject_leave_request ───
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
  -- 1. Lock the leave_request row
  SELECT *
  INTO v_request
  FROM leave_requests
  WHERE id = p_request_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Leave request not found.');
  END IF;

  -- 2. Verify current status is pending
  IF v_request.status != 'pending' THEN
    RETURN jsonb_build_object('error', 'Only pending requests can be rejected. Current status: ' || v_request.status);
  END IF;

  v_total_days := COALESCE(v_request.total_days, 0);
  v_year := EXTRACT(YEAR FROM v_request.start_date)::INT;
  v_is_unlimited := v_request.leave_type IN ('sick_leave', 'bereavement', 'compassionate');

  -- 3. Update leave_requests status
  UPDATE leave_requests
  SET status = 'rejected',
      approver_id = p_approver_id,
      rejection_reason = p_reason,
      updated_at = NOW()
  WHERE id = p_request_id;

  -- 4. Update leave_balances: reduce pending_days (skip for unlimited)
  IF NOT v_is_unlimited AND v_total_days > 0 THEN
    UPDATE leave_balances
    SET pending_days = GREATEST(pending_days - v_total_days, 0),
        updated_at = NOW()
    WHERE employee_id = v_request.employee_id
      AND leave_type = v_request.leave_type
      AND year = v_year
      AND org_id = v_request.org_id;
  END IF;

  -- 5. Insert audit_log entry
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

  -- 6. Return updated row
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


-- ─── Function 3: recalculate_payroll_run_totals ───
CREATE OR REPLACE FUNCTION recalculate_payroll_run_totals(
  p_run_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_run RECORD;
  v_total_gross NUMERIC := 0;
  v_total_net NUMERIC := 0;
  v_total_deductions NUMERIC := 0;
  v_item_deductions NUMERIC := 0;
  v_total_net_by_currency JSONB := '{}'::JSONB;
  v_item RECORD;
  v_currency TEXT;
  v_current_amount NUMERIC;
BEGIN
  -- Verify the run exists
  SELECT id, org_id
  INTO v_run
  FROM payroll_runs
  WHERE id = p_run_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Payroll run not found.');
  END IF;

  -- Aggregate from payroll_items
  FOR v_item IN
    SELECT
      COALESCE(gross_amount, 0) AS gross_amount,
      COALESCE(net_amount, 0) AS net_amount,
      COALESCE(pay_currency, 'USD') AS pay_currency,
      deductions
    FROM payroll_items
    WHERE payroll_run_id = p_run_id
      AND deleted_at IS NULL
  LOOP
    v_total_gross := v_total_gross + v_item.gross_amount;
    v_total_net := v_total_net + v_item.net_amount;

    -- Sum deductions from JSONB if present
    IF v_item.deductions IS NOT NULL AND jsonb_typeof(v_item.deductions) = 'object' THEN
      SELECT COALESCE(SUM((value)::NUMERIC), 0)
      INTO v_item_deductions
      FROM jsonb_each_text(v_item.deductions);
      v_total_deductions := v_total_deductions + v_item_deductions;
    END IF;

    -- Build net totals by currency
    v_currency := UPPER(TRIM(v_item.pay_currency));
    v_current_amount := COALESCE((v_total_net_by_currency ->> v_currency)::NUMERIC, 0);
    v_total_net_by_currency := v_total_net_by_currency || jsonb_build_object(v_currency, v_current_amount + v_item.net_amount);
  END LOOP;

  -- Update payroll_runs with recalculated totals
  UPDATE payroll_runs
  SET total_gross = v_total_gross,
      total_net = v_total_net_by_currency,
      updated_at = NOW()
  WHERE id = p_run_id;

  -- Return the updated totals
  RETURN jsonb_build_object(
    'total_gross', v_total_gross,
    'total_net', v_total_net_by_currency,
    'total_deductions', v_total_deductions
  );
END;
$$;
