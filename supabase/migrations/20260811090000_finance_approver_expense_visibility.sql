-- ============================================================================
-- Migration: FINANCE_APPROVER expense-stack RLS parity
--
-- Root cause: FINANCE_APPROVER was added (20260318000000) as the CFO-level
-- finance role for payroll governance, and every app-layer expense gate
-- (canFinanceApproveExpenses, payment-proof upload, comments, approvals UI)
-- already treats it as a full finance operator — but the expense RLS policies
-- were never extended past FINANCE_ADMIN. Result for FINANCE_APPROVER users:
-- RLS-scoped reads return zero rows, so receipt downloads 404 ("receipt not
-- found"), payment-proof uploads 404 ("expense not found"), and the expenses
-- list/detail only show their own submissions while the UI renders finance
-- affordances that then fail.
--
-- Fix: recreate the nine expense-stack policies with FINANCE_APPROVER granted
-- wherever FINANCE_ADMIN is granted. No schema or data changes; purely policy
-- recreation (drop + create), idempotent, and reversible by re-running the
-- prior definitions (20260228070000, 20260303091000, 20260312130000,
-- 20260312200000, 20260512090000).
-- ============================================================================

begin;

-- ── 1. expenses SELECT: org-wide visibility for finance roles ──────────────
drop policy if exists expenses_select_scope on public.expenses;
create policy expenses_select_scope
on public.expenses
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
    or (
      public.has_role('MANAGER')
      and exists (
        select 1
        from public.profiles report
        where report.id = expenses.employee_id
          and report.org_id = public.get_user_org_id()
          and report.deleted_at is null
          and report.manager_id = auth.uid()
      )
    )
  )
);

-- ── 2. expenses UPDATE: finance-stage transitions for finance roles ────────
drop policy if exists expenses_update_scope on public.expenses;
create policy expenses_update_scope
on public.expenses
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    (
      employee_id = auth.uid()
      and status = 'pending'
    )
    or (
      status = 'pending'
      and (
        public.has_role('SUPER_ADMIN')
        or (
          public.has_role('MANAGER')
          and employee_id <> auth.uid()
          and exists (
            select 1
            from public.profiles report
            where report.id = expenses.employee_id
              and report.org_id = public.get_user_org_id()
              and report.deleted_at is null
              and report.manager_id = auth.uid()
          )
        )
      )
    )
    or (
      status = 'manager_approved'
      and (
        public.has_role('FINANCE_ADMIN')
        or public.has_role('FINANCE_APPROVER')
        or public.has_role('SUPER_ADMIN')
      )
    )
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    (
      employee_id = auth.uid()
      and status = 'cancelled'
    )
    or (
      status in ('manager_approved', 'rejected')
      and (
        public.has_role('SUPER_ADMIN')
        or (
          public.has_role('MANAGER')
          and employee_id <> auth.uid()
          and exists (
            select 1
            from public.profiles report
            where report.id = expenses.employee_id
              and report.org_id = public.get_user_org_id()
              and report.deleted_at is null
              and report.manager_id = auth.uid()
          )
        )
      )
    )
    or (
      status in ('reimbursed', 'finance_rejected')
      and (
        public.has_role('FINANCE_ADMIN')
        or public.has_role('FINANCE_APPROVER')
        or public.has_role('SUPER_ADMIN')
      )
    )
  )
);

-- ── 3. expense_comments SELECT ─────────────────────────────────────────────
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
        or public.has_role('FINANCE_APPROVER')
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

-- ── 4. expense_comments INSERT ─────────────────────────────────────────────
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
        or public.has_role('FINANCE_APPROVER')
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

-- ── 5. expense_comment_attachments SELECT ──────────────────────────────────
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
        or public.has_role('FINANCE_APPROVER')
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

-- ── 6. expense_attachments SELECT ──────────────────────────────────────────
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
        or public.has_role('FINANCE_APPROVER')
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

-- ── 7. expense_attachments INSERT ──────────────────────────────────────────
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
        or public.has_role('FINANCE_APPROVER')
        or public.has_role('SUPER_ADMIN')
      )
  )
);

-- ── 8. expense_attachments UPDATE (soft delete) ────────────────────────────
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
        or public.has_role('FINANCE_APPROVER')
        or public.has_role('SUPER_ADMIN')
      )
  )
)
with check (
  org_id = public.get_user_org_id()
);

-- ── 9. receipts bucket SELECT (defense in depth; app serves signed URLs) ───
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
          or public.has_role('FINANCE_APPROVER')
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
          or public.has_role('FINANCE_APPROVER')
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
