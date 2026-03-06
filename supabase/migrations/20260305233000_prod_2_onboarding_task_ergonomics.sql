alter table public.onboarding_tasks
  add column if not exists action_url text,
  add column if not exists action_label varchar(120),
  add column if not exists completion_guidance text;

