begin;

-- Multiple receipts/documents per expense.
-- expenses.receipt_file_path is retained as the "primary" pointer for backward
-- compatibility; the authoritative set of documents now lives here, one row per
-- file. Existing receipts are backfilled below so every expense keeps its
-- document.

create table if not exists public.expense_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes > 0),
  mime_type text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_expense_attachments_org_expense_order
  on public.expense_attachments(org_id, expense_id, sort_order, created_at);

create index if not exists idx_expense_attachments_expense_order
  on public.expense_attachments(expense_id, sort_order, created_at);

grant select, insert, update on table public.expense_attachments to authenticated;

alter table public.expense_attachments enable row level security;

-- A user may read an attachment when they may read its parent expense.
drop policy if exists expense_attachments_select_scope on public.expense_attachments;
create policy expense_attachments_select_scope
on public.expense_attachments
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and exists (
    select 1
    from public.expenses expense
    where expense.id = expense_attachments.expense_id
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

-- The expense owner (or an admin) may attach documents to their own expense.
drop policy if exists expense_attachments_insert_scope on public.expense_attachments;
create policy expense_attachments_insert_scope
on public.expense_attachments
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and exists (
    select 1
    from public.expenses expense
    where expense.id = expense_attachments.expense_id
      and expense.org_id = public.get_user_org_id()
      and expense.deleted_at is null
      and (
        expense.employee_id = auth.uid()
        or public.has_role('HR_ADMIN')
        or public.has_role('FINANCE_ADMIN')
        or public.has_role('SUPER_ADMIN')
      )
  )
);

-- Soft-delete (set deleted_at) of an attachment is permitted to the owner or an
-- admin via the same scope.
drop policy if exists expense_attachments_update_scope on public.expense_attachments;
create policy expense_attachments_update_scope
on public.expense_attachments
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and exists (
    select 1
    from public.expenses expense
    where expense.id = expense_attachments.expense_id
      and expense.org_id = public.get_user_org_id()
      and expense.deleted_at is null
      and (
        expense.employee_id = auth.uid()
        or public.has_role('HR_ADMIN')
        or public.has_role('FINANCE_ADMIN')
        or public.has_role('SUPER_ADMIN')
      )
  )
)
with check (
  org_id = public.get_user_org_id()
);

-- Backfill: one attachment row per existing expense, pointing at its current
-- receipt. Idempotent — only inserts when the expense has no attachment yet.
insert into public.expense_attachments (org_id, expense_id, file_name, file_path, sort_order, created_at)
select
  e.org_id,
  e.id,
  regexp_replace(e.receipt_file_path, '^.*/', '') as file_name,
  e.receipt_file_path,
  0,
  e.created_at
from public.expenses e
where e.receipt_file_path is not null
  and e.receipt_file_path <> ''
  and not exists (
    select 1
    from public.expense_attachments a
    where a.expense_id = e.id
      and a.deleted_at is null
  );

-- Let users read any of an expense's attachment files directly (defense in
-- depth; the app serves signed URLs via the service role). Replaces the
-- receipt-only select policy with one that also covers attachment paths.
drop policy if exists receipts_bucket_select_scope on storage.objects;
create policy receipts_bucket_select_scope
on storage.objects
for select
to authenticated
using (
  bucket_id = 'receipts'
  and (
    exists (
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
    or exists (
      select 1
      from public.expense_attachments attachment
      join public.expenses expense
        on expense.id = attachment.expense_id
      where attachment.file_path = name
        and attachment.org_id = public.get_user_org_id()
        and attachment.deleted_at is null
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
  )
);

commit;
