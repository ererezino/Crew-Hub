begin;

-- =========================================================================
-- Crew Games — crew_night_events, crew_night_results,
--              crew_night_leaderboard_adjustments, crew_night_presenters
-- =========================================================================

-- 1. crew_night_events
create table if not exists public.crew_night_events (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.orgs(id),
  event_type            text not null check (event_type in ('games_night', 'presentation_night')),
  title                 varchar(200) not null,
  event_date            date not null,
  status                text not null default 'draft' check (status in ('draft', 'upcoming', 'completed')),
  description           text,
  -- Games Night fields (null for presentation nights)
  meet_link             text,
  kahoot_link           text,
  alt_game_link         text,
  featured_game         text,
  -- Shared optional
  event_image_path      text,
  highlights            text,
  -- Publishing control
  published_at          timestamptz,
  results_published_at  timestamptz,
  -- Audit
  created_by            uuid not null references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);

create index if not exists idx_crew_night_events_org_type_date
  on public.crew_night_events(org_id, event_type, event_date desc);

drop trigger if exists set_crew_night_events_updated_at on public.crew_night_events;
create trigger set_crew_night_events_updated_at
before update on public.crew_night_events
for each row
execute function public.set_updated_at();

grant select, insert, update, delete on table public.crew_night_events to authenticated;

alter table public.crew_night_events enable row level security;

-- Select: everyone sees published events in their org; admins also see drafts
drop policy if exists crew_night_events_select_scope on public.crew_night_events;
create policy crew_night_events_select_scope
on public.crew_night_events
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    status in ('upcoming', 'completed')
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

-- Insert: admin only
drop policy if exists crew_night_events_insert_admin on public.crew_night_events;
create policy crew_night_events_insert_admin
on public.crew_night_events
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

-- Update: admin only
drop policy if exists crew_night_events_update_admin on public.crew_night_events;
create policy crew_night_events_update_admin
on public.crew_night_events
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

-- Delete: admin only
drop policy if exists crew_night_events_delete_admin on public.crew_night_events;
create policy crew_night_events_delete_admin
on public.crew_night_events
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);


-- 2. crew_night_results
create table if not exists public.crew_night_results (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  event_id        uuid not null references public.crew_night_events(id) on delete cascade,
  nickname        text not null,
  employee_id     uuid references public.profiles(id),
  score           numeric,
  placement       integer,
  points_awarded  integer not null default 0,
  created_at      timestamptz not null default now(),
  unique (event_id, nickname)
);

create index if not exists idx_crew_night_results_event
  on public.crew_night_results(event_id);

create index if not exists idx_crew_night_results_employee
  on public.crew_night_results(employee_id) where employee_id is not null;

grant select, insert, update, delete on table public.crew_night_results to authenticated;

alter table public.crew_night_results enable row level security;

drop policy if exists crew_night_results_select_scope on public.crew_night_results;
create policy crew_night_results_select_scope
on public.crew_night_results
for select
to authenticated
using (org_id = public.get_user_org_id());

drop policy if exists crew_night_results_insert_admin on public.crew_night_results;
create policy crew_night_results_insert_admin
on public.crew_night_results
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists crew_night_results_update_admin on public.crew_night_results;
create policy crew_night_results_update_admin
on public.crew_night_results
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists crew_night_results_delete_admin on public.crew_night_results;
create policy crew_night_results_delete_admin
on public.crew_night_results
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);


-- 3. crew_night_leaderboard_adjustments (Games Night only)
create table if not exists public.crew_night_leaderboard_adjustments (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  employee_id     uuid not null references public.profiles(id),
  season          text not null default '2026',
  points_delta    integer not null,
  reason          text not null,
  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now()
);

create index if not exists idx_crew_night_adj_org_employee_season
  on public.crew_night_leaderboard_adjustments(org_id, employee_id, season);

grant select, insert on table public.crew_night_leaderboard_adjustments to authenticated;

alter table public.crew_night_leaderboard_adjustments enable row level security;

drop policy if exists crew_night_adj_select_scope on public.crew_night_leaderboard_adjustments;
create policy crew_night_adj_select_scope
on public.crew_night_leaderboard_adjustments
for select
to authenticated
using (org_id = public.get_user_org_id());

drop policy if exists crew_night_adj_insert_admin on public.crew_night_leaderboard_adjustments;
create policy crew_night_adj_insert_admin
on public.crew_night_leaderboard_adjustments
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);


-- 4. crew_night_presenters
create table if not exists public.crew_night_presenters (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  event_id        uuid not null references public.crew_night_events(id) on delete cascade,
  employee_id     uuid not null references public.profiles(id),
  talk_title      text,
  slide_path      text,
  slide_filename  text,
  vote_count      integer not null default 0,
  is_winner       boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (event_id, employee_id)
);

create index if not exists idx_crew_night_presenters_event
  on public.crew_night_presenters(event_id);

grant select, insert, update, delete on table public.crew_night_presenters to authenticated;

alter table public.crew_night_presenters enable row level security;

drop policy if exists crew_night_presenters_select_scope on public.crew_night_presenters;
create policy crew_night_presenters_select_scope
on public.crew_night_presenters
for select
to authenticated
using (org_id = public.get_user_org_id());

drop policy if exists crew_night_presenters_insert_admin on public.crew_night_presenters;
create policy crew_night_presenters_insert_admin
on public.crew_night_presenters
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists crew_night_presenters_update_admin on public.crew_night_presenters;
create policy crew_night_presenters_update_admin
on public.crew_night_presenters
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists crew_night_presenters_delete_admin on public.crew_night_presenters;
create policy crew_night_presenters_delete_admin
on public.crew_night_presenters
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);


-- 5. Storage bucket for crew-nights
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'crew-nights',
  'crew-nights',
  false,
  26214400,
  array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]::text[]
)
on conflict (id)
do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage RLS: authenticated users in the same org can read
drop policy if exists crew_nights_bucket_select on storage.objects;
create policy crew_nights_bucket_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'crew-nights'
  and position(public.get_user_org_id()::text || '/' in name) = 1
);

-- Storage RLS: admins can upload
drop policy if exists crew_nights_bucket_insert on storage.objects;
create policy crew_nights_bucket_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'crew-nights'
  and position(public.get_user_org_id()::text || '/' in name) = 1
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

-- Storage RLS: admins can update (replace)
drop policy if exists crew_nights_bucket_update on storage.objects;
create policy crew_nights_bucket_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'crew-nights'
  and position(public.get_user_org_id()::text || '/' in name) = 1
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

-- Storage RLS: admins can delete
drop policy if exists crew_nights_bucket_delete on storage.objects;
create policy crew_nights_bucket_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'crew-nights'
  and position(public.get_user_org_id()::text || '/' in name) = 1
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

commit;
