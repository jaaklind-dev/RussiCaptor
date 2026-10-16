-- Run only on a freshly rebuilt disposable scratch database, never production.
-- Synthetic identities and exercises are transaction fixtures; all roll back.
begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_operator uuid := gen_random_uuid();
  v_bootstrap public.exercise_bootstrap_authorizations%rowtype;
  v_gate public.ready_exercise_cancellation_activation%rowtype;
  v_result record;
  v_lease record;
  v_state jsonb;
  v_before jsonb;
  v_operation uuid := gen_random_uuid();
  v_audit_count bigint;
begin
  if exists(select 1 from public.exercise_states) or exists(select 1 from auth.users) then
    raise exception 'ACTIVATION_TEST_REQUIRES_EMPTY_DISPOSABLE_DATABASE';
  end if;
  if (select enabled from public.ready_exercise_cancellation_activation
      where feature_key='READY_CANCELLATION') is distinct from false then
    raise exception 'ACTIVATION_MUST_DEFAULT_OFF';
  end if;

  insert into auth.users(id,email,aud,role,email_confirmed_at,is_anonymous)
    values (v_admin,'activation-admin@example.invalid','authenticated','authenticated',clock_timestamp(),false),
      (v_operator,'activation-operator@example.invalid','authenticated','authenticated',clock_timestamp(),false);
  perform public.trusted_admin_upsert_operator_profile(v_admin,'Activation Admin','ACTIVE',v_admin);
  perform public.trusted_admin_upsert_operator_profile(v_operator,'Activation Operator','ACTIVE',v_admin);
  perform public.trusted_admin_grant_platform_admin(v_admin,v_admin);

  -- Create READY through the production one-shot bootstrap/create contract.
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  v_bootstrap := public.trusted_admin_grant_exercise_bootstrap(
    v_admin,v_admin,clock_timestamp()+interval '10 minutes','SCRATCH_ACTIVATION_ACCEPTANCE');
  v_state := jsonb_build_object('exerciseSession',jsonb_build_object(
    'exerciseId','EX-ACTIVATION-SQL-A','lifecycleState','READY','version',1,
    'simulationTimeSec',0,'speed',1,'lastCommandId','PREPARE-ACTIVATION-A'),
    'exercisePackageReference',jsonb_build_object('packageId','scratch.activation','packageVersion','1.0.0'),
    'completedExerciseArchives','[]'::jsonb);
  perform public.create_initial_exercise_state('EX-ACTIVATION-SQL-A','CREATE-A',
    v_bootstrap.id,'scratch.activation','1.0.0',v_state);
  perform public.trusted_admin_grant_exercise_role(v_admin,'EX-ACTIVATION-SQL-A','EXCON',v_admin,null);
  v_before := v_state;
  begin
    perform public.trusted_admin_cancel_ready_exercise('EX-ACTIVATION-SQL-A',1,v_operation,'UNUSED_READY',v_admin);
    raise exception 'DISABLED_CANCELLATION_SUCCEEDED';
  exception when sqlstate '55000' then
    if sqlerrm <> 'READY_CANCELLATION_DISABLED' then raise; end if;
  end;
  if (select revision from public.exercise_states where exercise_id='EX-ACTIVATION-SQL-A') <> 1
    or (select state from public.exercise_states where exercise_id='EX-ACTIVATION-SQL-A') <> v_before
    or exists(select 1 from public.exercise_state_publication_operations where operation_kind='CANCEL')
    or exists(select 1 from public.administrative_action_audit where action='EXERCISE_READY_CANCELLED') then
    raise exception 'DISABLED_REQUEST_LEFT_MUTATION';
  end if;

  -- A missing singleton is fault injection, rolled back to its savepoint.
  begin
    delete from public.ready_exercise_cancellation_activation;
    begin
      perform public.trusted_admin_cancel_ready_exercise('EX-ACTIVATION-SQL-A',1,v_operation,'UNUSED_READY',v_admin);
      raise exception 'MISSING_GATE_CANCELLATION_SUCCEEDED';
    exception when sqlstate '55000' then
      if sqlerrm <> 'READY_CANCELLATION_DISABLED' then raise; end if;
    end;
    begin
      perform public.set_ready_exercise_cancellation_activation(true,'SCRATCH-MISSING-GATE');
      raise exception 'MISSING_GATE_ACTIVATION_SUCCEEDED';
    exception when sqlstate '55000' then
      if sqlerrm <> 'READY_CANCELLATION_GATE_UNAVAILABLE' then raise; end if;
    end;
    raise exception 'ROLLBACK_MISSING_GATE_FIXTURE' using errcode='P9001';
  exception when sqlstate 'P9001' then null;
  end;

  -- With the feature OFF, the existing READY -> RUNNING -> PAUSED writer path works.
  perform set_config('request.jwt.claim.sub',v_operator::text,true);
  v_bootstrap := public.trusted_admin_grant_exercise_bootstrap(
    v_operator,v_admin,clock_timestamp()+interval '10 minutes','SCRATCH_ACTIVATION_ACCEPTANCE');
  v_state := jsonb_set(v_state,'{exerciseSession,exerciseId}','"EX-ACTIVATION-SQL-B"');
  perform public.create_initial_exercise_state('EX-ACTIVATION-SQL-B','CREATE-B',
    v_bootstrap.id,'scratch.activation','1.0.0',v_state);
  perform public.trusted_admin_grant_exercise_role(v_operator,'EX-ACTIVATION-SQL-B','EXCON',v_admin,null);
  select * into v_lease from public.acquire_runtime_writer('EX-ACTIVATION-SQL-B','WRITER-B',0,60);
  v_state := jsonb_set(v_state,'{exerciseSession,lifecycleState}','"RUNNING"');
  select * into v_result from public.publish_exercise_state_current_writer(
    'EX-ACTIVATION-SQL-B','PUBLISH-B-1',v_lease.lease_id,'WRITER-B',1,v_state);
  if v_result.revision <> 2 then raise exception 'OFF_RUNNING_REGRESSION'; end if;
  v_state := jsonb_set(v_state,'{exerciseSession,lifecycleState}','"PAUSED"');
  select * into v_result from public.publish_exercise_state_current_writer(
    'EX-ACTIVATION-SQL-B','PUBLISH-B-2',v_lease.lease_id,'WRITER-B',2,v_state);
  if v_result.revision <> 3 then raise exception 'OFF_PAUSED_REGRESSION'; end if;
  begin
    perform public.publish_exercise_state_current_writer(
      'EX-ACTIVATION-SQL-B','FORGED-CANCEL',v_lease.lease_id,'WRITER-B',3,
      jsonb_set(v_state,'{exerciseSession,lifecycleState}','"CANCELLED"'));
    raise exception 'WRITER_CREATED_CANCELLED_WITH_GATE_OFF';
  exception when sqlstate '22023' then
    if sqlerrm <> 'INVALID_EXERCISE_STATE' then raise; end if;
  end;
  if (select revision from public.exercise_states where exercise_id='EX-ACTIVATION-SQL-B') <> 3 then
    raise exception 'REJECTED_CANCELLED_PUBLICATION_MUTATED';
  end if;
  perform public.release_runtime_writer(v_lease.lease_id,'WRITER-B');

  select * into v_result from public.set_ready_exercise_cancellation_activation(true,'SCRATCH-ENABLE-1');
  if not v_result.enabled or not v_result.changed then raise exception 'ENABLE_FAILED'; end if;
  select * into v_result from public.set_ready_exercise_cancellation_activation(true,'SCRATCH-ENABLE-RETRY');
  if not v_result.enabled or v_result.changed then raise exception 'ENABLE_NOT_IDEMPOTENT'; end if;
  if (select count(*) from public.administrative_action_audit where action='READY_CANCELLATION_ENABLED') <> 1 then
    raise exception 'ENABLE_AUDIT_NOT_EXACTLY_ONCE';
  end if;
  begin
    perform public.trusted_admin_cancel_ready_exercise('EX-ACTIVATION-SQL-A',1,v_operation,'UNUSED_READY',v_operator);
    raise exception 'NON_ADMIN_CANCELLATION_SUCCEEDED';
  exception when sqlstate '42501' then
    if sqlerrm <> 'PLATFORM_ADMIN_REQUIRED' then raise; end if;
  end;
  begin
    perform public.trusted_admin_cancel_ready_exercise('EX-ACTIVATION-SQL-A',2,v_operation,'UNUSED_READY',v_admin);
    raise exception 'STALE_REVISION_CANCELLATION_SUCCEEDED';
  exception when sqlstate '40001' then
    if sqlerrm <> 'REVISION_CONFLICT' then raise; end if;
  end;
  select * into v_result from public.trusted_admin_cancel_ready_exercise(
    'EX-ACTIVATION-SQL-A',1,v_operation,'UNUSED_READY',v_admin);
  if v_result.revision <> 2 or v_result.lifecycle_state <> 'CANCELLED' or v_result.idempotent then
    raise exception 'ENABLED_CANCELLATION_FAILED';
  end if;
  select * into v_result from public.trusted_admin_cancel_ready_exercise(
    'EX-ACTIVATION-SQL-A',1,v_operation,'UNUSED_READY',v_admin);
  if v_result.revision <> 2 or not v_result.idempotent then raise exception 'CANCEL_RETRY_NOT_IDEMPOTENT'; end if;
  begin
    perform public.trusted_admin_cancel_ready_exercise('EX-ACTIVATION-SQL-A',1,v_operation,'FAILED_START',v_admin);
    raise exception 'CONFLICTING_OPERATION_SUCCEEDED';
  exception when sqlstate '23505' then
    if sqlerrm <> 'OPERATION_ID_CONFLICT' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  begin
    perform public.acquire_runtime_writer('EX-ACTIVATION-SQL-A','CANCELLED-WRITER',0,60);
    raise exception 'CANCELLED_RESTARTED';
  exception when sqlstate '55000' then
    if sqlerrm <> 'EXERCISE_TERMINAL' then raise; end if;
  end;
  begin
    perform public.trusted_admin_grant_exercise_role(v_operator,'EX-ACTIVATION-SQL-A','EXCON',v_admin,null);
    raise exception 'TERMINAL_ROLE_GRANTED';
  exception when sqlstate '55000' then
    if sqlerrm <> 'TERMINAL_EXERCISE_READ_ONLY' then raise; end if;
  end;

  select state into v_before from public.exercise_states where exercise_id='EX-ACTIVATION-SQL-A';
  select count(*) into v_audit_count from public.administrative_action_audit where action='EXERCISE_READY_CANCELLED';
  perform public.set_ready_exercise_cancellation_activation(false,'SCRATCH-DISABLE-1');
  select * into v_result from public.set_ready_exercise_cancellation_activation(false,'SCRATCH-DISABLE-RETRY');
  if v_result.enabled or v_result.changed then raise exception 'DISABLE_NOT_IDEMPOTENT'; end if;
  begin
    perform public.trusted_admin_cancel_ready_exercise('EX-ACTIVATION-SQL-A',1,v_operation,'UNUSED_READY',v_admin);
    raise exception 'OFF_RETURNED_OLD_SUCCESS_RECEIPT';
  exception when sqlstate '55000' then
    if sqlerrm <> 'READY_CANCELLATION_DISABLED' then raise; end if;
  end;
  if (select state from public.exercise_states where exercise_id='EX-ACTIVATION-SQL-A') <> v_before
    or (select revision from public.exercise_states where exercise_id='EX-ACTIVATION-SQL-A') <> 2
    or (select count(*) from public.administrative_action_audit where action='EXERCISE_READY_CANCELLED') <> v_audit_count
    or (select count(*) from public.exercise_state_publication_operations where operation_kind='CANCEL') <> 1 then
    raise exception 'DISABLE_ALTERED_HISTORY';
  end if;
  perform public.set_ready_exercise_cancellation_activation(true,'SCRATCH-ENABLE-2');
  begin
    perform public.trusted_admin_cancel_ready_exercise('EX-ACTIVATION-SQL-B',3,gen_random_uuid(),'UNUSED_READY',v_admin);
    raise exception 'PAUSED_CANCELLATION_SUCCEEDED';
  exception when sqlstate '55000' then
    if sqlerrm <> 'EXERCISE_NOT_READY' then raise; end if;
  end;
  select * into v_gate from public.ready_exercise_cancellation_activation;
  begin
    perform public.set_ready_exercise_cancellation_activation(false,' invalid reference ');
    raise exception 'INVALID_ACTIVATION_SUCCEEDED';
  exception when sqlstate '22023' then
    if sqlerrm <> 'INVALID_ACTIVATION_REQUEST' then raise; end if;
  end;
  if (select enabled from public.ready_exercise_cancellation_activation) <> v_gate.enabled
    or (select changed_at from public.ready_exercise_cancellation_activation) <> v_gate.changed_at then
    raise exception 'FAILED_ACTIVATION_PARTIALLY_MUTATED';
  end if;
  if (select count(*) from public.administrative_action_audit where action='READY_CANCELLATION_ENABLED') <> 2
    or (select count(*) from public.administrative_action_audit where action='READY_CANCELLATION_DISABLED') <> 1 then
    raise exception 'ACTIVATION_AUDIT_INCONSISTENT';
  end if;
