-- ============================================================================
-- Migration: expense-stack RLS completion
--
-- Completes 20260811090000 (FINANCE_APPROVER expense-stack parity), which fixed
-- the nine expense policies but left three adjacent gaps in the same incident
-- class:
--
-- 1. profiles: FINANCE_APPROVER was still absent from profiles_select_admin_scope,
--    so every expense surface that enriches rows with profiles via the
--    user-scoped client showed "Unknown user"/"No department" to approvers, and
--    the expense comments route 500'd for them (it must read the expense
--    owner's profile). FINANCE_APPROVER is doctrine-wise a superset of
--    FINANCE_ADMIN (see 20260318500000), so it joins the admin read scope.
--
-- 2. TEAM_LEAD operational leads: the approvals product admits TEAM_LEAD as a
--    first-class manager-stage approver (canManagerApproveExpenses, approvals
--    queue via service role), but every user-scoped read (receipt signed-URL
--    route, attachments list, comment threads) only had a MANAGER/manager_id
--    clause — so a team lead's "Receipt"/"Details" clicks 404'd on rows they
--    can approve. Reads now cover operational leads via
--    public.is_operational_lead_for(), which mirrors
--    lib/delegation.ts#listOperationalReportIds (team_lead_id link, falling
--    back to manager_id when team_lead_id is null). SECURITY DEFINER keeps the
--    check independent of profiles RLS (same pattern as get_user_department in
--    20260306610000) and avoids cross-policy coupling.
--
-- 3. receipts bucket UPDATE/DELETE were org-prefix-wide, letting ANY org member
--    overwrite/delete ANY receipt, payment proof, or comment attachment object
--    through the storage API — defeating the expense evidence lock. Writes are
--    now scoped to the caller's own `${org}/${uid}/` prefix. All app paths keep
--    working: user-client uploads/cleanups only touch `${org}/${uid}/…`;
--    payment-proof (`${org}/payment-proof/…`) and comment-attachment
--    (`${org}/expense-comment-attachments/…`) cleanup already runs via the
--    service role, and INSERT stays org-prefix because those two upload paths
--    use the user client.
--
-- Purely policy/function recreation: no schema or data changes, idempotent,
-- reversible by re-running the prior definitions (20260227100000,
-- 20260302120000, 20260811090000).
-- ============================================================================

begin;

-- ── 0. Operational-lead helper (mirrors listOperationalReportIds) ───────────
create or replace function public.is_operational_lead_for(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles report
    where report.id = p_employee_id
      and report.org_id = public.get_user_org_id()
      and report.deleted_at is null
      and (
        report.team_lead_id = auth.uid()
        or (report.team_lead_id is null and report.manager_id = auth.uid())
      )
  );
$$;

revoke all on function public.is_operational_lead_for(uuid) from public;
grant execute on function public.is_operational_lead_for(uuid) to authenticated;

-- ── 1. profiles SELECT: FINANCE_APPROVER joins the admin read scope ─────────
drop policy if exists profiles_select_admin_scope on public.profiles;
create policy profiles_select_admin_scope
on public.profiles
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('FINANCE_APPROVER')
    or public.has_role('SUPER_ADMIN')
  )
);

-- ── 2. expenses SELECT: + TEAM_LEAD operational-lead clause ──────────────────
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
    or (
      public.has_role('TEAM_LEAD')
      and public.is_operational_lead_for(expenses.employee_id)
    )
  )
);

-- ── 3. expense_comments SELECT: + TEAM_LEAD operational-lead clause ─────────
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
        or (
          public.has_role('TEAM_LEAD')
          and public.is_operational_lead_for(expense.employee_id)
        )
      )
  )
);

-- ── 4. expense_comments INSERT: + TEAM_LEAD operational-lead clause ─────────
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
        or (
          public.has_role('TEAM_LEAD')
          and public.is_operational_lead_for(expense.employee_id)
        )
      )
  )
);

-- ── 5. expense_comment_attachments SELECT: + TEAM_LEAD clause ───────────────
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
        or (
          public.has_role('TEAM_LEAD')
          and public.is_operational_lead_for(expense.employee_id)
        )
      )
  )
);

-- ── 6. expense_attachments SELECT: + TEAM_LEAD operational-lead clause ──────
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
        or (
          public.has_role('TEAM_LEAD')
          and public.is_operational_lead_for(expense.employee_id)
        )
      )
  )
);

-- ── 7. receipts bucket SELECT: + TEAM_LEAD clause in both arms ──────────────
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
          or (
            public.has_role('TEAM_LEAD')
            and public.is_operational_lead_for(expense.employee_id)
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
          or (
            public.has_role('TEAM_LEAD')
            and public.is_operational_lead_for(expense.employee_id)
          )
        )
    )
  )
);

-- ── 8. receipts bucket UPDATE: own `${org}/${uid}/` prefix only ─────────────
drop policy if exists receipts_bucket_update_org_prefix on storage.objects;
drop policy if exists receipts_bucket_update_own_prefix on storage.objects;
create policy receipts_bucket_update_own_prefix
on storage.objects
for update
to authenticated
using (
  bucket_id = 'receipts'
  and position(public.get_user_org_id()::text || '/' || auth.uid()::text || '/' in name) = 1
)
with check (
  bucket_id = 'receipts'
  and position(public.get_user_org_id()::text || '/' || auth.uid()::text || '/' in name) = 1
);

-- ── 9. receipts bucket DELETE: own `${org}/${uid}/` prefix only ─────────────
drop policy if exists receipts_bucket_delete_org_prefix on storage.objects;
drop policy if exists receipts_bucket_delete_own_prefix on storage.objects;
create policy receipts_bucket_delete_own_prefix
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'receipts'
  and position(public.get_user_org_id()::text || '/' || auth.uid()::text || '/' in name) = 1
);

commit;
