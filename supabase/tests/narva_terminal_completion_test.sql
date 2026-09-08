-- Transactional WP-NARVA-07D regression for the real terminal RPC.
-- It exercises the physical 42702 statement and rolls every fixture row back.
begin;

select set_config(
  'request.jwt.claim.sub',
  (select op.user_id::text from public.operator_profiles as op
    where op.status='ACTIVE' order by op.created_at limit 1),
  true
);

do $$
declare
  v_user uuid:=auth.uid();
  v_exercise_id text:='WP-NARVA-07D-SQL-'||gen_random_uuid()::text;
  v_command_id text:='COMPLETE-'||gen_random_uuid()::text;
  v_lease_id uuid:=gen_random_uuid();
  v_writer text:='wp-narva-07d-writer';
  v_checkpoint jsonb;
  v_result record;
begin
  if v_user is null then raise exception 'Smoke test requires one auth.users row'; end if;

  insert into public.authorization_role_assignments(
    user_id,role,scope_type,scope_id,status,issued_by
  ) values(v_user,'EXCON','EXERCISE',v_exercise_id,'ACTIVE',v_user);

  insert into public.exercise_states(exercise_id,revision,state,updated_by)
  values(v_exercise_id,1,jsonb_build_object(
    'exerciseSession',jsonb_build_object('lifecycleState','RUNNING','version',1),
    'exercisePackageReference',jsonb_build_object(
      'packageId','wp-narva-07d-sql','packageVersion','1.0.0'
    )
  ),v_user);

  v_checkpoint:=jsonb_build_object(
    'exerciseId',v_exercise_id,
    'checkpointRevision',1,
    'persistedRuntimeVersion',1,
    'payloadHash','running-hash',
    'provenanceHash','provenance-hash',
    'payload',jsonb_build_object(
      'exerciseSession',jsonb_build_object('lifecycleState','RUNNING','version',1),
      'exercisePackageReference',jsonb_build_object(
        'packageId','wp-narva-07d-sql','packageVersion','1.0.0'
      ),
      'runtimePatientCommandCursor',0
    )
  );
  insert into public.runtime_checkpoints(exercise_id,checkpoint_revision,persisted_runtime_version,
    payload_hash,provenance_hash,payload,payload_bytes,writer_instance_id,writer_user_id)
  values(v_exercise_id,1,1,'running-hash','provenance-hash',v_checkpoint,
    octet_length(v_checkpoint::text),v_writer,v_user);

  insert into public.runtime_writer_leases(exercise_id,lease_id,writer_instance_id,writer_user_id,
    expires_at)
  values(v_exercise_id,v_lease_id,v_writer,v_user,clock_timestamp()+interval '5 minutes');
  insert into public.runtime_completion_requests(exercise_id,command_id,requested_by,
    expected_exercise_version,fence_command_sequence,status)
  values(v_exercise_id,v_command_id,v_user,1,0,'PENDING');

  v_checkpoint:=jsonb_build_object(
    'exerciseId',v_exercise_id,
    'checkpointRevision',2,
    'persistedRuntimeVersion',1,
    'payloadHash','terminal-hash',
    'provenanceHash','provenance-hash',
    'payload',jsonb_build_object(
      'exerciseSession',jsonb_build_object('lifecycleState','COMPLETED','version',2),
      'exercisePackageReference',jsonb_build_object(
        'packageId','wp-narva-07d-sql','packageVersion','1.0.0'
      ),
      'runtimePatientCommandCursor',0
    )
  );

  select frc.* into v_result
    from public.finalize_runtime_completion(
      v_exercise_id,v_command_id,v_lease_id,v_writer,1,v_checkpoint
    ) as frc;

  if v_result.checkpoint_revision<>2 then raise exception 'Terminal revision was not returned'; end if;
  if not exists(select 1 from public.runtime_checkpoints as rc
      where rc.exercise_id=v_exercise_id and rc.checkpoint_revision=2
        and public.exercise_lifecycle_from_state(rc.payload->'payload')='COMPLETED') then
    raise exception 'Terminal checkpoint was not persisted';
  end if;
  if not exists(select 1 from public.exercise_states as es
      where es.exercise_id=v_exercise_id
        and public.exercise_lifecycle_from_state(es.state)='COMPLETED') then
    raise exception 'Exercise projection was not completed';
  end if;
  if not exists(select 1 from public.runtime_completion_requests as rcr
      where rcr.exercise_id=v_exercise_id and rcr.status='COMPLETED'
        and rcr.terminal_checkpoint_revision=2) then
    raise exception 'Completion request was not finalized';
  end if;
  if not exists(select 1 from public.runtime_writer_leases as rwl
      where rwl.exercise_id=v_exercise_id and rwl.released_at is not null) then
    raise exception 'Writer lease was not explicitly released';
  end if;
end $$;

rollback;
