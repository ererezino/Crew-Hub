begin;

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  title varchar(200) not null,
  body text not null,
  is_pinned boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_announcements_org_pinned_created
  on public.announcements(org_id, is_pinned desc, created_at desc);

create index if not exists idx_announcements_created_by
  on public.announcements(created_by);

create table if not exists public.announcement_reads (
  announcement_id uuid not null references public.announcements(id),
  user_id uuid not null references public.profiles(id),
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create index if not exists idx_announcement_reads_user_read_at
  on public.announcement_reads(user_id, read_at desc);

drop trigger if exists set_announcements_updated_at on public.announcements;
create trigger set_announcements_updated_at
before update on public.announcements
for each row
execute function public.set_updated_at();

grant select, insert, update on table public.announcements to authenticated;
grant select, insert, update on table public.announcement_reads to authenticated;

alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;

drop policy if exists announcements_select_org_scope on public.announcements;
create policy announcements_select_org_scope
on public.announcements
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
);

drop policy if exists announcements_insert_admin_scope on public.announcements;
create policy announcements_insert_admin_scope
on public.announcements
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists announcements_update_admin_scope on public.announcements;
create policy announcements_update_admin_scope
on public.announcements
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

drop policy if exists announcement_reads_select_own on public.announcement_reads;
create policy announcement_reads_select_own
on public.announcement_reads
for select
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.announcements a
    where a.id = announcement_id
      and a.org_id = public.get_user_org_id()
      and a.deleted_at is null
  )
);

drop policy if exists announcement_reads_insert_own on public.announcement_reads;
create policy announcement_reads_insert_own
on public.announcement_reads
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.announcements a
    where a.id = announcement_id
      and a.org_id = public.get_user_org_id()
      and a.deleted_at is null
  )
);

drop policy if exists announcement_reads_update_own on public.announcement_reads;
create policy announcement_reads_update_own
on public.announcement_reads
for update
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.announcements a
    where a.id = announcement_id
      and a.org_id = public.get_user_org_id()
      and a.deleted_at is null
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.announcements a
    where a.id = announcement_id
      and a.org_id = public.get_user_org_id()
      and a.deleted_at is null
  )
);

commit;
