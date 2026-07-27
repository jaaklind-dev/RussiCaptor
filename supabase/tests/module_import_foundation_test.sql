-- Transactional smoke test. It leaves no rows behind.

begin;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users order by created_at limit 1),
  true
);

do $$
declare
  v_user_id uuid := auth.uid();
  v_import_run_id uuid;
  v_module_version_id uuid;
  v_repeated_module_version_id uuid;
  v_exercise_module_id uuid;
  v_exercise_version_id uuid;
  v_conflict_rejected boolean := false;
  v_failed_run_id uuid;
  v_failed_module_id uuid;
  v_failed_exercise_version_id uuid;
  v_repeat_run_id uuid;
  v_active_before uuid;
  v_active_after uuid;
begin
  if v_user_id is null then
    raise exception 'Smoke test requires at least one auth.users row';
  end if;

  insert into public.import_runs (
    manifest_id,
    manifest_version,
    created_by
  )
  values ('SMOKE-MANIFEST', '1', v_user_id)
  returning id into v_import_run_id;

  v_module_version_id := public.register_module_version(
    v_import_run_id,
    'SMOKE_MODULE',
    '1.0',
    'REUSABLE_MODULE',
    'smoke.xlsx',
    repeat('a', 64),
    '{"kind":"smoke"}'::jsonb,
    10,
    true,
    true
  );

  v_repeated_module_version_id := public.register_module_version(
    v_import_run_id,
    'SMOKE_MODULE',
    '1.0',
    'REUSABLE_MODULE',
    'smoke.xlsx',
    repeat('a', 64),
    '{"kind":"smoke"}'::jsonb,
    10,
    true,
    true
  );

  if v_repeated_module_version_id <> v_module_version_id then
    raise exception 'Same version and hash was not idempotent';
  end if;

  begin
    perform public.register_module_version(
      v_import_run_id,
      'SMOKE_MODULE',
      '1.0',
      'REUSABLE_MODULE',
      'smoke.xlsx',
      repeat('b', 64),
      '{"kind":"conflict"}'::jsonb,
      10,
      true,
      true
    );
  exception
    when others then
      v_conflict_rejected := sqlerrm like 'FATAL module version content conflict%';
  end;

  if not v_conflict_rejected then
    raise exception 'Different content hash was not rejected';
  end if;

  v_exercise_module_id := public.register_module_version(
    v_import_run_id,
    'SMOKE_EXERCISE_MODULE',
    '1.0',
    'EXERCISE_INSTANCE',
    'smoke-exercise.xlsx',
    repeat('e', 64),
    '{"kind":"exercise-module"}'::jsonb,
    20,
    true,
    true
  );

  insert into public.exercise_versions (
    exercise_id,
    exercise_version,
    content_hash,
    canonical_payload,
    import_run_id,
    created_by
  )
  values (
    'SMOKE-EXERCISE',
    '1.0',
    repeat('c', 64),
    '{"kind":"exercise"}'::jsonb,
    v_import_run_id,
    v_user_id
  )
  returning id into v_exercise_version_id;

  insert into public.exercise_module_bindings (
    exercise_version_id,
    module_version_id,
    binding_type,
    required
  )
  values (v_exercise_version_id, v_module_version_id, 'RUNTIME', true);

  perform public.stage_import_run(v_import_run_id);
  perform public.activate_exercise_import(v_import_run_id, v_exercise_version_id);

  if not exists (
    select 1 from public.import_runs
    where id = v_import_run_id and status = 'SUCCEEDED' and finished_at is not null
  ) then
    raise exception 'Import run did not finish successfully';
  end if;

  if not exists (
    select 1 from public.exercise_versions
    where id = v_exercise_version_id and is_active and activated_at is not null
  ) then
    raise exception 'Exercise version was not activated';
  end if;

  select id into strict v_active_before
  from public.exercise_versions
  where exercise_id = 'SMOKE-EXERCISE' and is_active;

  -- Re-registering the same ModuleID/version/SHA in another run is idempotent.
  insert into public.import_runs (manifest_id, manifest_version, created_by)
  values ('SMOKE-REPEAT-MANIFEST', '1', v_user_id)
  returning id into v_repeat_run_id;

  v_repeated_module_version_id := public.register_module_version(
    v_repeat_run_id,
    'SMOKE_MODULE',
    '1.0',
    'REUSABLE_MODULE',
    'smoke.xlsx',
    repeat('a', 64),
    '{"kind":"smoke"}'::jsonb,
    10,
    true,
    true
  );

  if v_repeated_module_version_id <> v_module_version_id then
    raise exception 'Same SHA in a repeated run created a new module version';
  end if;

  perform public.fail_import_run(v_repeat_run_id, '{"message":"idempotency cleanup"}'::jsonb);

  if not exists (select 1 from public.module_versions where id = v_module_version_id) then
    raise exception 'Repeated-run cleanup deleted the shared module version';
  end if;

  insert into public.import_runs (
    manifest_id,
    manifest_version,
    created_by
  )
  values ('SMOKE-FAILED-MANIFEST', '1', v_user_id)
  returning id into v_failed_run_id;

  v_failed_module_id := public.register_module_version(
    v_failed_run_id,
    'SMOKE_FAILED_MODULE',
    '1.0',
    'REUSABLE_MODULE',
    'smoke-failed.xlsx',
    repeat('d', 64),
    '{"kind":"failed-smoke"}'::jsonb,
    10,
    true,
    true
  );

  insert into public.exercise_versions (
    exercise_id,
    exercise_version,
    content_hash,
    canonical_payload,
    import_run_id,
    created_by
  )
  values (
    'SMOKE-EXERCISE',
    '2.0',
    repeat('f', 64),
    '{"kind":"failed-exercise"}'::jsonb,
    v_failed_run_id,
    v_user_id
  )
  returning id into v_failed_exercise_version_id;

  perform public.fail_import_run(v_failed_run_id, '{"message":"expected smoke failure"}'::jsonb);

  if exists (select 1 from public.module_versions where id = v_failed_module_id) then
    raise exception 'Failed run module staging row was not removed';
  end if;

  if exists (select 1 from public.import_run_modules where import_run_id = v_failed_run_id) then
    raise exception 'Failed run module association was not removed';
  end if;

  if exists (select 1 from public.exercise_versions where id = v_failed_exercise_version_id) then
    raise exception 'Failed run exercise staging row was not removed';
  end if;

  if not exists (
    select 1 from public.import_runs
    where id = v_failed_run_id and status = 'FAILED' and finished_at is not null
  ) then
    raise exception 'Failed import run audit row was not retained';
  end if;

  select id into strict v_active_after
  from public.exercise_versions
  where exercise_id = 'SMOKE-EXERCISE' and is_active;

  if v_active_after <> v_active_before then
    raise exception 'Failed import changed the active exercise version';
  end if;
end;
$$;

rollback;
