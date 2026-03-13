-- ═══════════════════════════════════════════════════════════════
-- Staging Storage Setup — Run in Supabase Dashboard SQL Editor
-- Project: crew-hub-staging (rvcpvfmkjadbkvhmiklu)
-- ═══════════════════════════════════════════════════════════════

-- 1. Create storage buckets
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents', 'documents', false, 26214400,
  array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','image/png','image/jpeg']::text[]
)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts', 'receipts', false, 10485760,
  array['application/pdf','image/png','image/jpeg']::text[]
)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- 2. RLS is already enabled on storage.objects by default on hosted Supabase

-- 3. Documents bucket policies
drop policy if exists documents_bucket_select_visible_scope on storage.objects;
create policy documents_bucket_select_visible_scope
on storage.objects for select to authenticated
using (
  bucket_id = 'documents'
  and exists (
    select 1 from public.documents d
    where d.file_path = name
      and d.org_id = public.get_user_org_id()
      and d.deleted_at is null
      and (public.has_role('HR_ADMIN') or public.has_role('SUPER_ADMIN') or d.owner_user_id = auth.uid() or d.category = 'policy'::public.document_category)
  )
);

drop policy if exists documents_bucket_insert_org_prefix on storage.objects;
create policy documents_bucket_insert_org_prefix
on storage.objects for insert to authenticated
with check (bucket_id = 'documents' and position(public.get_user_org_id()::text || '/' in name) = 1);

drop policy if exists documents_bucket_update_org_prefix on storage.objects;
create policy documents_bucket_update_org_prefix
on storage.objects for update to authenticated
using (bucket_id = 'documents' and position(public.get_user_org_id()::text || '/' in name) = 1)
with check (bucket_id = 'documents' and position(public.get_user_org_id()::text || '/' in name) = 1);

drop policy if exists documents_bucket_delete_org_prefix on storage.objects;
create policy documents_bucket_delete_org_prefix
on storage.objects for delete to authenticated
using (bucket_id = 'documents' and position(public.get_user_org_id()::text || '/' in name) = 1);

-- 4. Receipts bucket policies
drop policy if exists receipts_bucket_select_scope on storage.objects;
create policy receipts_bucket_select_scope
on storage.objects for select to authenticated
using (
  bucket_id = 'receipts'
  and exists (
    select 1 from public.expenses expense
    where expense.receipt_file_path = name
      and expense.org_id = public.get_user_org_id()
      and expense.deleted_at is null
      and (
        expense.employee_id = auth.uid()
        or public.has_role('HR_ADMIN') or public.has_role('FINANCE_ADMIN') or public.has_role('SUPER_ADMIN')
        or (public.has_role('MANAGER') and exists (
          select 1 from public.profiles report
          where report.id = expense.employee_id and report.org_id = public.get_user_org_id()
            and report.deleted_at is null and report.manager_id = auth.uid()
        ))
      )
  )
);

drop policy if exists receipts_bucket_insert_org_prefix on storage.objects;
create policy receipts_bucket_insert_org_prefix
on storage.objects for insert to authenticated
with check (bucket_id = 'receipts' and position(public.get_user_org_id()::text || '/' in name) = 1);

drop policy if exists receipts_bucket_update_org_prefix on storage.objects;
create policy receipts_bucket_update_org_prefix
on storage.objects for update to authenticated
using (bucket_id = 'receipts' and position(public.get_user_org_id()::text || '/' in name) = 1)
with check (bucket_id = 'receipts' and position(public.get_user_org_id()::text || '/' in name) = 1);

drop policy if exists receipts_bucket_delete_org_prefix on storage.objects;
create policy receipts_bucket_delete_org_prefix
on storage.objects for delete to authenticated
using (bucket_id = 'receipts' and position(public.get_user_org_id()::text || '/' in name) = 1);

-- 5. Avatars bucket policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can upload own avatar') THEN
    CREATE POLICY "Users can upload own avatar" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update own avatar') THEN
    CREATE POLICY "Users can update own avatar" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'avatars');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can delete own avatar') THEN
    CREATE POLICY "Users can delete own avatar" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'avatars');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Avatars are publicly readable') THEN
    CREATE POLICY "Avatars are publicly readable" ON storage.objects FOR SELECT TO public USING (bucket_id = 'avatars');
  END IF;
END $$;

-- 6. Fix skipped migration: add deleted_at to announcement_attachments
ALTER TABLE public.announcement_attachments
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Done!
