-- Transactional WP-NARVA-07H regression for the real patient-command RPC.
-- Exercises success, idempotency, CAS, ownership, authorization and invalid
-- patient rejection, then rolls every fixture row back.
begin;

do $$
declare
  v_actor uuid;
  v_other uuid;
  v_exercise_id text:='WP-NARVA-07H-SQL-'||gen_random_uuid()::text;
  v_result record;
  v_sequence bigint;
begin
  select op.user_id into v_actor from public.operator_profiles as op
    where op.status='ACTIVE' order by op.created_at limit 1;
  select op.user_id into v_other from public.operator_profiles as op
    where op.status='ACTIVE' and op.user_id<>v_actor order by op.created_at limit 1;
  if v_actor is null or v_other is null then
    raise exception 'Smoke test requires two active operator profiles';
  end if;

  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  insert into public.authorization_role_assignments(
    user_id,role,scope_type,scope_id,status,issued_by
  ) values(v_actor,'CM','EXERCISE',v_exercise_id,'ACTIVE',v_actor);
  insert into public.exercise_states(exercise_id,revision,state,updated_by)
  values(v_exercise_id,1,jsonb_build_object(
    'exerciseSession',jsonb_build_object('lifecycleState','RUNNING','version',1)
  ),v_actor);
  insert into public.shared_workflow_patient_states(
    exercise_id,patient_id,revision,owner_user_id,state,updated_by
  ) values(v_exercise_id,'PT-1',0,v_actor,'{}'::jsonb,v_actor);

  select rpc.* into v_result from public.submit_runtime_patient_command(
    v_exercise_id,'PT-1','CMD-1','RESOURCE_APPLY',0,10,
    jsonb_build_object('resourceId','PB-1')
  ) as rpc;
  if v_result.status<>'APPLIED' or v_result.patient_revision<>1
    or v_result.command_sequence is null then
    raise exception 'Expected authoritative APPLIED result';
  end if;
  v_sequence:=v_result.command_sequence;
  if not exists(select 1 from public.runtime_patient_commands as rpc
      where rpc.exercise_id=v_exercise_id and rpc.command_id='CMD-1'
        and rpc.patient_base_revision=0 and rpc.patient_resulting_revision=1) then
    raise exception 'Authoritative command row missing';
  end if;

  select rpc.* into v_result from public.submit_runtime_patient_command(
    v_exercise_id,'PT-1','CMD-1','RESOURCE_APPLY',0,10,
    jsonb_build_object('resourceId','PB-1')
  ) as rpc;
  if v_result.status<>'IDEMPOTENT' or v_result.command_sequence<>v_sequence
    or (select count(*) from public.runtime_patient_commands as rpc
      where rpc.exercise_id=v_exercise_id and rpc.command_id='CMD-1')<>1 then
    raise exception 'Duplicate command was not idempotent';
  end if;

  select rpc.* into v_result from public.submit_runtime_patient_command(
    v_exercise_id,'PT-1','CMD-STALE','RESOURCE_APPLY',0,11,
    jsonb_build_object('resourceId','PB-1')
  ) as rpc;
  if v_result.status<>'STALE_VERSION' or v_result.patient_revision<>1 then
    raise exception 'Wrong base revision was not rejected';
  end if;

  begin
    perform * from public.submit_runtime_patient_command(
      v_exercise_id,'PT-MISSING','CMD-MISSING','RESOURCE_APPLY',0,11,
      jsonb_build_object('resourceId','PB-1')
    );
    raise exception 'Invalid patient unexpectedly accepted';
  exception when sqlstate '22023' then
    if sqlerrm not like '%PATIENT_WORKFLOW_NOT_FOUND%' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub',v_other::text,true);
  begin
    perform * from public.submit_runtime_patient_command(
      v_exercise_id,'PT-1','CMD-UNAUTHORIZED','RESOURCE_APPLY',1,12,
      jsonb_build_object('resourceId','PB-1')
    );
    raise exception 'Unauthorized actor unexpectedly accepted';
  exception when sqlstate '42501' then
    if sqlerrm not like '%AUTHORIZATION_DENIED%' then raise; end if;
  end;

  insert into public.authorization_role_assignments(
    user_id,role,scope_type,scope_id,status,issued_by
  ) values(v_other,'CM','EXERCISE',v_exercise_id,'ACTIVE',v_actor);
  select rpc.* into v_result from public.submit_runtime_patient_command(
    v_exercise_id,'PT-1','CMD-NOT-OWNER','RESOURCE_APPLY',1,13,
    jsonb_build_object('resourceId','PB-1')
  ) as rpc;
  if v_result.status<>'NOT_OWNER' or v_result.patient_revision<>1 then
    raise exception 'Former/non-owner actor was not rejected';
  end if;
end $$;

rollback;
