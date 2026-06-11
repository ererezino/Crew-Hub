-- Onboarding task dependencies
--
-- Tasks can now declare prerequisites: a task with unmet dependencies sits
-- in the existing 'blocked' status and flips to 'pending' automatically when
-- the last prerequisite completes. Template tasks (jsonb) reference each
-- other by position via a dependsOnTaskIndexes key; instance tasks carry the
-- resolved uuids so enforcement is a plain column check.

alter table public.onboarding_tasks
  add column if not exists depends_on_task_ids uuid[] not null default '{}';

create index if not exists idx_onboarding_tasks_depends_on
  on public.onboarding_tasks using gin (depends_on_task_ids)
  where deleted_at is null;
