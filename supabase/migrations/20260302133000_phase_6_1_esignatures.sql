begin;

create table if not exists public.signature_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  document_id uuid not null references public.documents(id),
  title varchar(200) not null,
  message text,
  status varchar(24) not null default 'pending'
    check (status in ('pending', 'partially_signed', 'completed', 'voided', 'expired')),
  created_by uuid not null references public.profiles(id),
  sent_at timestamptz not null default now(),
  completed_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_signature_requests_org_status_created
  on public.signature_requests(org_id, status, created_at desc);

create index if not exists idx_signature_requests_document
  on public.signature_requests(document_id);

create index if not exists idx_signature_requests_creator
  on public.signature_requests(created_by);

create table if not exists public.signature_signers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  signature_request_id uuid not null references public.signature_requests(id),
  signer_user_id uuid not null references public.profiles(id),
  signer_order integer not null default 1 check (signer_order > 0),
  status varchar(24) not null default 'pending'
    check (status in ('pending', 'viewed', 'signed', 'declined')),
  viewed_at timestamptz,
  signed_at timestamptz,
  declined_at timestamptz,
  decline_reason text,
  signature_text varchar(120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (signature_request_id, signer_user_id)
);

create index if not exists idx_signature_signers_org_user_status
  on public.signature_signers(org_id, signer_user_id, status, created_at desc);

create index if not exists idx_signature_signers_request_order
  on public.signature_signers(signature_request_id, signer_order);

create table if not exists public.signature_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  signature_request_id uuid not null references public.signature_requests(id),
  actor_user_id uuid references public.profiles(id),
  event_type varchar(24) not null
    check (event_type in ('created', 'viewed', 'signed', 'declined', 'voided', 'completed', 'reminded')),
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_signature_events_request_created
  on public.signature_events(signature_request_id, created_at desc);

create index if not exists idx_signature_events_org_created
  on public.signature_events(org_id, created_at desc);

drop trigger if exists set_signature_requests_updated_at on public.signature_requests;
create trigger set_signature_requests_updated_at
before update on public.signature_requests
for each row
execute function public.set_updated_at();

drop trigger if exists set_signature_signers_updated_at on public.signature_signers;
create trigger set_signature_signers_updated_at
before update on public.signature_signers
for each row
execute function public.set_updated_at();

grant select, insert, update on table public.signature_requests to authenticated;
grant select, insert, update on table public.signature_signers to authenticated;
grant select, insert on table public.signature_events to authenticated;

alter table public.signature_requests enable row level security;
alter table public.signature_signers enable row level security;
alter table public.signature_events enable row level security;

drop policy if exists signature_requests_select_scope on public.signature_requests;
create policy signature_requests_select_scope
on public.signature_requests
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or created_by = auth.uid()
    or exists (
      select 1
      from public.signature_signers ss
      where ss.signature_request_id = signature_requests.id
        and ss.org_id = public.get_user_org_id()
        and ss.deleted_at is null
        and ss.signer_user_id = auth.uid()
    )
  )
);

drop policy if exists signature_requests_insert_admin on public.signature_requests;
create policy signature_requests_insert_admin
on public.signature_requests
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and created_by = auth.uid()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists signature_requests_update_admin on public.signature_requests;
create policy signature_requests_update_admin
on public.signature_requests
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

drop policy if exists signature_signers_select_scope on public.signature_signers;
create policy signature_signers_select_scope
on public.signature_signers
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or signer_user_id = auth.uid()
    or exists (
      select 1
      from public.signature_requests sr
      where sr.id = signature_request_id
        and sr.org_id = public.get_user_org_id()
        and sr.deleted_at is null
        and sr.created_by = auth.uid()
    )
  )
);

drop policy if exists signature_signers_insert_admin on public.signature_signers;
create policy signature_signers_insert_admin
on public.signature_signers
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
  and exists (
    select 1
    from public.signature_requests sr
    where sr.id = signature_request_id
      and sr.org_id = public.get_user_org_id()
      and sr.deleted_at is null
  )
);

drop policy if exists signature_signers_update_admin on public.signature_signers;
create policy signature_signers_update_admin
on public.signature_signers
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

drop policy if exists signature_signers_update_self on public.signature_signers;
create policy signature_signers_update_self
on public.signature_signers
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and signer_user_id = auth.uid()
)
with check (
  org_id = public.get_user_org_id()
  and signer_user_id = auth.uid()
);

drop policy if exists signature_events_select_scope on public.signature_events;
create policy signature_events_select_scope
on public.signature_events
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or exists (
      select 1
      from public.signature_requests sr
      where sr.id = signature_request_id
        and sr.org_id = public.get_user_org_id()
        and sr.deleted_at is null
        and (
          sr.created_by = auth.uid()
          or exists (
            select 1
            from public.signature_signers ss
            where ss.signature_request_id = sr.id
              and ss.org_id = public.get_user_org_id()
              and ss.deleted_at is null
              and ss.signer_user_id = auth.uid()
          )
        )
    )
  )
);

drop policy if exists signature_events_insert_scope on public.signature_events;
create policy signature_events_insert_scope
on public.signature_events
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (actor_user_id is null or actor_user_id = auth.uid())
  and exists (
    select 1
    from public.signature_requests sr
    where sr.id = signature_request_id
      and sr.org_id = public.get_user_org_id()
      and sr.deleted_at is null
  )
);

commit;
