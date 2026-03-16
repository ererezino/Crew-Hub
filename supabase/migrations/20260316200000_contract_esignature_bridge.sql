-- E-Signature Bridge for Pre-Start Contracts
--
-- Adds a nullable foreign key from pre_start_contracts to signature_requests
-- so that a contract can be linked to a single signature request. When the
-- signature request completes, the contract's signed_at is set automatically.
-- The UNIQUE constraint ensures one contract = one signature request.

ALTER TABLE pre_start_contracts
  ADD COLUMN IF NOT EXISTS signature_request_id UUID
    REFERENCES signature_requests(id);

-- Unique: each contract can be linked to at most one signature request.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pre_start_contracts_sig_req
  ON pre_start_contracts (signature_request_id)
  WHERE signature_request_id IS NOT NULL;

-- Reverse lookup: find contract by signature_request_id (used by sign route).
CREATE INDEX IF NOT EXISTS idx_pre_start_contracts_sig_req_lookup
  ON pre_start_contracts (signature_request_id)
  WHERE signature_request_id IS NOT NULL;
