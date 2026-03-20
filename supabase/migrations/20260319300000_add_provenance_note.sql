-- Add provenance_note to payroll_runs for historical import source tracking
ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS provenance_note text;
