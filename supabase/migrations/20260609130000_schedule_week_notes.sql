-- Per-week notes for the scheduling grid — the free-text "Notes" column from the team's
-- Notion schedule (e.g. "Favour is on leave from the 26th"). One note per (schedule, week).

create table if not exists public.schedule_week_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  schedule_id uuid not null references public.schedules(id),
  week_start date not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint schedule_week_notes_unique_week unique (schedule_id, week_start)
);

create index if not exists idx_schedule_week_notes_schedule
  on public.schedule_week_notes(org_id, schedule_id)
  where deleted_at is null;

drop trigger if exists set_schedule_week_notes_updated_at on public.schedule_week_notes;
create trigger set_schedule_week_notes_updated_at
before update on public.schedule_week_notes
for each row
execute function public.set_updated_at();

grant select, insert, update, delete on table public.schedule_week_notes to authenticated;

alter table public.schedule_week_notes enable row level security;

drop policy if exists schedule_week_notes_select_org on public.schedule_week_notes;
create policy schedule_week_notes_select_org
on public.schedule_week_notes
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
);
