begin;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  user_id uuid not null references public.profiles(id),
  type varchar(80) not null,
  title varchar(200) not null,
  body text not null,
  link text,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_notifications_org_user_created
  on public.notifications(org_id, user_id, created_at desc);

create index if not exists idx_notifications_org_user_unread
  on public.notifications(org_id, user_id, is_read, created_at desc);

create index if not exists idx_notifications_org_type_created
  on public.notifications(org_id, type, created_at desc);

grant select, insert, update on table public.notifications to authenticated;

alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
on public.notifications
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and user_id = auth.uid()
  and deleted_at is null
);

drop policy if exists notifications_insert_own on public.notifications;
create policy notifications_insert_own
on public.notifications
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and user_id = auth.uid()
);

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own
on public.notifications
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and user_id = auth.uid()
  and deleted_at is null
)
with check (
  org_id = public.get_user_org_id()
  and user_id = auth.uid()
);

commit;
