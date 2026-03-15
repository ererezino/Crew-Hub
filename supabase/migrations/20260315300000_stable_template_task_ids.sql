-- Add stable per-task UUIDs to onboarding templates and instance tasks.
--
-- 1. Add template_task_id column to onboarding_tasks (soft reference back to
--    the task's stable ID inside the template JSONB).
-- 2. Backfill taskId into every task object inside onboarding_templates.tasks
--    JSONB. Handles both flat-array and compound {sections, tasks} formats.
--    Idempotent: only assigns taskId where missing, never regenerates existing ones.

-- Step 1: Add column
ALTER TABLE public.onboarding_tasks
  ADD COLUMN IF NOT EXISTS template_task_id uuid;

-- Step 2: Backfill taskId into template JSONB
DO $$
DECLARE
  v_row RECORD;
  v_tasks jsonb;
  v_new_tasks jsonb;
  v_task jsonb;
  v_is_compound boolean;
  v_changed boolean;
BEGIN
  FOR v_row IN
    SELECT id, tasks FROM public.onboarding_templates
    WHERE tasks IS NOT NULL AND tasks != 'null'::jsonb
  LOOP
    v_is_compound := false;
    v_changed := false;

    -- Determine format: flat array or compound {sections, tasks}
    IF jsonb_typeof(v_row.tasks) = 'array' THEN
      v_tasks := v_row.tasks;
    ELSIF jsonb_typeof(v_row.tasks) = 'object'
      AND v_row.tasks ? 'tasks'
      AND jsonb_typeof(v_row.tasks -> 'tasks') = 'array' THEN
      v_tasks := v_row.tasks -> 'tasks';
      v_is_compound := true;
    ELSE
      -- Unrecognised shape — skip
      CONTINUE;
    END IF;

    -- Process each task: add taskId only where missing
    v_new_tasks := '[]'::jsonb;

    FOR i IN 0 .. jsonb_array_length(v_tasks) - 1 LOOP
      v_task := v_tasks -> i;

      IF NOT (v_task ? 'taskId') THEN
        v_task := v_task || jsonb_build_object('taskId', gen_random_uuid()::text);
        v_changed := true;
      END IF;

      v_new_tasks := v_new_tasks || jsonb_build_array(v_task);
    END LOOP;

    -- Only write back if we actually added any taskId values
    IF v_changed THEN
      IF v_is_compound THEN
        UPDATE public.onboarding_templates
          SET tasks = jsonb_set(v_row.tasks, '{tasks}', v_new_tasks)
          WHERE id = v_row.id;
      ELSE
        UPDATE public.onboarding_templates
          SET tasks = v_new_tasks
          WHERE id = v_row.id;
      END IF;
    END IF;
  END LOOP;
END
$$;
