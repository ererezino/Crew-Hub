begin;

create or replace function public.analytics_people(
  p_org_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language sql
security definer
set search_path = public
as $$
with scoped_profiles as (
  select
    id,
    coalesce(nullif(trim(full_name), ''), 'Unknown user') as full_name,
    coalesce(nullif(trim(department), ''), 'No department') as department,
    coalesce(nullif(trim(country_code), ''), '--') as country_code,
    employment_type,
    status,
    coalesce(start_date, created_at::date) as effective_start_date
  from public.profiles
  where org_id = p_org_id
    and deleted_at is null
),
active_profiles as (
  select *
  from scoped_profiles
  where status = 'active'
),
department_counts as (
  select department as label, count(*)::int as count
  from active_profiles
  group by department
),
country_counts as (
  select country_code as key, count(*)::int as count
  from active_profiles
  group by country_code
),
employment_type_counts as (
  select employment_type as key, count(*)::int as count
  from active_profiles
  group by employment_type
),
month_series as (
  select
    generate_series(
      date_trunc('month', p_start_date::timestamp)::date,
      date_trunc('month', p_end_date::timestamp)::date,
      interval '1 month'
    )::date as month_start
),
trend as (
  select
    to_char(ms.month_start, 'YYYY-MM') as month,
    (
      select count(*)::int
      from active_profiles ap
      where ap.effective_start_date <= (ms.month_start + interval '1 month - 1 day')::date
    ) as headcount,
    (
      select count(*)::int
      from scoped_profiles sp
      where sp.effective_start_date between ms.month_start and (ms.month_start + interval '1 month - 1 day')::date
    ) as hires
  from month_series ms
)
select jsonb_build_object(
  'metrics',
  jsonb_build_object(
    'activeHeadcount',
    (select count(*)::int from active_profiles),
    'newHires',
    (
      select count(*)::int
      from scoped_profiles
      where effective_start_date between p_start_date and p_end_date
    ),
    'activeDepartments',
    (select count(*)::int from department_counts),
    'activeCountries',
    (select count(*)::int from country_counts)
  ),
  'byDepartment',
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'key', lower(replace(label, ' ', '-')),
          'label', label,
          'count', count
        )
        order by count desc, label asc
      )
      from department_counts
    ),
    '[]'::jsonb
  ),
  'byCountry',
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'key', key,
          'count', count
        )
        order by count desc, key asc
      )
      from country_counts
    ),
    '[]'::jsonb
  ),
  'employmentType',
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'key', key,
          'count', count
        )
        order by count desc, key asc
      )
      from employment_type_counts
    ),
    '[]'::jsonb
  ),
  'trend',
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'month', month,
          'headcount', headcount,
          'hires', hires
        )
        order by month asc
      )
      from trend
    ),
    '[]'::jsonb
  )
);
$$;

