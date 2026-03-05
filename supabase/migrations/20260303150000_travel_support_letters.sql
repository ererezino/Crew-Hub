-- Travel support letter request statuses
CREATE TYPE travel_letter_status AS ENUM ('pending', 'approved', 'rejected');

-- Travel support letter requests
CREATE TABLE travel_support_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  employee_id UUID NOT NULL REFERENCES profiles(id),

  -- Request details
  destination_country TEXT NOT NULL,
  embassy_name TEXT NOT NULL,
  embassy_address TEXT,
  travel_start_date DATE NOT NULL,
  travel_end_date DATE NOT NULL,
  purpose TEXT NOT NULL,
  additional_notes TEXT,

  -- Approval
  status travel_letter_status NOT NULL DEFAULT 'pending',
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES profiles(id),
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,

  -- Generated document
  document_path TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- RLS
ALTER TABLE travel_support_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "travel_support_requests_org_scope"
  ON travel_support_requests FOR ALL
  USING (org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()));

-- Indexes
CREATE INDEX idx_travel_support_requests_employee ON travel_support_requests(employee_id);
CREATE INDEX idx_travel_support_requests_status ON travel_support_requests(status);
CREATE INDEX idx_travel_support_requests_org ON travel_support_requests(org_id);
