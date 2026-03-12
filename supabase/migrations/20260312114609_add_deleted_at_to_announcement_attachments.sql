-- Add missing deleted_at column to announcement_attachments for soft-delete support
ALTER TABLE public.announcement_attachments
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Replace the FOR DELETE policy with a FOR UPDATE policy for soft-delete
DROP POLICY IF EXISTS announcement_attachments_delete ON public.announcement_attachments;
CREATE POLICY announcement_attachments_update ON public.announcement_attachments
  FOR UPDATE TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM public.profiles WHERE id = auth.uid() AND deleted_at IS NULL
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM public.profiles WHERE id = auth.uid() AND deleted_at IS NULL
    )
  );
