-- WP-44B release acceptance fixture. This administrative helper is deliberately
-- unavailable to application users and creates no patient, Runtime, checkpoint,
-- writer lease, or clinical evidence. Invoke only from trusted test/admin SQL.

create table if not exists public.runtime_recovery_acceptance_fixture_audit (
  id bigint generated always as identity primary key,
  exercise_id text not null unique,
  created_by text not null,
  created_at timestamptz not null default now()
);

alter table public.runtime_recovery_acceptance_fixture_audit enable row level security;
revoke all on public.runtime_recovery_acceptance_fixture_audit from public, anon, authenticated;

create or replace function public.create_runtime_recovery_acceptance_fixture()
returns text
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_latest_lifecycle text;
  v_updated_by uuid;
  v_exercise_id text := 'RUNTIME-RECOVERY-ACCEPTANCE-' || replace(gen_random_uuid()::text, '-', '');
  v_now timestamptz := clock_timestamp();
  v_state jsonb;
begin
  select coalesce(
    state->'exerciseSession'->>'lifecycleState',
    case state->'exerciseSession'->>'state'
      when 'running' then 'RUNNING'
      when 'paused' then 'PAUSED'
      else 'READY'
    end
  ), updated_by into v_latest_lifecycle, v_updated_by
  from public.exercise_states
  order by updated_at desc
  limit 1;

  if v_latest_lifecycle in ('RUNNING','PAUSED') then
    raise exception using errcode='P0001', message='ACTIVE_EXERCISE_PRESENT';
  end if;
  if v_updated_by is null then
    raise exception using errcode='P0001', message='FIXTURE_PRINCIPAL_UNAVAILABLE';
  end if;

  v_state := jsonb_build_object(
    'exerciseSession', jsonb_build_object(
      'exerciseId', v_exercise_id,
      'lifecycleState', 'RUNNING',
      'simulationTimeSec', 0,
      'speed', 1,
      'version', 1,
      'clockVersion', 2,
      'clockInitializedAtSimulationTimeSec', 0,
      'updatedAtWallClock', v_now
    ),
    'patients', '[]'::jsonb,
    'assignments', '[]'::jsonb,
    'transfers', '[]'::jsonb,
    'questions', '[]'::jsonb,
    'labs', '[]'::jsonb,
    'imagingStudies', '[]'::jsonb,
    'orders', '[]'::jsonb,
    'notes', '[]'::jsonb,
    'scenarioEvents', '[]'::jsonb,
    'timelineEvents', '[]'::jsonb,
    'interventions', '[]'::jsonb,
    'medicationAdministrations', '[]'::jsonb,
    'vitalSigns', '[]'::jsonb,
    'exerciseControlAudit', '[]'::jsonb,
    'instructorCommandAudit', '[]'::jsonb,
    'exerciseResetAudit', '[]'::jsonb,
    'completedExerciseArchives', '[]'::jsonb
  );

  insert into public.exercise_states(exercise_id, revision, state, updated_at, updated_by)
  values(v_exercise_id, 1, v_state, v_now, v_updated_by);

  insert into public.runtime_recovery_acceptance_fixture_audit(exercise_id, created_by)
  values(v_exercise_id, current_user);

  return v_exercise_id;
end;
$$;

revoke all on function public.create_runtime_recovery_acceptance_fixture() from public, anon, authenticated;
grant execute on function public.create_runtime_recovery_acceptance_fixture() to service_role;
