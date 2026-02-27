begin;

create table if not exists public.deduction_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  country_code varchar(2) not null,
  rule_type varchar(50) not null
    check (
      rule_type in (
        'income_tax',
        'pension_employee',
        'pension_employer',
        'housing_fund',
        'social_insurance',
        'health_insurance',
        'development_levy',
        'relief',
        'other'
      )
    ),
  rule_name varchar(100) not null,
  bracket_min bigint,
  bracket_max bigint,
  rate decimal(10, 6),
  flat_amount bigint,
  employer_portion_rate decimal(10, 6),
  cap_amount bigint,
  effective_from date not null,
  effective_to date,
  calculation_order int not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deduction_rules_country_code_check check (country_code ~ '^[A-Z]{2}$'),
  constraint deduction_rules_rule_name_check check (char_length(trim(rule_name)) > 0),
  constraint deduction_rules_effective_window_check
    check (effective_to is null or effective_to >= effective_from),
  constraint deduction_rules_bracket_window_check
    check (
      bracket_min is null
      or bracket_max is null
      or bracket_max >= bracket_min
    ),
  constraint deduction_rules_rate_check
    check (rate is null or (rate >= 0 and rate <= 1)),
  constraint deduction_rules_employer_portion_rate_check
    check (
      employer_portion_rate is null
      or (employer_portion_rate >= 0 and employer_portion_rate <= 1)
    ),
  constraint deduction_rules_flat_amount_check
    check (flat_amount is null or flat_amount >= 0),
  constraint deduction_rules_cap_amount_check
    check (cap_amount is null or cap_amount >= 0)
);

create index if not exists idx_deduction_rules
  on public.deduction_rules(org_id, country_code, rule_type, effective_from);

drop trigger if exists set_deduction_rules_updated_at on public.deduction_rules;
create trigger set_deduction_rules_updated_at
before update on public.deduction_rules
for each row
execute function public.set_updated_at();

grant select, insert, update, delete on table public.deduction_rules to authenticated;

alter table public.deduction_rules enable row level security;

drop policy if exists deduction_rules_select_scope on public.deduction_rules;
create policy deduction_rules_select_scope
on public.deduction_rules
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists deduction_rules_insert_scope on public.deduction_rules;
create policy deduction_rules_insert_scope
on public.deduction_rules
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists deduction_rules_update_scope on public.deduction_rules;
create policy deduction_rules_update_scope
on public.deduction_rules
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists deduction_rules_delete_scope on public.deduction_rules;
create policy deduction_rules_delete_scope
on public.deduction_rules
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('FINANCE_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

commit;