end;
$$;

set local role authenticated;
do $$ begin
  begin
    perform public.set_ready_exercise_cancellation_activation(true,'UNAUTHORIZED-CLIENT');
    raise exception 'AUTHENTICATED_ACTIVATION_SUCCEEDED';
  exception when insufficient_privilege then null; end;
  begin
    update public.ready_exercise_cancellation_activation set enabled=true;
    raise exception 'AUTHENTICATED_GATE_UPDATE_SUCCEEDED';
  exception when insufficient_privilege then null; end;
  begin
    update public.exercise_states set revision=revision+1;
    raise exception 'AUTHENTICATED_DIRECT_UPDATE_SUCCEEDED';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.exercise_states(exercise_id,state,updated_by)
      values('EX-FORBIDDEN-DIRECT-CANCEL','{"exerciseSession":{"lifecycleState":"CANCELLED"}}',gen_random_uuid());
    raise exception 'AUTHENTICATED_DIRECT_INSERT_SUCCEEDED';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
do $$ begin
  begin
    perform public.set_ready_exercise_cancellation_activation(true,'UNAUTHORIZED-SERVICE');
    raise exception 'SERVICE_ROLE_ACTIVATION_SUCCEEDED';
  exception when insufficient_privilege then null; end;
  begin
    update public.ready_exercise_cancellation_activation set enabled=true;
    raise exception 'SERVICE_ROLE_GATE_UPDATE_SUCCEEDED';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;

select 'PASS' as ready_cancellation_activation_contract,
  (select enabled from public.ready_exercise_cancellation_activation) as final_enabled,
  (select count(*) from public.exercise_states) as final_exercises,
  (select count(*) from auth.users) as final_users,
  (select count(*) from public.administrative_action_audit) as final_audit_rows;
