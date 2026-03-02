begin;

create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  title varchar(200) not null,
  description text,
  type varchar(30) not null default 'engagement',
  questions jsonb not null default '[]'::jsonb,
  is_anonymous boolean not null default true,
  min_responses_for_results int not null default 5,
  target_audience jsonb not null default '{}'::jsonb,
  status varchar(20) not null default 'draft',
  start_date date,
  end_date date,
  recurrence varchar(20),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint surveys_title_check check (char_length(trim(title)) > 0),
  constraint surveys_type_check check (
    type in ('engagement', 'pulse', 'onboarding', 'exit', 'custom')
  ),
  constraint surveys_min_responses_check check (min_responses_for_results >= 1),
  constraint surveys_status_check check (
    status in ('draft', 'active', 'closed', 'archived')
  ),
  constraint surveys_date_window_check check (
    end_date is null or start_date is null or end_date >= start_date
  ),
  constraint surveys_recurrence_check check (
    recurrence is null or recurrence in ('weekly', 'monthly', 'quarterly')
  )
);

create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  survey_id uuid not null references public.surveys(id) on delete cascade,
  respondent_id uuid references public.profiles(id),
  answers jsonb not null default '{}'::jsonb,
  department varchar(100),
  country_code varchar(2),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_surveys_org
  on public.surveys(org_id, status)
  where deleted_at is null;

create index if not exists idx_survey_responses_survey
  on public.survey_responses(survey_id)
  where deleted_at is null;

create index if not exists idx_survey_responses_org_submitted
  on public.survey_responses(org_id, submitted_at desc)
  where deleted_at is null;

create unique index if not exists uq_survey_responses_survey_respondent
  on public.survey_responses(survey_id, respondent_id)
  where respondent_id is not null and deleted_at is null;

drop trigger if exists set_surveys_updated_at on public.surveys;
create trigger set_surveys_updated_at
before update on public.surveys
for each row
execute function public.set_updated_at();

grant select, insert, update, delete on table public.surveys to authenticated;
grant select, insert on table public.survey_responses to authenticated;

alter table public.surveys enable row level security;
alter table public.survey_responses enable row level security;

drop policy if exists surveys_select_org on public.surveys;
create policy surveys_select_org
on public.surveys
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
);

drop policy if exists surveys_insert_admin on public.surveys;
create policy surveys_insert_admin
on public.surveys
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists surveys_update_admin on public.surveys;
create policy surveys_update_admin
on public.surveys
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

drop policy if exists surveys_delete_admin on public.surveys;
create policy surveys_delete_admin
on public.surveys
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists survey_responses_select_scope on public.survey_responses;
create policy survey_responses_select_scope
on public.survey_responses
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    respondent_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists survey_responses_insert_scope on public.survey_responses;
create policy survey_responses_insert_scope
on public.survey_responses
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    respondent_id is null
    or respondent_id = auth.uid()
  )
  and exists (
    select 1
    from public.surveys survey_row
    where survey_row.id = survey_responses.survey_id
      and survey_row.org_id = public.get_user_org_id()
      and survey_row.deleted_at is null
      and survey_row.status = 'active'
      and (survey_row.start_date is null or survey_row.start_date <= current_date)
      and (survey_row.end_date is null or survey_row.end_date >= current_date)
  )
);

commit;
