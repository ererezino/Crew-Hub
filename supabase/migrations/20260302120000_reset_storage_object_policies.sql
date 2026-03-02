begin;

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

drop policy if exists documents_bucket_delete_org_prefix on storage.objects;
create policy documents_bucket_delete_org_prefix
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'documents'
  and position(public.get_user_org_id()::text || '/' in name) = 1
);

drop policy if exists receipts_bucket_select_scope on storage.objects;
create policy receipts_bucket_select_scope
on storage.objects
for select
to authenticated
using (
  bucket_id = 'receipts'
  and exists (
    select 1
    from public.expenses expense
    where expense.receipt_file_path = name
      and expense.org_id = public.get_user_org_id()
      and expense.deleted_at is null
      and (
        expense.employee_id = auth.uid()
        or public.has_role('HR_ADMIN')
        or public.has_role('FINANCE_ADMIN')
        or public.has_role('SUPER_ADMIN')
        or (
          public.has_role('MANAGER')
          and exists (
            select 1
            from public.profiles report
            where report.id = expense.employee_id
              and report.org_id = public.get_user_org_id()
              and report.deleted_at is null
              and report.manager_id = auth.uid()
          )
        )
      )
  )
);

drop policy if exists receipts_bucket_insert_org_prefix on storage.objects;
create policy receipts_bucket_insert_org_prefix
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'receipts'
  and position(public.get_user_org_id()::text || '/' in name) = 1
);

drop policy if exists receipts_bucket_update_org_prefix on storage.objects;
create policy receipts_bucket_update_org_prefix
on storage.objects
for update
to authenticated
using (
  bucket_id = 'receipts'
  and position(public.get_user_org_id()::text || '/' in name) = 1
)
with check (
  bucket_id = 'receipts'
  and position(public.get_user_org_id()::text || '/' in name) = 1
);

drop policy if exists receipts_bucket_delete_org_prefix on storage.objects;
create policy receipts_bucket_delete_org_prefix
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'receipts'
  and position(public.get_user_org_id()::text || '/' in name) = 1
);

commit;
