begin;

create table if not exists public.review_cycles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  name varchar(200) not null,
  type varchar(20) not null,
  status varchar(20) not null default 'draft',
  start_date date not null,
  end_date date not null,
  self_review_deadline date,
  manager_review_deadline date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint review_cycles_name_check check (char_length(trim(name)) > 0),
  constraint review_cycles_type_check
    check (type in ('quarterly', 'annual', 'probation')),
  constraint review_cycles_status_check
    check (status in ('draft', 'active', 'in_review', 'completed')),
  constraint review_cycles_dates_check
    check (end_date >= start_date),
  constraint review_cycles_self_deadline_check
    check (
      self_review_deadline is null
      or (
        self_review_deadline >= start_date
        and self_review_deadline <= end_date
      )
    ),
  constraint review_cycles_manager_deadline_check
    check (
      manager_review_deadline is null
      or (
        manager_review_deadline >= start_date
        and manager_review_deadline <= end_date
      )
    )
);

create index if not exists idx_review_cycles_org_status_dates
  on public.review_cycles(org_id, status, start_date desc, end_date desc);

create index if not exists idx_review_cycles_org_type
  on public.review_cycles(org_id, type);

create table if not exists public.review_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  name varchar(200) not null,
  sections jsonb not null default '[]'::jsonb,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint review_templates_name_check check (char_length(trim(name)) > 0),
  constraint review_templates_sections_array_check
    check (jsonb_typeof(sections) = 'array')
);

create index if not exists idx_review_templates_org_name
  on public.review_templates(org_id, name);

create table if not exists public.review_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  cycle_id uuid not null references public.review_cycles(id),
  employee_id uuid not null references public.profiles(id),
  reviewer_id uuid not null references public.profiles(id),
  template_id uuid not null references public.review_templates(id),
  status varchar(20) not null default 'pending_self',
  due_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint review_assignments_status_check
    check (status in ('pending_self', 'pending_manager', 'in_review', 'completed')),
  constraint review_assignments_employee_reviewer_check
    check (employee_id <> reviewer_id)
);

create unique index if not exists uq_review_assignments_active
  on public.review_assignments(cycle_id, employee_id, reviewer_id)
  where deleted_at is null;

create index if not exists idx_review_assignments_org_status
  on public.review_assignments(org_id, status, created_at desc);

create index if not exists idx_review_assignments_cycle
  on public.review_assignments(cycle_id, status);

create index if not exists idx_review_assignments_employee
  on public.review_assignments(employee_id);

create index if not exists idx_review_assignments_reviewer
  on public.review_assignments(reviewer_id);

create table if not exists public.review_responses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  assignment_id uuid not null references public.review_assignments(id),
  respondent_id uuid not null references public.profiles(id),
  response_type varchar(20) not null,
  answers jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint review_responses_type_check
    check (response_type in ('self', 'manager')),
  constraint review_responses_answers_object_check
    check (jsonb_typeof(answers) = 'object')
);

create unique index if not exists uq_review_responses_active
  on public.review_responses(assignment_id, response_type, respondent_id)
  where deleted_at is null;

create index if not exists idx_review_responses_assignment_type
  on public.review_responses(assignment_id, response_type);

create index if not exists idx_review_responses_org_submitted
  on public.review_responses(org_id, submitted_at desc);

drop trigger if exists set_review_cycles_updated_at on public.review_cycles;
create trigger set_review_cycles_updated_at
before update on public.review_cycles
for each row
execute function public.set_updated_at();

drop trigger if exists set_review_templates_updated_at on public.review_templates;
create trigger set_review_templates_updated_at
before update on public.review_templates
for each row
execute function public.set_updated_at();

drop trigger if exists set_review_assignments_updated_at on public.review_assignments;
create trigger set_review_assignments_updated_at
before update on public.review_assignments
for each row
execute function public.set_updated_at();

drop trigger if exists set_review_responses_updated_at on public.review_responses;
create trigger set_review_responses_updated_at
before update on public.review_responses
for each row
execute function public.set_updated_at();

