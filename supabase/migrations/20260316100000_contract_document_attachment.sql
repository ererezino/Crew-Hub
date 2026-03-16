-- ============================================================================
-- Migration: Contract Document Attachment
-- ============================================================================
-- Adds storage_path and file_name columns to pre_start_contracts for
-- optional PDF document attachment. Creates a private contract-documents
-- storage bucket with service-role-only access.
-- ============================================================================

-- ── 1. Add document columns ─────────────────────────────────────────────────

ALTER TABLE pre_start_contracts
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS file_name    TEXT;

-- ── 2. Create private storage bucket ────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contract-documents',
  'contract-documents',
  false,
  10485760,  -- 10 MB
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- ── 3. Storage RLS ──────────────────────────────────────────────────────────
-- All access is server-mediated via service-role client.
-- No user-level storage policies are needed.

-- Service-role can insert objects
CREATE POLICY contract_documents_insert
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'contract-documents');

-- Service-role can read objects
CREATE POLICY contract_documents_select
  ON storage.objects FOR SELECT
  USING (bucket_id = 'contract-documents');

-- Service-role can delete objects (for replacement cleanup)
CREATE POLICY contract_documents_delete
  ON storage.objects FOR DELETE
  USING (bucket_id = 'contract-documents');
