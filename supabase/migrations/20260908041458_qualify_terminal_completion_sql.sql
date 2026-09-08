-- WP-NARVA-07D: make terminal completion unambiguous by construction.
-- The function's TABLE return columns are PL/pgSQL variables, so every table
-- column that shares one of those names must be explicitly qualified.

create or replace function public.finalize_runtime_completion(
  p_exercise_id text,p_command_id text,p_lease_id uuid,p_writer_instance_id text,
  p_expected_checkpoint_revision bigint,p_checkpoint jsonb
)
returns table(checkpoint_revision bigint,payload_hash text,provenance_hash text,updated_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_lease public.runtime_writer_leases%rowtype;
  v_request public.runtime_completion_requests%rowtype;
  v_current bigint;
  v_next bigint;
  v_cursor bigint;
  v_now timestamptz:=clock_timestamp();
  v_bytes bigint:=octet_length(p_checkpoint::text);
  v_projection_revision bigint;
begin
  select rcr.* into v_request
    from public.runtime_completion_requests as rcr
    where rcr.exercise_id=p_exercise_id for update;
  if not found or v_request.command_id<>p_command_id then
    raise exception 'COMPLETION_REQUEST_NOT_FOUND' using errcode='55000';
  end if;
  if v_request.status='COMPLETED' then
    return query select v_request.terminal_checkpoint_revision,v_request.terminal_payload_hash,
      (select rc.provenance_hash from public.runtime_checkpoints as rc
        where rc.exercise_id=p_exercise_id),v_request.completed_at;
    return;
  end if;
  select rwl.* into v_lease
    from public.runtime_writer_leases as rwl
    where rwl.exercise_id=p_exercise_id for update;
  if not found or v_lease.lease_id<>p_lease_id or v_lease.writer_instance_id<>p_writer_instance_id
    or v_lease.writer_user_id<>v_actor or v_lease.released_at is not null or v_lease.expires_at<=v_now then
    raise exception 'STALE_WRITER' using errcode='42501';
  end if;
  select rc.checkpoint_revision into v_current
    from public.runtime_checkpoints as rc
    where rc.exercise_id=p_exercise_id for update;
  v_current:=coalesce(v_current,0);
  v_next:=(p_checkpoint->>'checkpointRevision')::bigint;
  v_cursor:=coalesce((p_checkpoint#>>'{payload,runtimePatientCommandCursor}')::bigint,0);
  if v_current<>p_expected_checkpoint_revision or v_next<=v_current
    or p_checkpoint->>'exerciseId'<>p_exercise_id
    or public.exercise_lifecycle_from_state(p_checkpoint->'payload')<>'COMPLETED'
    or v_cursor<v_request.fence_command_sequence
    or exists(select 1 from public.runtime_patient_commands as rpc
      where rpc.exercise_id=p_exercise_id
        and rpc.command_sequence<=v_request.fence_command_sequence and rpc.status='ACCEPTED') then
    raise exception 'TERMINAL_CHECKPOINT_INVALID' using errcode='55000';
  end if;
  perform set_config('russicaptor.terminal_finalize_command',p_command_id,true);
  insert into public.runtime_checkpoints(exercise_id,checkpoint_revision,persisted_runtime_version,
    payload_hash,provenance_hash,payload,payload_bytes,writer_instance_id,writer_user_id,updated_at)
  values(p_exercise_id,v_next,(p_checkpoint->>'persistedRuntimeVersion')::integer,
    p_checkpoint->>'payloadHash',p_checkpoint->>'provenanceHash',p_checkpoint,v_bytes,
    p_writer_instance_id,v_actor,v_now)
  on conflict(exercise_id) do update set checkpoint_revision=excluded.checkpoint_revision,
    persisted_runtime_version=excluded.persisted_runtime_version,payload_hash=excluded.payload_hash,
    provenance_hash=excluded.provenance_hash,payload=excluded.payload,payload_bytes=excluded.payload_bytes,
    writer_instance_id=excluded.writer_instance_id,writer_user_id=excluded.writer_user_id,updated_at=excluded.updated_at;
  insert into public.runtime_checkpoint_notifications(exercise_id,checkpoint_revision,payload_hash,
    provenance_hash,writer_instance_id,checkpoint_bytes,updated_at)
  values(p_exercise_id,v_next,p_checkpoint->>'payloadHash',p_checkpoint->>'provenanceHash',
    p_writer_instance_id,v_bytes,v_now) on conflict(exercise_id) do update set
    checkpoint_revision=excluded.checkpoint_revision,payload_hash=excluded.payload_hash,
    provenance_hash=excluded.provenance_hash,writer_instance_id=excluded.writer_instance_id,
    checkpoint_bytes=excluded.checkpoint_bytes,updated_at=excluded.updated_at;
  insert into public.runtime_checkpoint_authority_audit(exercise_id,checkpoint_revision,event_type,
    writer_instance_id,user_id,details)
  values(p_exercise_id,v_next,'CHECKPOINT_PUBLISHED',p_writer_instance_id,v_actor,
    jsonb_build_object('terminal',true,'completionCommandId',p_command_id));
  select es.revision into v_projection_revision
    from public.exercise_states as es
    where es.exercise_id=p_exercise_id for update;
  update public.exercise_states as es set revision=coalesce(v_projection_revision,0)+1,
    state=p_checkpoint->'payload',updated_at=v_now,updated_by=v_request.requested_by
    where es.exercise_id=p_exercise_id;
  update public.runtime_completion_requests as rcr set status='COMPLETED',
    terminal_checkpoint_revision=v_next,terminal_payload_hash=p_checkpoint->>'payloadHash',completed_at=v_now
    where rcr.exercise_id=p_exercise_id;
  update public.runtime_writer_leases as rwl set released_at=v_now
    where rwl.exercise_id=p_exercise_id;
  insert into public.runtime_checkpoint_authority_audit(exercise_id,checkpoint_revision,event_type,
    writer_instance_id,user_id,details)
  values(p_exercise_id,v_next,'WRITER_RELEASED',p_writer_instance_id,v_actor,
    jsonb_build_object('terminal',true,'completionCommandId',p_command_id));
  return query select v_next,p_checkpoint->>'payloadHash',p_checkpoint->>'provenanceHash',v_now;
end $$;

revoke all on function public.finalize_runtime_completion(text,text,uuid,text,bigint,jsonb)
  from public,anon;
grant execute on function public.finalize_runtime_completion(text,text,uuid,text,bigint,jsonb)
  to authenticated;