grant select, insert, update, delete on table public.review_cycles to authenticated;
grant select, insert, update, delete on table public.review_templates to authenticated;
grant select, insert, update, delete on table public.review_assignments to authenticated;
grant select, insert, update, delete on table public.review_responses to authenticated;

alter table public.review_cycles enable row level security;
alter table public.review_templates enable row level security;
alter table public.review_assignments enable row level security;
alter table public.review_responses enable row level security;

drop policy if exists review_cycles_select_scope on public.review_cycles;
create policy review_cycles_select_scope
on public.review_cycles
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
);

drop policy if exists review_cycles_insert_admin on public.review_cycles;
create policy review_cycles_insert_admin
on public.review_cycles
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and created_by = auth.uid()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists review_cycles_update_admin on public.review_cycles;
create policy review_cycles_update_admin
on public.review_cycles
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists review_cycles_delete_admin on public.review_cycles;
create policy review_cycles_delete_admin
on public.review_cycles
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists review_templates_select_scope on public.review_templates;
create policy review_templates_select_scope
on public.review_templates
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
);

drop policy if exists review_templates_insert_admin on public.review_templates;
create policy review_templates_insert_admin
on public.review_templates
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and created_by = auth.uid()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists review_templates_update_admin on public.review_templates;
create policy review_templates_update_admin
on public.review_templates
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists review_templates_delete_admin on public.review_templates;
create policy review_templates_delete_admin
on public.review_templates
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists review_assignments_select_scope on public.review_assignments;
create policy review_assignments_select_scope
on public.review_assignments
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or employee_id = auth.uid()
    or reviewer_id = auth.uid()
  )
);

drop policy if exists review_assignments_insert_admin on public.review_assignments;
create policy review_assignments_insert_admin
on public.review_assignments
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists review_assignments_update_admin on public.review_assignments;
create policy review_assignments_update_admin
on public.review_assignments
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
)
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists review_assignments_delete_admin on public.review_assignments;
create policy review_assignments_delete_admin
on public.review_assignments
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists review_responses_select_scope on public.review_responses;
create policy review_responses_select_scope
on public.review_responses
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or respondent_id = auth.uid()
    or exists (
      select 1
      from public.review_assignments assignment
      where assignment.id = review_responses.assignment_id
        and assignment.org_id = public.get_user_org_id()
        and assignment.deleted_at is null
        and (
          assignment.employee_id = auth.uid()
          or assignment.reviewer_id = auth.uid()
        )
    )
  )
);

drop policy if exists review_responses_insert_scope on public.review_responses;
create policy review_responses_insert_scope
on public.review_responses
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and respondent_id = auth.uid()
  and exists (
    select 1
    from public.review_assignments assignment
    where assignment.id = review_responses.assignment_id
      and assignment.org_id = public.get_user_org_id()
      and assignment.deleted_at is null
      and (
        (
          review_responses.response_type = 'self'
          and assignment.employee_id = auth.uid()
        )
        or (
          review_responses.response_type = 'manager'
          and assignment.reviewer_id = auth.uid()
        )
      )
  )
);

drop policy if exists review_responses_update_scope on public.review_responses;
create policy review_responses_update_scope
on public.review_responses
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and respondent_id = auth.uid()
)
with check (
  org_id = public.get_user_org_id()
  and respondent_id = auth.uid()
  and exists (
    select 1
    from public.review_assignments assignment
    where assignment.id = review_responses.assignment_id
      and assignment.org_id = public.get_user_org_id()
      and assignment.deleted_at is null
      and (
        (
          review_responses.response_type = 'self'
          and assignment.employee_id = auth.uid()
        )
        or (
          review_responses.response_type = 'manager'
          and assignment.reviewer_id = auth.uid()
        )
      )
  )
);

drop policy if exists review_responses_delete_admin on public.review_responses;
create policy review_responses_delete_admin
on public.review_responses
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

commit;
