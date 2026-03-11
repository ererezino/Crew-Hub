-- leave_type is varchar(50), so maternity_leave and paternity_leave
-- are supported as string values without schema changes.

-- Add medical_evidence_path to leave_requests for sick leave documentation
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS medical_evidence_path TEXT;
