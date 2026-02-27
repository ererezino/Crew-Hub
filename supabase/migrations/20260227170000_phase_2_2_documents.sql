begin;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'document_category'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.document_category as enum ('policy');
  end if;
end;
$$;

alter type public.document_category add value if not exists 'contract';
alter type public.document_category add value if not exists 'id_document';
alter type public.document_category add value if not exists 'tax_form';
alter type public.document_category add value if not exists 'compliance';
alter type public.document_category add value if not exists 'payroll_statement';
alter type public.document_category add value if not exists 'other';

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  owner_user_id uuid references public.profiles(id),
  category public.document_category not null,
  title varchar(200) not null,
  description text,
  file_path text not null,
  file_name varchar(255) not null,
  mime_type varchar(120) not null,
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 26214400),
  expiry_date date,
  country_code varchar(2),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_documents_org_category_created
  on public.documents(org_id, category, created_at desc);

create index if not exists idx_documents_owner
  on public.documents(owner_user_id);

create index if not exists idx_documents_org_expiry
  on public.documents(org_id, expiry_date);

create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  document_id uuid not null references public.documents(id),
  version integer not null check (version > 0),
  file_path text not null,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (document_id, version)
);

create index if not exists idx_document_versions_document_version
  on public.document_versions(document_id, version desc);

create index if not exists idx_document_versions_org_created
  on public.document_versions(org_id, created_at desc);

drop trigger if exists set_documents_updated_at on public.documents;
create trigger set_documents_updated_at
before update on public.documents
for each row
execute function public.set_updated_at();

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'documents',
  'documents',
  false,
  26214400,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'image/png',
    'image/jpeg'
  ]::text[]
)
on conflict (id)
do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

grant select, insert, update on table public.documents to authenticated;
grant select, insert on table public.document_versions to authenticated;

alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table storage.objects enable row level security;

drop policy if exists documents_select_visible_scope on public.documents;
create policy documents_select_visible_scope
on public.documents
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or owner_user_id = auth.uid()
    or category = 'policy'::public.document_category
  )
);

drop policy if exists documents_insert_admin_scope on public.documents;
create policy documents_insert_admin_scope
on public.documents
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists documents_insert_self_service on public.documents;
create policy documents_insert_self_service
on public.documents
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and owner_user_id = auth.uid()
  and category in (
    'id_document'::public.document_category,
    'tax_form'::public.document_category
  )
);

drop policy if exists documents_update_admin_scope on public.documents;
create policy documents_update_admin_scope
on public.documents
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

drop policy if exists documents_update_self_service on public.documents;
create policy documents_update_self_service
on public.documents
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and owner_user_id = auth.uid()
  and category in (
    'id_document'::public.document_category,
    'tax_form'::public.document_category
  )
)
with check (
  org_id = public.get_user_org_id()
  and owner_user_id = auth.uid()
  and category in (
    'id_document'::public.document_category,
    'tax_form'::public.document_category
  )
);

drop policy if exists document_versions_select_visible_scope on public.document_versions;
create policy document_versions_select_visible_scope
on public.document_versions
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and exists (
    select 1
    from public.documents d
    where d.id = document_id
      and d.org_id = public.get_user_org_id()
      and d.deleted_at is null
      and (
        public.has_role('HR_ADMIN')
        or public.has_role('SUPER_ADMIN')
        or d.owner_user_id = auth.uid()
        or d.category = 'policy'::public.document_category
      )
  )
);

drop policy if exists document_versions_insert_admin_scope on public.document_versions;
create policy document_versions_insert_admin_scope
on public.document_versions
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and uploaded_by = auth.uid()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
  and exists (
    select 1
    from public.documents d
    where d.id = document_id
      and d.org_id = public.get_user_org_id()
      and d.deleted_at is null
  )
);

drop policy if exists document_versions_insert_self_service on public.document_versions;
create policy document_versions_insert_self_service
on public.document_versions
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and uploaded_by = auth.uid()
  and exists (
    select 1
    from public.documents d
    where d.id = document_id
      and d.org_id = public.get_user_org_id()
      and d.deleted_at is null
      and d.owner_user_id = auth.uid()
      and d.category in (
        'id_document'::public.document_category,
        'tax_form'::public.document_category
      )
  )
);

drop policy if exists documents_bucket_select_visible_scope on storage.objects;
create policy documents_bucket_select_visible_scope
on storage.objects
for select
to authenticated
using (
  bucket_id = 'documents'
  and exists (
    select 1
    from public.documents d
    where d.file_path = name
      and d.org_id = public.get_user_org_id()
      and d.deleted_at is null
      and (
        public.has_role('HR_ADMIN')
        or public.has_role('SUPER_ADMIN')
        or d.owner_user_id = auth.uid()
        or d.category = 'policy'::public.document_category
      )
  )
);

drop policy if exists documents_bucket_insert_org_prefix on storage.objects;
create policy documents_bucket_insert_org_prefix
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'documents'
  and position(public.get_user_org_id()::text || '/' in name) = 1
);

drop policy if exists documents_bucket_update_org_prefix on storage.objects;
create policy documents_bucket_update_org_prefix
on storage.objects
for update
to authenticated
using (
  bucket_id = 'documents'
  and position(public.get_user_org_id()::text || '/' in name) = 1
)
with check (
  bucket_id = 'documents'
  and position(public.get_user_org_id()::text || '/' in name) = 1
);

commit;
