begin;

create table if not exists public.expense_comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  comment_type text not null check (comment_type in ('request_info', 'response')),
  message text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint expense_comments_message_check
    check (char_length(trim(message)) > 0 and char_length(message) <= 4000)
);

create index if not exists idx_expense_comments_org_expense_created
  on public.expense_comments(org_id, expense_id, created_at);

create index if not exists idx_expense_comments_expense_created
  on public.expense_comments(expense_id, created_at);

grant select, insert on table public.expense_comments to authenticated;

alter table public.expense_comments enable row level security;

drop trigger if exists set_expense_comments_updated_at on public.expense_comments;
create trigger set_expense_comments_updated_at
before update on public.expense_comments
for each row
execute function public.set_updated_at();

drop policy if exists expense_comments_select_scope on public.expense_comments;
create policy expense_comments_select_scope
on public.expense_comments
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and exists (
    select 1
    from public.expenses expense
    where expense.id = expense_comments.expense_id
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

drop policy if exists expense_comments_insert_scope on public.expense_comments;
create policy expense_comments_insert_scope
on public.expense_comments
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and author_id = auth.uid()
  and exists (
    select 1
    from public.expenses expense
    where expense.id = expense_comments.expense_id
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

commit;
