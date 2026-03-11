begin;

alter table public.shift_templates
  drop constraint if exists shift_templates_time_window_check;

alter table public.shift_templates
  add constraint shift_templates_time_window_check
  check (end_time <> start_time);

commit;
