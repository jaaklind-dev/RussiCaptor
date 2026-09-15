-- Transactional WP-NARVA-10B27F regression for the real initializer RPC.
-- Every fixture row rolls back.
begin;

do $$
declare
  v_actor uuid;
  v_other uuid;
  v_exercise_id text := 'WP-NARVA-10B27F-SQL-' || gen_random_uuid()::text;
  v_other_exercise_id text := 'WP-NARVA-10B27F-OTHER-' || gen_random_uuid()::text;
  v_result record;
begin
  select op.user_id into v_actor from public.operator_profiles as op
    where op.status = 'ACTIVE' order by op.created_at limit 1;
  select op.user_id into v_other from public.operator_profiles as op
    where op.status = 'ACTIVE' and op.user_id <> v_actor order by op.created_at limit 1;
  if v_actor is null or v_other is null then
    raise exception 'Workflow-head smoke requires two active operator profiles';
  end if;

  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  insert into public.authorization_role_assignments(user_id, role, scope_type, scope_id, status, issued_by)
  values (v_actor, 'EXCON', 'EXERCISE', v_exercise_id, 'ACTIVE', v_actor);
  insert into public.exercise_states(exercise_id, revision, state, updated_by)
  values (v_exercise_id, 1, jsonb_build_object(
    'exerciseSession', jsonb_build_object('lifecycleState', 'RUNNING', 'version', 1),
    'exercisePackageReference', jsonb_build_object('packageId', 'test.workflow-head', 'packageVersion', '1'),
    'patients', jsonb_build_array(jsonb_build_object('id', 'PT-1', 'name', 'Patient 1')),
    'assignments', '[]'::jsonb, 'transfers', '[]'::jsonb, 'questions', '[]'::jsonb,
    'labs', '[]'::jsonb, 'imagingStudies', '[]'::jsonb, 'orders', '[]'::jsonb,
    'notes', '[]'::jsonb, 'timelineEvents', '[]'::jsonb, 'interventions', '[]'::jsonb,
    'medicationAdministrations', '[]'::jsonb, 'vitalSigns', '[]'::jsonb
  ), v_actor);

  select rpc.* into v_result from public.ensure_shared_workflow_patient_head(v_exercise_id, 'PT-1') as rpc;
  if v_result.status <> 'INITIALIZED' or v_result.revision <> 0 or v_result.owner_user_id is not null then
    raise exception 'Expected unowned revision-zero initialization';
  end if;
  select rpc.* into v_result from public.ensure_shared_workflow_patient_head(v_exercise_id, 'PT-1') as rpc;
  if v_result.status <> 'EXISTING' or v_result.revision <> 0 or
    (select count(*) from public.shared_workflow_patient_states where exercise_id = v_exercise_id and patient_id = 'PT-1') <> 1 then
    raise exception 'Repeated initialization was not idempotent';
  end if;
  if exists(select 1 from public.shared_workflow_commands where exercise_id = v_exercise_id)
    or exists(select 1 from public.runtime_patient_commands where exercise_id = v_exercise_id) then
    raise exception 'Initialization created a command';
  end if;

  update public.shared_workflow_patient_states
  set revision = 7, state = state || jsonb_build_object('cursorEvidence', 41)
  where exercise_id = v_exercise_id and patient_id = 'PT-1';
  select rpc.* into v_result from public.ensure_shared_workflow_patient_head(v_exercise_id, 'PT-1') as rpc;
  if v_result.status <> 'EXISTING' or v_result.revision <> 7 or
    (select state->>'cursorEvidence' from public.shared_workflow_patient_states
      where exercise_id = v_exercise_id and patient_id = 'PT-1') <> '41' then
    raise exception 'Existing head was modified';
  end if;

  begin
    perform * from public.ensure_shared_workflow_patient_head(v_exercise_id, 'PT-MISSING');
    raise exception 'Nonexistent patient unexpectedly initialized';
  exception when sqlstate '22023' then
    if sqlerrm not like '%PATIENT_NOT_FOUND%' then raise; end if;
  end;

  insert into public.exercise_states(exercise_id, revision, state, updated_by)
  values (v_other_exercise_id, 1, jsonb_build_object(
    'exerciseSession', jsonb_build_object('lifecycleState', 'RUNNING', 'version', 1),
    'patients', jsonb_build_array(jsonb_build_object('id', 'PT-1'))
  ), v_actor);
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  begin
    perform * from public.ensure_shared_workflow_patient_head(v_exercise_id, 'PT-1');
    raise exception 'Cross-exercise caller unexpectedly initialized a head';
  exception when sqlstate '42501' then
    if sqlerrm not like '%AUTHORIZATION_DENIED%' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  update public.exercise_states
  set state = jsonb_set(state, '{exerciseSession,lifecycleState}', '"COMPLETED"'::jsonb)
  where exercise_id = v_exercise_id;
  begin
    perform * from public.ensure_shared_workflow_patient_head(v_exercise_id, 'PT-1');
    raise exception 'Terminal exercise unexpectedly initialized a head';
  exception when sqlstate '55000' then
    if sqlerrm not like '%EXERCISE_COMPLETED%' then raise; end if;
  end;
end;
$$;

set local role anon;
do $$
begin
  begin
    perform public.ensure_shared_workflow_patient_head('EX-ANON', 'PT-1');
    raise exception 'Anonymous caller unexpectedly executed initializer';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

rollback;
