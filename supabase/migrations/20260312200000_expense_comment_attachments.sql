begin;

alter table public.expense_comments
  alter column message set default '';

alter table public.expense_comments
  drop constraint if exists expense_comments_message_check;

alter table public.expense_comments
  add constraint expense_comments_message_check
  check (char_length(message) <= 4000);

create table if not exists public.expense_comment_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  comment_id uuid not null references public.expense_comments(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  mime_type text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_expense_comment_attachments_org_comment_created
  on public.expense_comment_attachments(org_id, comment_id, created_at);

create index if not exists idx_expense_comment_attachments_comment_created
  on public.expense_comment_attachments(comment_id, created_at);

grant select, insert on table public.expense_comment_attachments to authenticated;

alter table public.expense_comment_attachments enable row level security;

drop policy if exists expense_comment_attachments_select_scope on public.expense_comment_attachments;
create policy expense_comment_attachments_select_scope
on public.expense_comment_attachments
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and exists (
    select 1
    from public.expense_comments comment
    join public.expenses expense
      on expense.id = comment.expense_id
    where comment.id = expense_comment_attachments.comment_id
      and comment.org_id = public.get_user_org_id()
      and comment.deleted_at is null
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

drop policy if exists expense_comment_attachments_insert_scope on public.expense_comment_attachments;
create policy expense_comment_attachments_insert_scope
on public.expense_comment_attachments
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and exists (
    select 1
    from public.expense_comments comment
    join public.expenses expense
      on expense.id = comment.expense_id
    where comment.id = expense_comment_attachments.comment_id
      and comment.org_id = public.get_user_org_id()
      and comment.deleted_at is null
      and comment.author_id = auth.uid()
      and expense.org_id = public.get_user_org_id()
      and expense.deleted_at is null
  )
);

commit;
