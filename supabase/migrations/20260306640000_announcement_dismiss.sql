-- Add dismissed_at to announcement_reads so users can archive announcements
alter table public.announcement_reads
  add column if not exists dismissed_at timestamptz;
