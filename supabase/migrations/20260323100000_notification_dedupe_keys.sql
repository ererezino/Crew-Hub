begin;

alter table public.notifications
  add column if not exists dedupe_key text;

create unique index if not exists uq_notifications_org_user_dedupe_key
  on public.notifications(org_id, user_id, dedupe_key)
  where dedupe_key is not null and deleted_at is null;

commit;
