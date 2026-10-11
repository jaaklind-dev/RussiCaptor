-- RUNTIME-PENDING-COMPLETION-TAKEOVER-RECOVERY-01
-- An existing shared-workflow patient head is an authoritative read, not a
-- new workflow mutation. A replacement writer may therefore observe it while
-- exercise completion is PENDING. Creation of a missing head remains fenced.

create or replace function public.ensure_shared_workflow_patient_head(
  p_exercise_id text,
  p_patient_id text
)
returns table(status text, revision bigint, owner_user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_exercise public.exercise_states%rowtype;
  v_completion_status text;
  v_patient jsonb;
  v_initial_state jsonb;
  v_head public.shared_workflow_patient_states%rowtype;
  v_inserted bigint := 0;
begin
  if v_actor is null
    or coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_exercise_id is null or nullif(btrim(p_exercise_id), '') is null
    or p_patient_id is null or nullif(btrim(p_patient_id), '') is null then
    raise exception 'INVALID_WORKFLOW_HEAD_IDENTITY' using errcode = '22023';
  end if;
  if not public.has_authorization_permission('EXERCISE_RUNTIME_RECOVERY', p_exercise_id) then
    raise exception 'AUTHORIZATION_DENIED' using errcode = '42501';
  end if;

  -- Keep the same transaction fence as command acceptance and completion.
  select es.* into v_exercise
  from public.exercise_states as es
  where es.exercise_id = p_exercise_id
  for update;
  if not found then
    raise exception 'EXERCISE_NOT_FOUND' using errcode = '22023';
  end if;

  select rcr.status into v_completion_status
  from public.runtime_completion_requests as rcr
  where rcr.exercise_id = p_exercise_id;
  if public.exercise_lifecycle_from_state(v_exercise.state) = 'COMPLETED'
    or v_completion_status = 'COMPLETED' then
    raise exception 'EXERCISE_COMPLETED' using errcode = '55000';
  end if;
  if public.exercise_lifecycle_from_state(v_exercise.state) not in ('RUNNING', 'PAUSED') then
    raise exception 'EXERCISE_NOT_ACTIVE' using errcode = '55000';
  end if;

  select candidate.value into v_patient
  from jsonb_array_elements(
    case when jsonb_typeof(v_exercise.state->'patients') = 'array'
      then v_exercise.state->'patients' else '[]'::jsonb end
  ) as candidate(value)
  where candidate.value->>'id' = p_patient_id
  limit 1;
  if v_patient is null then
    raise exception 'PATIENT_NOT_FOUND' using errcode = '22023';
  end if;

  -- Existing heads are read-only authority observations. Returning one does
  -- not cross the completion mutation fence and lets a replacement writer
  -- finish the already-persisted completion request.
  select swps.* into v_head
  from public.shared_workflow_patient_states as swps
  where swps.exercise_id = p_exercise_id and swps.patient_id = p_patient_id;
  if found then
    return query select 'EXISTING'::text, v_head.revision, v_head.owner_user_id;
    return;
  end if;

  -- A missing head would be a new canonical mutation and stays fenced.
  if v_completion_status = 'PENDING' then
    raise exception 'COMPLETION_FENCED' using errcode = '55000';
  end if;

  select jsonb_build_object(
    'patient', v_patient,
    'assignments', coalesce((select jsonb_agg(item.value order by item.ordinal)
      from jsonb_array_elements(case when jsonb_typeof(v_exercise.state->'assignments') = 'array'
        then v_exercise.state->'assignments' else '[]'::jsonb end) with ordinality as item(value, ordinal)
      where item.value->>'patientId' = p_patient_id), '[]'::jsonb),
    'transfers', coalesce((select jsonb_agg(item.value order by item.ordinal)
      from jsonb_array_elements(case when jsonb_typeof(v_exercise.state->'transfers') = 'array'
        then v_exercise.state->'transfers' else '[]'::jsonb end) with ordinality as item(value, ordinal)
      where item.value->>'patientId' = p_patient_id), '[]'::jsonb),
    'questions', coalesce((select jsonb_agg(item.value order by item.ordinal)
      from jsonb_array_elements(case when jsonb_typeof(v_exercise.state->'questions') = 'array'
        then v_exercise.state->'questions' else '[]'::jsonb end) with ordinality as item(value, ordinal)
      where item.value->>'patientId' = p_patient_id), '[]'::jsonb),
    'labs', coalesce((select jsonb_agg(item.value order by item.ordinal)
      from jsonb_array_elements(case when jsonb_typeof(v_exercise.state->'labs') = 'array'
        then v_exercise.state->'labs' else '[]'::jsonb end) with ordinality as item(value, ordinal)
      where item.value->>'patientId' = p_patient_id), '[]'::jsonb),
    'imagingStudies', coalesce((select jsonb_agg(item.value order by item.ordinal)
      from jsonb_array_elements(case when jsonb_typeof(v_exercise.state->'imagingStudies') = 'array'
        then v_exercise.state->'imagingStudies' else '[]'::jsonb end) with ordinality as item(value, ordinal)
      where item.value->>'patientId' = p_patient_id), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(item.value order by item.ordinal)
      from jsonb_array_elements(case when jsonb_typeof(v_exercise.state->'orders') = 'array'
        then v_exercise.state->'orders' else '[]'::jsonb end) with ordinality as item(value, ordinal)
      where item.value->>'patientId' = p_patient_id), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(item.value order by item.ordinal)
      from jsonb_array_elements(case when jsonb_typeof(v_exercise.state->'notes') = 'array'
        then v_exercise.state->'notes' else '[]'::jsonb end) with ordinality as item(value, ordinal)
      where item.value->>'patientId' = p_patient_id), '[]'::jsonb),
    'timelineEvents', coalesce((select jsonb_agg(item.value order by item.ordinal)
      from jsonb_array_elements(case when jsonb_typeof(v_exercise.state->'timelineEvents') = 'array'
        then v_exercise.state->'timelineEvents' else '[]'::jsonb end) with ordinality as item(value, ordinal)
      where item.value->>'patientId' = p_patient_id), '[]'::jsonb),
    'interventions', coalesce((select jsonb_agg(item.value order by item.ordinal)
      from jsonb_array_elements(case when jsonb_typeof(v_exercise.state->'interventions') = 'array'
        then v_exercise.state->'interventions' else '[]'::jsonb end) with ordinality as item(value, ordinal)
      where item.value->>'patientId' = p_patient_id), '[]'::jsonb),
    'medicationAdministrations', coalesce((select jsonb_agg(item.value order by item.ordinal)
      from jsonb_array_elements(case when jsonb_typeof(v_exercise.state->'medicationAdministrations') = 'array'
        then v_exercise.state->'medicationAdministrations' else '[]'::jsonb end) with ordinality as item(value, ordinal)
      where item.value->>'patientId' = p_patient_id), '[]'::jsonb),
    'vitalSigns', coalesce((select jsonb_agg(item.value order by item.ordinal)
      from jsonb_array_elements(case when jsonb_typeof(v_exercise.state->'vitalSigns') = 'array'
        then v_exercise.state->'vitalSigns' else '[]'::jsonb end) with ordinality as item(value, ordinal)
      where item.value->>'patientId' = p_patient_id), '[]'::jsonb)
  ) into v_initial_state;

  insert into public.shared_workflow_patient_states(
    exercise_id, patient_id, revision, owner_user_id, state, updated_by
  ) values (
    p_exercise_id, p_patient_id, 0, null, v_initial_state, v_actor
  ) on conflict (exercise_id, patient_id) do nothing;
  get diagnostics v_inserted = row_count;

  select swps.* into strict v_head
  from public.shared_workflow_patient_states as swps
  where swps.exercise_id = p_exercise_id and swps.patient_id = p_patient_id;

  return query select
    case when v_inserted = 1 then 'INITIALIZED' else 'EXISTING' end::text,
    v_head.revision,
    v_head.owner_user_id;
end;
$$;

revoke all on function public.ensure_shared_workflow_patient_head(text, text)
  from public, anon, authenticated;
grant execute on function public.ensure_shared_workflow_patient_head(text, text)
  to authenticated;
