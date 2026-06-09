ALTER TABLE public.work_tools
  ALTER COLUMN assigned_at DROP NOT NULL,
  ALTER COLUMN assigned_at DROP DEFAULT;
