CREATE TABLE IF NOT EXISTS work_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  assigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  item_type TEXT NOT NULL CHECK (
    item_type IN (
      'laptop',
      'phone',
      'mouse',
      'webcam',
      'keyboard',
      'headset',
      'monitor',
      'microphone',
      'earbuds',
      'other'
    )
  ),
  item_name TEXT NOT NULL,
  serial_number TEXT,
  transaction_currency TEXT,
  cost_amount NUMERIC(12, 2),
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (
    status IN (
      'assigned',
      'maintenance',
      'available',
      'returned',
      'retired',
      'lost',
      'stolen'
    )
  ),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  returned_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_work_tools_org_employee
  ON work_tools (org_id, employee_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_work_tools_org_status
  ON work_tools (org_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_work_tools_org_item_type
  ON work_tools (org_id, item_type)
  WHERE deleted_at IS NULL;

ALTER TABLE work_tools ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_work_tools_updated_at ON public.work_tools;
CREATE TRIGGER set_work_tools_updated_at
BEFORE UPDATE ON public.work_tools
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS work_tool_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tool_id UUID REFERENCES work_tools(id) ON DELETE SET NULL,
  request_kind TEXT NOT NULL CHECK (
    request_kind IN ('tool_request', 'issue_report')
  ),
  requested_item_type TEXT CHECK (
    requested_item_type IS NULL OR requested_item_type IN (
      'laptop',
      'phone',
      'mouse',
      'webcam',
      'keyboard',
      'headset',
      'monitor',
      'microphone',
      'earbuds',
      'other'
    )
  ),
  issue_type TEXT CHECK (
    issue_type IS NULL OR issue_type IN (
      'faulty',
      'stolen',
      'not_in_possession',
      'spec_mismatch'
    )
  ),
  details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN (
      'open',
      'in_review',
      'approved',
      'fulfilled',
      'resolved',
      'declined'
    )
  ),
  hr_notes TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT work_tool_requests_kind_shape_check CHECK (
    (
      request_kind = 'tool_request'
      AND requested_item_type IS NOT NULL
      AND issue_type IS NULL
    )
    OR
    (
      request_kind = 'issue_report'
      AND tool_id IS NOT NULL
      AND issue_type IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_work_tool_requests_org_employee
  ON work_tool_requests (org_id, employee_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_work_tool_requests_org_status
  ON work_tool_requests (org_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_work_tool_requests_tool
  ON work_tool_requests (tool_id, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE work_tool_requests ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_work_tool_requests_updated_at ON public.work_tool_requests;
CREATE TRIGGER set_work_tool_requests_updated_at
BEFORE UPDATE ON public.work_tool_requests
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION sync_work_tool_return_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('available', 'returned', 'retired')
     AND NEW.returned_at IS NULL THEN
    NEW.returned_at := NOW();
  END IF;

  IF NEW.status = 'available' AND NEW.employee_id IS NOT NULL THEN
    NEW.employee_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_work_tool_return_fields ON work_tools;
CREATE TRIGGER trg_sync_work_tool_return_fields
BEFORE INSERT OR UPDATE OF status, employee_id, returned_at
ON work_tools
FOR EACH ROW
EXECUTE FUNCTION sync_work_tool_return_fields();

CREATE OR REPLACE FUNCTION sync_work_tool_request_resolution_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('fulfilled', 'resolved', 'declined')
     AND NEW.resolved_at IS NULL THEN
    NEW.resolved_at := NOW();
  ELSIF NEW.status IN ('open', 'in_review', 'approved') THEN
    NEW.resolved_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_work_tool_request_resolution_fields ON work_tool_requests;
CREATE TRIGGER trg_sync_work_tool_request_resolution_fields
BEFORE INSERT OR UPDATE OF status, resolved_at
ON work_tool_requests
FOR EACH ROW
EXECUTE FUNCTION sync_work_tool_request_resolution_fields();
