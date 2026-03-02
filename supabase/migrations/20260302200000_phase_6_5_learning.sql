begin;

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  title varchar(200) not null,
  description text,
  category varchar(60),
  content_type varchar(30) not null,
  content_url text,
  content_file_path text,
  thumbnail_url text,
  modules jsonb not null default '[]'::jsonb,
  duration_minutes int,
  difficulty varchar(20),
  passing_score int,
  auto_assign_rules jsonb not null default '[]'::jsonb,
  is_mandatory boolean not null default false,
  allow_retake boolean not null default true,
  certificate_template text,
  recurrence varchar(20),
  created_by uuid references public.profiles(id),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint courses_title_check check (char_length(trim(title)) > 0),
  constraint courses_content_type_check check (
    content_type in ('video', 'document', 'scorm', 'link', 'quiz', 'multi_module')
  ),
  constraint courses_duration_check check (duration_minutes is null or duration_minutes >= 0),
  constraint courses_difficulty_check check (
    difficulty is null or difficulty in ('beginner', 'intermediate', 'advanced')
  ),
  constraint courses_passing_score_check check (
    passing_score is null or (passing_score >= 0 and passing_score <= 100)
  ),
  constraint courses_recurrence_check check (
    recurrence is null or recurrence in ('annual', 'semi_annual', 'quarterly')
  )
);

create table if not exists public.course_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  course_id uuid not null references public.courses(id) on delete cascade,
  employee_id uuid not null references public.profiles(id),
  status varchar(20) not null default 'assigned',
  progress_pct int not null default 0,
  module_progress jsonb not null default '{}'::jsonb,
  quiz_score int,
  quiz_attempts int not null default 0,
  due_date date,
  started_at timestamptz,
  completed_at timestamptz,
  certificate_url text,
  assigned_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint course_assignments_status_check check (
    status in ('assigned', 'in_progress', 'completed', 'overdue', 'failed')
  ),
  constraint course_assignments_progress_check check (progress_pct >= 0 and progress_pct <= 100),
  constraint course_assignments_quiz_score_check check (
    quiz_score is null or (quiz_score >= 0 and quiz_score <= 100)
  ),
  constraint course_assignments_quiz_attempts_check check (quiz_attempts >= 0),
  constraint unique_assignment unique (course_id, employee_id)
);

create index if not exists idx_courses_org
  on public.courses(org_id)
  where deleted_at is null and is_published = true;

create index if not exists idx_assignments_employee
  on public.course_assignments(employee_id, status)
  where deleted_at is null;

create index if not exists idx_assignments_course
  on public.course_assignments(course_id)
  where deleted_at is null;

create index if not exists idx_assignments_overdue
  on public.course_assignments(due_date, status)
  where status != 'completed' and deleted_at is null;

drop trigger if exists set_courses_updated_at on public.courses;
create trigger set_courses_updated_at
before update on public.courses
for each row
execute function public.set_updated_at();

drop trigger if exists set_course_assignments_updated_at on public.course_assignments;
create trigger set_course_assignments_updated_at
before update on public.course_assignments
for each row
execute function public.set_updated_at();

grant select, insert, update, delete on table public.courses to authenticated;
grant select, insert, update, delete on table public.course_assignments to authenticated;

alter table public.courses enable row level security;
alter table public.course_assignments enable row level security;

drop policy if exists courses_select_scope on public.courses;
create policy courses_select_scope
on public.courses
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    is_published = true
    or created_by = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists courses_insert_admin on public.courses;
create policy courses_insert_admin
on public.courses
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists courses_update_admin on public.courses;
create policy courses_update_admin
on public.courses
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

drop policy if exists courses_delete_admin on public.courses;
create policy courses_delete_admin
on public.courses
for delete
to authenticated
using (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists course_assignments_select_scope on public.course_assignments;
create policy course_assignments_select_scope
on public.course_assignments
for select
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or (
      public.has_role('MANAGER')
      and exists (
        select 1
        from public.profiles managed_profile
        where managed_profile.id = course_assignments.employee_id
          and managed_profile.org_id = public.get_user_org_id()
          and managed_profile.manager_id = auth.uid()
          and managed_profile.deleted_at is null
      )
    )
  )
);

drop policy if exists course_assignments_insert_admin on public.course_assignments;
create policy course_assignments_insert_admin
on public.course_assignments
for insert
to authenticated
with check (
  org_id = public.get_user_org_id()
  and (
    public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
  )
);

drop policy if exists course_assignments_update_scope on public.course_assignments;
create policy course_assignments_update_scope
on public.course_assignments
for update
to authenticated
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and (
    employee_id = auth.uid()
    or public.has_role('HR_ADMIN')
    or public.has_role('SUPER_ADMIN')
    or (
      public.has_role('MANAGER')
      and exists (
        select 1
        from public.profiles managed_profile
        where managed_profile.id = course_assignments.employee_id
          and managed_profile.org_id = public.get_user_org_id()
          and managed_profile.manager_id = auth.uid()
          and managed_profile.deleted_at is null
      )
    )
  )
)
with check (
  org_id = public.get_user_org_id()
);

drop policy if exists course_assignments_delete_admin on public.course_assignments;
create policy course_assignments_delete_admin
on public.course_assignments
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