create or replace function public.analytics_time_off(
  p_org_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language sql
security definer
set search_path = public
as $$
with year_span as (
  select generate_series(
    extract(year from p_start_date)::int,
    extract(year from p_end_date)::int
  )::int as year
),
scoped_requests as (
  select
    lr.id,
    lr.employee_id,
    lr.leave_type,
    lr.start_date,
    lr.end_date,
    lr.total_days::numeric as total_days,
    lr.status
  from public.leave_requests lr
  where lr.org_id = p_org_id
    and lr.deleted_at is null
    and lr.start_date between p_start_date and p_end_date
),
available_days as (
  select coalesce(sum(lb.total_days::numeric), 0)::numeric as total_available_days
  from public.leave_balances lb
  where lb.org_id = p_org_id
    and lb.deleted_at is null
    and lb.year in (select year from year_span)
),
by_type as (
  select
    coalesce(nullif(trim(sr.leave_type), ''), 'other') as key,
    coalesce(sum(sr.total_days), 0)::numeric as total_days,
    count(*)::int as request_count
  from scoped_requests sr
  where sr.status in ('approved', 'pending')
  group by coalesce(nullif(trim(sr.leave_type), ''), 'other')
),
month_series as (
  select
    generate_series(
      date_trunc('month', p_start_date::timestamp)::date,
      date_trunc('month', p_end_date::timestamp)::date,
      interval '1 month'
    )::date as month_start
),
monthly_requested as (
  select
    date_trunc('month', sr.start_date::timestamp)::date as month_start,
    coalesce(sum(sr.total_days), 0)::numeric as requested_days,
    coalesce(sum(case when sr.status = 'approved' then sr.total_days else 0 end), 0)::numeric as approved_days
  from scoped_requests sr
  where sr.status in ('approved', 'pending')
  group by date_trunc('month', sr.start_date::timestamp)::date
),
currently_out as (
  select distinct on (lr.employee_id)
    lr.employee_id,
    p.full_name,
    p.department,
    p.country_code,
    lr.leave_type,
    lr.total_days::numeric as total_days,
    lr.end_date
  from public.leave_requests lr
  join public.profiles p
    on p.id = lr.employee_id
   and p.org_id = p_org_id
   and p.deleted_at is null
  where lr.org_id = p_org_id
    and lr.deleted_at is null
    and lr.status = 'approved'
    and current_date between lr.start_date and lr.end_date
  order by lr.employee_id, lr.end_date asc
),
approved_total as (
  select coalesce(sum(total_days), 0)::numeric as approved_days
  from scoped_requests
  where status = 'approved'
),
requested_total as (
  select coalesce(sum(total_days), 0)::numeric as requested_days
  from scoped_requests
  where status in ('approved', 'pending')
)
select jsonb_build_object(
  'metrics',
  jsonb_build_object(
    'requestedDays',
    (select requested_days from requested_total),
    'approvedDays',
    (select approved_days from approved_total),
    'pendingRequests',
    (
      select count(*)::int
      from scoped_requests
      where status = 'pending'
    ),
    'currentlyOutCount',
    (select count(*)::int from currently_out),
    'utilizationRate',
    (
      select
        case
          when ad.total_available_days <= 0 then 0
          else round(((at.approved_days / ad.total_available_days) * 100)::numeric, 2)
        end
      from approved_total at, available_days ad
    )
  ),
  'byType',
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'key', bt.key,
          'totalDays', bt.total_days,
          'requestCount', bt.request_count
        )
        order by bt.total_days desc, bt.key asc
      )
      from by_type bt
    ),
    '[]'::jsonb
  ),
  'trend',
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'month', to_char(ms.month_start, 'YYYY-MM'),
          'requestedDays', coalesce(mr.requested_days, 0),
          'approvedDays', coalesce(mr.approved_days, 0)
        )
        order by ms.month_start asc
      )
      from month_series ms
      left join monthly_requested mr on mr.month_start = ms.month_start
    ),
    '[]'::jsonb
  ),
  'currentlyOut',
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'employeeId', co.employee_id,
          'fullName', co.full_name,
          'department', co.department,
          'countryCode', co.country_code,
          'leaveType', co.leave_type,
          'totalDays', co.total_days,
          'endDate', co.end_date
        )
        order by co.end_date asc, co.full_name asc
      )
      from currently_out co
    ),
    '[]'::jsonb
  )
);
$$;

