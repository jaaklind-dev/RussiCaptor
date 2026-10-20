-- Runtime writer authority belongs to an authorized exercise controller.
-- Additive correction: keep the existing RPC signatures, lease/CAS/terminal
-- fences and RLS unchanged. Both existing table triggers invoke this function,
-- including writes made by SECURITY DEFINER publication/recovery wrappers.
create or replace function public.enforce_runtime_operator_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare v_exercise_id text;
begin
  v_exercise_id := coalesce(new.exercise_id, old.exercise_id);
  if not public.has_authorization_permission('EXCON_EXERCISE_CONTROL', v_exercise_id) then
    raise exception 'AUTHORIZATION_DENIED' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

-- Trigger execution remains available to existing callers; this is not a
-- publicly executable helper or a new privileged RPC.
revoke all on function public.enforce_runtime_operator_scope() from public, anon, authenticated;

-- This writer operation updates the command ledger, not either guarded table.
-- Require controller authority here too, including for a legacy CM-owned lease.
create or replace function public.record_runtime_patient_command_result(
  p_exercise_id text,p_command_sequence bigint,p_lease_id uuid,p_writer_instance_id text,
  p_status text,p_result jsonb
)
returns void language plpgsql security definer set search_path='' as $$
declare v_lease public.runtime_writer_leases%rowtype;
begin
  if not public.has_authorization_permission('EXCON_EXERCISE_CONTROL',p_exercise_id) then
    raise exception 'AUTHORIZATION_DENIED' using errcode='42501';
  end if;
  -- A controller permission is not proof of possession of this writer lease.
  -- Reject absent identities before comparing them (SQL <> NULL is UNKNOWN).
  if p_lease_id is null or p_writer_instance_id is null or length(p_writer_instance_id)=0 then
    raise exception 'STALE_WRITER' using errcode='42501';
  end if;
  if p_status not in ('MATERIALIZED','REJECTED') or p_result is null then
    raise exception 'INVALID_RUNTIME_COMMAND_RESULT' using errcode='22023';
  end if;
  select * into v_lease from public.runtime_writer_leases where exercise_id=p_exercise_id for update;
  if not found or v_lease.lease_id is distinct from p_lease_id
    or v_lease.writer_instance_id is distinct from p_writer_instance_id
    or v_lease.writer_user_id is distinct from (select auth.uid()) or v_lease.released_at is not null
    or v_lease.expires_at<=clock_timestamp() then
    raise exception 'STALE_WRITER' using errcode='42501';
  end if;
  update public.runtime_patient_commands set status=p_status,materialization_result=p_result,
    materialized_at=now() where exercise_id=p_exercise_id and command_sequence=p_command_sequence
    and status='ACCEPTED';
end $$;
revoke all on function public.record_runtime_patient_command_result(text,bigint,uuid,text,text,jsonb)
  from public,anon;
grant execute on function public.record_runtime_patient_command_result(text,bigint,uuid,text,text,jsonb)
  to authenticated;
