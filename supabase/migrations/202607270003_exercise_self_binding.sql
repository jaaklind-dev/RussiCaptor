-- ExerciseBinding lists an exercise package's dependencies; it does not bind
-- the EXERCISE_INSTANCE module to itself.

create or replace function public.activate_exercise_import(
  p_import_run_id uuid,
  p_exercise_version_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exercise_id text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  perform 1
  from public.import_runs
  where id = p_import_run_id
    and created_by = auth.uid()
    and status = 'STAGED'
  for update;

  if not found then
    raise exception 'Import run is missing, not owned by caller, or not STAGED';
  end if;

  select exercise_id into v_exercise_id
  from public.exercise_versions
  where id = p_exercise_version_id
    and import_run_id = p_import_run_id
    and created_by = auth.uid()
    and not is_active
  for update;

  if v_exercise_id is null then
    raise exception 'Staged exercise version is missing or does not belong to import run';
  end if;

  if exists (
    select 1
    from public.import_run_modules run_module
    join public.module_versions module on module.id = run_module.module_version_id
    where run_module.import_run_id = p_import_run_id
      and run_module.required_for_exercise
      and run_module.load_for_exercise
      and module.module_type <> 'EXERCISE_INSTANCE'
      and not exists (
        select 1
        from public.exercise_module_bindings binding
        where binding.exercise_version_id = p_exercise_version_id
          and binding.module_version_id = run_module.module_version_id
          and binding.binding_type <> 'EXCLUDED'
      )
  ) then
    raise exception 'Required module binding is missing';
  end if;

  update public.exercise_versions
  set is_active = false, deactivated_at = now()
  where exercise_id = v_exercise_id and is_active;

  update public.exercise_versions
  set is_active = true, activated_at = now(), deactivated_at = null
  where id = p_exercise_version_id;

  update public.import_runs
  set status = 'SUCCEEDED', finished_at = now(), error_details = null
  where id = p_import_run_id;
end;
$$;