create or replace function public.analytics_payroll(
  p_org_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language sql
security definer
set search_path = public
as $$
with scoped_items as (
  select
    pi.id,
    pi.payroll_run_id,
    pi.employee_id,
    pi.gross_amount,
    pi.net_amount,
    pi.pay_currency,
    coalesce(
      (
        select sum((elem ->> 'amount')::bigint)
        from jsonb_array_elements(coalesce(pi.deductions, '[]'::jsonb)) elem
        where jsonb_typeof(elem) = 'object'
          and coalesce(elem ->> 'amount', '') ~ '^-?[0-9]+$'
      ),
      0
    )::bigint as deduction_amount,
    pr.pay_date
  from public.payroll_items pi
  join public.payroll_runs pr
    on pr.id = pi.payroll_run_id
   and pr.org_id = p_org_id
   and pr.deleted_at is null
   and pr.status in ('approved', 'processing', 'completed')
  where pi.org_id = p_org_id
    and pi.deleted_at is null
    and pr.pay_date between p_start_date and p_end_date
),
month_series as (
  select
    generate_series(
      date_trunc('month', p_start_date::timestamp)::date,
      date_trunc('month', p_end_date::timestamp)::date,
      interval '1 month'
    )::date as month_start
),
monthly_totals as (
  select
    date_trunc('month', si.pay_date::timestamp)::date as month_start,
    coalesce(sum(si.net_amount), 0)::bigint as total_net,
    coalesce(sum(si.gross_amount), 0)::bigint as total_gross
  from scoped_items si
  group by date_trunc('month', si.pay_date::timestamp)::date
),
by_department as (
  select
    coalesce(nullif(trim(p.department), ''), 'No department') as label,
    coalesce(sum(si.net_amount), 0)::bigint as total_net,
    count(distinct si.employee_id)::int as employee_count
  from scoped_items si
  join public.profiles p
    on p.id = si.employee_id
   and p.org_id = p_org_id
   and p.deleted_at is null
  group by coalesce(nullif(trim(p.department), ''), 'No department')
),
by_country as (
  select
    coalesce(nullif(trim(p.country_code), ''), '--') as key,
    coalesce(sum(si.net_amount), 0)::bigint as total_net,
    count(distinct si.employee_id)::int as employee_count
  from scoped_items si
  join public.profiles p
    on p.id = si.employee_id
   and p.org_id = p_org_id
   and p.deleted_at is null
  group by coalesce(nullif(trim(p.country_code), ''), '--')
)
select jsonb_build_object(
  'metrics',
  jsonb_build_object(
    'totalGross', coalesce((select sum(gross_amount) from scoped_items), 0)::bigint,
    'totalNet', coalesce((select sum(net_amount) from scoped_items), 0)::bigint,
    'totalDeductions', coalesce((select sum(deduction_amount) from scoped_items), 0)::bigint,
    'runCount', (select count(distinct payroll_run_id)::int from scoped_items),
    'avgNetPerEmployee',
    (
      select
        case
          when count(distinct employee_id) = 0 then 0
          else round((sum(net_amount)::numeric / count(distinct employee_id))::numeric)::bigint
        end
      from scoped_items
    )
  ),
  'trend',
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'month', to_char(ms.month_start, 'YYYY-MM'),
          'totalNet', coalesce(mt.total_net, 0),
          'totalGross', coalesce(mt.total_gross, 0)
        )
        order by ms.month_start asc
      )
      from month_series ms
      left join monthly_totals mt on mt.month_start = ms.month_start
    ),
    '[]'::jsonb
  ),
  'byDepartment',
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'key', lower(replace(bd.label, ' ', '-')),
          'label', bd.label,
          'totalNet', bd.total_net,
          'employeeCount', bd.employee_count,
          'avgNet',
          case
            when bd.employee_count = 0 then 0
            else round((bd.total_net::numeric / bd.employee_count)::numeric)::bigint
          end
        )
        order by bd.total_net desc, bd.label asc
      )
      from by_department bd
    ),
    '[]'::jsonb
  ),
  'byCountry',
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'key', bc.key,
          'totalNet', bc.total_net,
          'employeeCount', bc.employee_count,
          'avgNet',
          case
            when bc.employee_count = 0 then 0
            else round((bc.total_net::numeric / bc.employee_count)::numeric)::bigint
          end
        )
        order by bc.total_net desc, bc.key asc
      )
      from by_country bc
    ),
    '[]'::jsonb
  )
);
$$;

