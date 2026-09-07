-- WP-NARVA-06 forward-only hardening: a stale projection writer must not
-- overwrite or resurrect an exercise after terminal completion is fenced.

create or replace function public.guard_runtime_terminal_projection()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_request public.runtime_completion_requests%rowtype;
begin
  select * into v_request from public.runtime_completion_requests
    where exercise_id=new.exercise_id;
  if found and current_setting('russicaptor.terminal_finalize_command',true)
      is distinct from v_request.command_id then
    raise exception 'COMPLETION_FENCED' using errcode='55000';
  end if;
  if found and v_request.status='COMPLETED'
      and public.exercise_lifecycle_from_state(new.state)<>'COMPLETED' then
    raise exception 'EXERCISE_COMPLETED' using errcode='55000';
  end if;
  return new;
end $$;

revoke all on function public.guard_runtime_terminal_projection()
  from public,anon,authenticated;

create trigger runtime_terminal_projection_fence
before insert or update on public.exercise_states
for each row execute function public.guard_runtime_terminal_projection();
