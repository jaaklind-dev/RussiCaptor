-- WP-44B administrative recovery for an active exercise whose canonical Runtime is missing.
-- This never creates or mutates Runtime checkpoints or clinical evidence.

alter table public.authorization_audit drop constraint if exists authorization_audit_permission_check;
alter table public.authorization_audit add constraint authorization_audit_permission_check
  check (permission in ('INSTRUCTOR_EVALUATION_READ', 'INSTRUCTOR_EVALUATION_WRITE', 'EXERCISE_RUNTIME_RECOVERY'));

create or replace function public.has_authorization_permission(p_permission text, p_exercise_id text default null)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null
    and p_permission in ('INSTRUCTOR_EVALUATION_READ','INSTRUCTOR_EVALUATION_WRITE','EXERCISE_RUNTIME_RECOVERY')
    and exists (
      select 1 from public.authorization_role_assignments assignment
      where assignment.user_id=auth.uid() and assignment.role='EXCON' and assignment.status='ACTIVE'
        and (assignment.expires_at is null or assignment.expires_at>now())
        and (assignment.scope_type='GLOBAL' or (assignment.scope_type='EXERCISE' and p_exercise_id is not null and assignment.scope_id=p_exercise_id))
    );
$$;

create or replace function public.record_authorization_decision(p_permission text,p_exercise_id text,p_operation text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_authorized boolean; v_assignments uuid[];
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_permission not in ('INSTRUCTOR_EVALUATION_READ','INSTRUCTOR_EVALUATION_WRITE','EXERCISE_RUNTIME_RECOVERY') then raise exception 'Unsupported permission'; end if;
  v_authorized:=public.has_authorization_permission(p_permission,p_exercise_id);
  select coalesce(array_agg(id order by id),'{}') into v_assignments from public.authorization_role_assignments
    where user_id=auth.uid() and role='EXCON' and status='ACTIVE' and (expires_at is null or expires_at>now())
    and (scope_type='GLOBAL' or (scope_type='EXERCISE' and scope_id=p_exercise_id));
  insert into public.authorization_audit(user_id,permission,exercise_id,operation,decision,reason,freshness,assignment_ids)
    values(auth.uid(),p_permission,p_exercise_id,p_operation,case when v_authorized then 'AUTHORIZED' else 'DENIED' end,
      case when v_authorized then null else 'PERMISSION_DENIED' end,'VERIFIED_ONLINE',v_assignments) returning id into v_id;
  return v_id;
end $$;

create table if not exists public.exercise_runtime_recovery_audit (
  id uuid primary key default gen_random_uuid(),
  exercise_id text not null,
  user_id uuid references auth.users(id),
  permission text not null check (permission='EXERCISE_RUNTIME_RECOVERY'),
  assignment_ids uuid[] not null default '{}',
  assignment_scopes text[] not null default '{}',
  prior_lifecycle text,
  persistence_failure text not null,
  checkpoint_state text not null,
  lease_state text not null,
  result text not null,
  occurred_at timestamptz not null default now()
);
alter table public.exercise_runtime_recovery_audit enable row level security;
drop policy if exists "users read own runtime recovery audit" on public.exercise_runtime_recovery_audit;
create policy "users read own runtime recovery audit" on public.exercise_runtime_recovery_audit for select to authenticated using(user_id=auth.uid());

create or replace function public.terminate_exercise_with_missing_runtime(
  p_exercise_id text, p_expected_version integer, p_persistence_failure text
) returns table(result_code text,audit_id uuid,recovered_state jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_row public.exercise_states%rowtype; v_lifecycle text; v_lease public.runtime_writer_leases%rowtype;
  v_checkpoint_exists boolean; v_lease_exists boolean:=false; v_authorized boolean; v_assignment_ids uuid[]; v_scopes text[]; v_audit uuid;
  v_session jsonb; v_now timestamptz:=clock_timestamp(); v_result text;
begin
  select * into v_row from public.exercise_states where exercise_id=p_exercise_id for update;
  if not found then v_result:='RECOVERY_NOT_REQUIRED'; v_lifecycle:=null;
  else
    v_session:=v_row.state->'exerciseSession';
    v_lifecycle:=coalesce(v_session->>'lifecycleState',case v_session->>'state' when 'running' then 'RUNNING' when 'paused' then 'PAUSED' else 'READY' end);
    select public.has_authorization_permission('EXERCISE_RUNTIME_RECOVERY',p_exercise_id) into v_authorized;
    select coalesce(array_agg(id order by id),'{}'),coalesce(array_agg(scope_type||coalesce(':'||scope_id,'') order by id),'{}') into v_assignment_ids,v_scopes
      from public.authorization_role_assignments where user_id=auth.uid() and role='EXCON' and status='ACTIVE'
      and (expires_at is null or expires_at>v_now) and (scope_type='GLOBAL' or (scope_type='EXERCISE' and scope_id=p_exercise_id));
    select exists(select 1 from public.runtime_checkpoints where exercise_id=p_exercise_id) into v_checkpoint_exists;
    select * into v_lease from public.runtime_writer_leases where exercise_id=p_exercise_id for update;
    v_lease_exists:=found;
    if not v_authorized then v_result:='RECOVERY_NOT_AUTHORIZED';
    elsif v_lifecycle not in ('RUNNING','PAUSED') then v_result:='INVALID_EXERCISE_LIFECYCLE';
    elsif coalesce((v_session->>'version')::integer,-1)<>p_expected_version then v_result:='RECOVERY_NOT_REQUIRED';
    elsif p_persistence_failure<>'ACTIVE_RUNTIME_PERSISTENCE_MISSING' then v_result:='RECOVERY_NOT_REQUIRED';
    elsif v_checkpoint_exists then v_result:='RUNTIME_CHECKPOINT_AVAILABLE';
    elsif v_lease_exists and v_lease.released_at is null and v_lease.expires_at>v_now then v_result:='ACTIVE_RUNTIME_WRITER_PRESENT';
    else
      v_session:=v_session||jsonb_build_object('lifecycleState','COMPLETED','version',p_expected_version+1,'lastCommandId','RUNTIME-RECOVERY-'||p_exercise_id,'updatedAtWallClock',v_now);
      v_row.state:=jsonb_set(v_row.state,'{exerciseSession}',v_session,false);
      update public.exercise_states set state=v_row.state,revision=revision+1,updated_at=v_now,updated_by=auth.uid() where exercise_id=p_exercise_id returning * into v_row;
      if v_lease_exists and v_lease.released_at is null then update public.runtime_writer_leases set released_at=v_now where exercise_id=p_exercise_id; end if;
      v_result:='RECOVERY_TERMINATED';
    end if;
  end if;
  insert into public.exercise_runtime_recovery_audit(exercise_id,user_id,permission,assignment_ids,assignment_scopes,prior_lifecycle,persistence_failure,checkpoint_state,lease_state,result)
    values(p_exercise_id,auth.uid(),'EXERCISE_RUNTIME_RECOVERY',coalesce(v_assignment_ids,'{}'),coalesce(v_scopes,'{}'),v_lifecycle,p_persistence_failure,
      case when v_checkpoint_exists then 'PRESENT' else 'MISSING' end,
      case when v_lease_exists and v_lease.released_at is null and v_lease.expires_at>v_now then 'ACTIVE' when not v_lease_exists then 'ABSENT' else 'INACTIVE' end,v_result)
    returning id into v_audit;
  return query select v_result,v_audit,case when v_result='RECOVERY_TERMINATED' then v_row.state else null end;
end $$;

revoke all on function public.terminate_exercise_with_missing_runtime(text,integer,text) from public;
grant execute on function public.terminate_exercise_with_missing_runtime(text,integer,text) to authenticated;