create or replace function public.analytics_expenses(
  p_org_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language sql
security definer
set search_path = public
as $$
with scoped_expenses as (
  select
    e.id,
    e.employee_id,
    e.category,
    e.amount,
    e.status,
    e.expense_date
  from public.expenses e
  where e.org_id = p_org_id
    and e.deleted_at is null
    and e.expense_date between p_start_date and p_end_date
),
month_series as (
  select
    generate_series(
      date_trunc('month', p_start_date::timestamp)::date,
      date_trunc('month', p_end_date::timestamp)::date,
      interval '1 month'
    )::date as month_start
),
monthly_totals as (
  select
    date_trunc('month', se.expense_date::timestamp)::date as month_start,
    coalesce(sum(se.amount), 0)::bigint as total_amount,
    count(*)::int as expense_count
  from scoped_expenses se
  group by date_trunc('month', se.expense_date::timestamp)::date
),
by_category as (
  select
    se.category::text as key,
    coalesce(sum(se.amount), 0)::bigint as total_amount,
    count(*)::int as expense_count
  from scoped_expenses se
  group by se.category::text
),
top_spenders as (
  select
    se.employee_id,
    p.full_name,
    p.department,
    p.country_code,
    coalesce(sum(se.amount), 0)::bigint as total_amount,
    count(*)::int as expense_count
  from scoped_expenses se
  join public.profiles p
    on p.id = se.employee_id
   and p.org_id = p_org_id
   and p.deleted_at is null
  group by se.employee_id, p.full_name, p.department, p.country_code
  order by total_amount desc, p.full_name asc
  limit 8
)
select jsonb_build_object(
  'metrics',
  jsonb_build_object(
    'totalAmount', coalesce((select sum(amount) from scoped_expenses), 0)::bigint,
    'approvedAmount',
    coalesce(
      (
        select sum(amount)
        from scoped_expenses
        where status in ('approved', 'reimbursed')
      ),
      0
    )::bigint,
    'pendingAmount',
    coalesce(
      (
        select sum(amount)
        from scoped_expenses
        where status = 'pending'
      ),
      0
    )::bigint,
    'expenseCount', (select count(*)::int from scoped_expenses)
  ),
  'byCategory',
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'key', bc.key,
          'totalAmount', bc.total_amount,
          'expenseCount', bc.expense_count
        )
        order by bc.total_amount desc, bc.key asc
      )
      from by_category bc
    ),
    '[]'::jsonb
  ),
  'trend',
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'month', to_char(ms.month_start, 'YYYY-MM'),
          'totalAmount', coalesce(mt.total_amount, 0),
          'expenseCount', coalesce(mt.expense_count, 0)
        )
        order by ms.month_start asc
      )
      from month_series ms
      left join monthly_totals mt on mt.month_start = ms.month_start
    ),
    '[]'::jsonb
  ),
  'topSpenders',
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'employeeId', ts.employee_id,
          'fullName', ts.full_name,
          'department', ts.department,
          'countryCode', ts.country_code,
          'totalAmount', ts.total_amount,
          'expenseCount', ts.expense_count
        )
        order by ts.total_amount desc, ts.full_name asc
      )
      from top_spenders ts
    ),
    '[]'::jsonb
  )
);
$$;

revoke all on function public.analytics_people(uuid, date, date) from public;
revoke all on function public.analytics_time_off(uuid, date, date) from public;
revoke all on function public.analytics_payroll(uuid, date, date) from public;
revoke all on function public.analytics_expenses(uuid, date, date) from public;

grant execute on function public.analytics_people(uuid, date, date) to service_role;
grant execute on function public.analytics_time_off(uuid, date, date) to service_role;
grant execute on function public.analytics_payroll(uuid, date, date) to service_role;
grant execute on function public.analytics_expenses(uuid, date, date) to service_role;

commit;
