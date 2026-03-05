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
  v_total_net_by_currency JSONB := '{}'::JSONB;
  v_item RECORD;
  v_item_deductions NUMERIC := 0;
  v_currency TEXT;
  v_current_amount NUMERIC;
BEGIN
  SELECT id, org_id
  INTO v_run
  FROM payroll_runs
  WHERE id = p_run_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Payroll run not found.');
  END IF;

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

    IF v_item.deductions IS NOT NULL AND jsonb_typeof(v_item.deductions) = 'object' THEN
      SELECT COALESCE(SUM((value)::NUMERIC), 0)
      INTO v_item_deductions
      FROM jsonb_each_text(v_item.deductions);

      v_total_deductions := v_total_deductions + COALESCE(v_item_deductions, 0);
    END IF;

    v_currency := UPPER(TRIM(v_item.pay_currency));
    v_current_amount := COALESCE((v_total_net_by_currency ->> v_currency)::NUMERIC, 0);
    v_total_net_by_currency := v_total_net_by_currency || jsonb_build_object(v_currency, v_current_amount + v_item.net_amount);
  END LOOP;

  UPDATE payroll_runs
  SET total_gross = v_total_gross,
      total_net = v_total_net_by_currency,
      updated_at = NOW()
  WHERE id = p_run_id;

  RETURN jsonb_build_object(
    'total_gross', v_total_gross,
    'total_net', v_total_net_by_currency,
    'total_deductions', v_total_deductions
  );
END;
$$;
