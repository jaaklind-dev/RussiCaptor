-- Audited terminal recovery for a RUNNING/PAUSED exercise whose durable
-- checkpoint is structurally valid but older than the authoritative projection
-- and whose Runtime writer lease has expired. This is deliberately separate
-- from both ordinary lifecycle control and missing-checkpoint termination.

alter table public.exercise_runtime_recovery_audit
  add column if not exists checkpoint_revision bigint,
  add column if not exists projection_revision bigint,
  add column if not exists recovery_reason text;

create or replace function public.terminate_stale_runtime_after_lease_expiry(
  p_exercise_id text
) returns table(result_code text, audit_id uuid, recovered_state jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_row public.exercise_states%rowtype;
  v_checkpoint public.runtime_checkpoints%rowtype;
  v_lease public.runtime_writer_leases%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_session jsonb; v_checkpoint_session jsonb;
  v_lifecycle text; v_result text; v_authorized boolean;
  v_state_exists boolean:=false; v_checkpoint_exists boolean:=false; v_lease_exists boolean:=false;
  v_checkpoint_valid boolean:=false; v_checkpoint_stale boolean:=false;
  v_assignment_ids uuid[]; v_scopes text[]; v_audit uuid;
  v_projection_version integer; v_checkpoint_version integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_row from public.exercise_states where exercise_id=p_exercise_id for update;
  v_state_exists:=found;
  select public.has_authorization_permission('EXERCISE_RUNTIME_RECOVERY',p_exercise_id) into v_authorized;
  select coalesce(array_agg(id order by id),'{}'),coalesce(array_agg(scope_type||coalesce(':'||scope_id,'') order by id),'{}')
    into v_assignment_ids,v_scopes from public.authorization_role_assignments
    where user_id=auth.uid() and role='EXCON' and status='ACTIVE' and (expires_at is null or expires_at>v_now)
      and (scope_type='GLOBAL' or (scope_type='EXERCISE' and scope_id=p_exercise_id));
  if not v_state_exists then
    v_result:='RECOVERY_NOT_REQUIRED'; v_lifecycle:=null;
  else
    v_session:=v_row.state->'exerciseSession';
    v_lifecycle:=coalesce(v_session->>'lifecycleState',case v_session->>'state' when 'running' then 'RUNNING' when 'paused' then 'PAUSED' else 'READY' end);
    select * into v_checkpoint from public.runtime_checkpoints where exercise_id=p_exercise_id for update;
    v_checkpoint_exists:=found;
    select * into v_lease from public.runtime_writer_leases where exercise_id=p_exercise_id for update;
    v_lease_exists:=found;
    if not v_authorized then v_result:='AUTHORIZATION_DENIED';
    elsif v_lifecycle='COMPLETED' then v_result:='ALREADY_TERMINAL';
    elsif v_lifecycle not in ('RUNNING','PAUSED') then v_result:='INVALID_EXERCISE_LIFECYCLE';
    elsif not v_checkpoint_exists then v_result:='CHECKPOINT_MISSING';
    elsif v_lease_exists and v_lease.released_at is null and v_lease.expires_at>v_now then v_result:='ACTIVE_RUNTIME_PRESENT';
    else
      v_checkpoint_session:=v_checkpoint.payload->'exerciseSession';
      begin
        v_checkpoint_valid:=v_checkpoint_session is not null
          and v_checkpoint.payload->>'exerciseId'=p_exercise_id
          and coalesce(v_checkpoint.payload->>'checkpointRevision','') ~ '^[0-9]+$'
          and (v_checkpoint.payload->>'checkpointRevision')::bigint=v_checkpoint.checkpoint_revision
          and v_checkpoint.payload->>'payloadHash'=v_checkpoint.payload_hash
          and v_checkpoint.payload->>'provenanceHash'=v_checkpoint.provenance_hash
          and v_checkpoint.payload_hash ~ '^[0-9a-f]{64}$'
          and v_checkpoint.provenance_hash ~ '^[0-9a-f]{64}$';
      exception when others then
        v_checkpoint_valid:=false;
      end;
      if not v_checkpoint_valid then v_result:='CHECKPOINT_INVALID';
      else
        begin
          if coalesce(v_session->>'version','') ~ '^[0-9]+$' then v_projection_version:=(v_session->>'version')::integer; end if;
          if coalesce(v_checkpoint_session->>'version','') ~ '^[0-9]+$' then v_checkpoint_version:=(v_checkpoint_session->>'version')::integer; end if;
        exception when others then
          v_result:='CHECKPOINT_NOT_STALE';
        end;
        if v_result is null then
          v_checkpoint_stale:=coalesce(v_checkpoint_version,-1)<coalesce(v_projection_version,-1)
            or coalesce(v_checkpoint_session->>'lifecycleState',v_checkpoint_session->>'state','')<>v_lifecycle;
        end if;
        if v_result is not null or not v_checkpoint_stale then v_result:='CHECKPOINT_NOT_STALE';
        else
          v_session:=v_session||jsonb_build_object(
            'lifecycleState','COMPLETED',
            'version',coalesce(v_projection_version,0)+1,
            'lastCommandId','STALE-RUNTIME-RECOVERY-'||p_exercise_id,
            'updatedAtWallClock',v_now
          );
          v_row.state:=jsonb_set(v_row.state,'{exerciseSession}',v_session,false);
          update public.exercise_states set state=v_row.state,revision=revision+1,updated_at=v_now,updated_by=auth.uid()
            where exercise_id=p_exercise_id returning * into v_row;
          if v_lease_exists and v_lease.released_at is null then
            update public.runtime_writer_leases set released_at=v_now where exercise_id=p_exercise_id;
          end if;
          v_result:='STALE_RUNTIME_TERMINATED';
        end if;
      end if;
    end if;
  end if;
  insert into public.exercise_runtime_recovery_audit(
    exercise_id,user_id,permission,assignment_ids,assignment_scopes,prior_lifecycle,persistence_failure,
    checkpoint_state,lease_state,result,checkpoint_revision,projection_revision,recovery_reason
  ) values (
    p_exercise_id,auth.uid(),'EXERCISE_RUNTIME_RECOVERY',coalesce(v_assignment_ids,'{}'),coalesce(v_scopes,'{}'),v_lifecycle,
    'STALE_CHECKPOINT_EXPIRED_LEASE',case when v_checkpoint_exists then case when v_checkpoint_valid then 'PRESENT' else 'INVALID' end else 'MISSING' end,
    case when v_lease_exists and v_lease.released_at is null and v_lease.expires_at>v_now then 'ACTIVE' when not v_lease_exists then 'ABSENT' else 'INACTIVE' end,
    v_result,case when v_checkpoint_exists then v_checkpoint.checkpoint_revision end,v_projection_version,'STALE_CHECKPOINT_EXPIRED_LEASE'
  ) returning id into v_audit;
  return query select v_result,v_audit,case when v_result='STALE_RUNTIME_TERMINATED' then v_row.state else null end;
end $$;

revoke all on function public.terminate_stale_runtime_after_lease_expiry(text) from public;
revoke all on function public.terminate_stale_runtime_after_lease_expiry(text) from anon;
grant execute on function public.terminate_stale_runtime_after_lease_expiry(text) to authenticated;
