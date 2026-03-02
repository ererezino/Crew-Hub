alter type public.expense_status_type add value if not exists 'manager_approved';
alter type public.expense_status_type add value if not exists 'finance_rejected';

alter table public.expenses
  add column if not exists manager_approved_by uuid references public.profiles(id),
  add column if not exists manager_approved_at timestamptz,
  add column if not exists finance_approved_by uuid references public.profiles(id),
  add column if not exists finance_approved_at timestamptz,
  add column if not exists finance_rejected_by uuid references public.profiles(id),
  add column if not exists finance_rejected_at timestamptz,
  add column if not exists finance_rejection_reason text;

update public.expenses
set
  manager_approved_by = coalesce(manager_approved_by, approved_by),
  manager_approved_at = coalesce(manager_approved_at, approved_at)
where approved_by is not null
  and manager_approved_by is null;

update public.expenses
set
  finance_approved_by = coalesce(finance_approved_by, reimbursed_by),
  finance_approved_at = coalesce(finance_approved_at, reimbursed_at)
where reimbursed_by is not null
  and finance_approved_by is null;
