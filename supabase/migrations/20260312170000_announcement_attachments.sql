-- Announcement attachments table
CREATE TABLE IF NOT EXISTS public.announcement_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes <= 26214400),
  mime_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup by announcement
CREATE INDEX IF NOT EXISTS idx_announcement_attachments_announcement_id
  ON public.announcement_attachments(announcement_id);

-- RLS
ALTER TABLE public.announcement_attachments ENABLE ROW LEVEL SECURITY;

-- Select: any authenticated org member
CREATE POLICY announcement_attachments_select ON public.announcement_attachments
  FOR SELECT TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM public.profiles WHERE id = auth.uid() AND deleted_at IS NULL
    )
  );

-- Insert: org member (API enforces HR_ADMIN/SUPER_ADMIN role)
CREATE POLICY announcement_attachments_insert ON public.announcement_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM public.profiles WHERE id = auth.uid() AND deleted_at IS NULL
    )
  );

-- Delete: org member (API enforces SUPER_ADMIN role)
CREATE POLICY announcement_attachments_delete ON public.announcement_attachments
  FOR DELETE TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM public.profiles WHERE id = auth.uid() AND deleted_at IS NULL
    )
  );
