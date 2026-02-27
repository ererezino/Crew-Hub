begin;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'payment_method_type'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.payment_method_type as enum ('bank_transfer', 'mobile_money', 'wise');
  end if;
end;
$$;

create table if not exists public.employee_payment_details (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  org_id uuid not null references public.orgs(id),
  payment_method public.payment_method_type not null,
  bank_name_encrypted text,
  bank_account_name_encrypted text,
  bank_account_number_encrypted text,
  bank_routing_number_encrypted text,
  mobile_money_provider_encrypted text,
  mobile_money_number_encrypted text,
  wise_recipient_id varchar(200),
  currency varchar(3) not null default 'USD',
  bank_account_last4 varchar(4),
  mobile_money_last4 varchar(4),
  is_primary boolean not null default true,
  is_verified boolean not null default false,
  change_effective_at timestamptz not null default (now() + interval '48 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint employee_payment_details_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint employee_payment_details_bank_last4_check
    check (bank_account_last4 is null or bank_account_last4 ~ '^[0-9]{4}$'),
  constraint employee_payment_details_mobile_last4_check
    check (mobile_money_last4 is null or mobile_money_last4 ~ '^[0-9]{4}$'),
  constraint employee_payment_details_method_fields_check
    check (
      (
        payment_method = 'bank_transfer'::public.payment_method_type
        and bank_name_encrypted is not null
        and bank_account_name_encrypted is not null
        and bank_account_number_encrypted is not null
        and bank_account_last4 is not null
        and mobile_money_provider_encrypted is null
        and mobile_money_number_encrypted is null
        and mobile_money_last4 is null
        and wise_recipient_id is null
      )
      or
      (
        payment_method = 'mobile_money'::public.payment_method_type
        and mobile_money_provider_encrypted is not null
        and mobile_money_number_encrypted is not null
        and mobile_money_last4 is not null
        and bank_name_encrypted is null
        and bank_account_name_encrypted is null
        and bank_account_number_encrypted is null
        and bank_routing_number_encrypted is null
        and bank_account_last4 is null
        and wise_recipient_id is null
      )
      or
      (
        payment_method = 'wise'::public.payment_method_type
        and wise_recipient_id is not null
        and char_length(trim(wise_recipient_id)) > 0
        and bank_name_encrypted is null
        and bank_account_name_encrypted is null
        and bank_account_number_encrypted is null
        and bank_routing_number_encrypted is null
        and bank_account_last4 is null
        and mobile_money_provider_encrypted is null
        and mobile_money_number_encrypted is null
        and mobile_money_last4 is null
      )
    )
);

create index if not exists idx_employee_payment_details_org_employee
  on public.employee_payment_details(org_id, employee_id);

create index if not exists idx_employee_payment_details_org_method
  on public.employee_payment_details(org_id, payment_method);

create index if not exists idx_employee_payment_details_org_verified
  on public.employee_payment_details(org_id, is_verified);

create unique index if not exists idx_employee_payment_details_primary
  on public.employee_payment_details(employee_id)
  where is_primary is true and deleted_at is null;

drop trigger if exists set_employee_payment_details_updated_at on public.employee_payment_details;
create trigger set_employee_payment_details_updated_at
before update on public.employee_payment_details
for each row
execute function public.set_updated_at();

grant select, insert, update on table public.employee_payment_details to authenticated;

alter table public.employee_payment_details enable row level security;

drop policy if exists employee_payment_details_select_scope on public.employee_payment_details;
create policy employee_payment_details_select_scope
on public.employee_payment_details
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists employee_payment_details_insert_scope on public.employee_payment_details;
create policy employee_payment_details_insert_scope
on public.employee_payment_details
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists employee_payment_details_update_scope on public.employee_payment_details;
create policy employee_payment_details_update_scope
on public.employee_payment_details
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

commit;
