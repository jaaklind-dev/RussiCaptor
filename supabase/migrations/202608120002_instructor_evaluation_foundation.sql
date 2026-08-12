-- WP-41: human-authored evaluation, isolated from Runtime/replay and machine hashes.
create table if not exists public.instructor_evaluations (
  evaluation_id text primary key,
  exercise_id text not null unique,
  current_revision integer not null check (current_revision > 0),
  source_profile_id text not null,
  source_profile_version text not null,
  source_profile_hash text not null,
  source_evaluation_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.instructor_evaluation_revisions (
  evaluation_id text not null references public.instructor_evaluations(evaluation_id) on delete restrict,
  exercise_id text not null,
  revision integer not null check (revision > 0),
  evaluator_user_id uuid not null references auth.users(id),
  source_evaluation_hash text not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  primary key (evaluation_id, revision),
  unique (exercise_id, revision),
  check ((content->>'exerciseId') = exercise_id),
  check ((content->>'evaluationId') = evaluation_id),
  check ((content->>'revision')::integer = revision),
  check ((content->'evaluator'->>'userId')::uuid = evaluator_user_id),
  check ((content->'source'->>'evaluationHash') = source_evaluation_hash)
);

alter table public.instructor_evaluations enable row level security;
alter table public.instructor_evaluation_revisions enable row level security;

drop policy if exists "authorized instructors read evaluations" on public.instructor_evaluations;
create policy "authorized instructors read evaluations" on public.instructor_evaluations for select to authenticated
using (public.has_authorization_permission('INSTRUCTOR_EVALUATION_READ', exercise_id));
drop policy if exists "authorized instructors read evaluation revisions" on public.instructor_evaluation_revisions;
create policy "authorized instructors read evaluation revisions" on public.instructor_evaluation_revisions for select to authenticated
using (public.has_authorization_permission('INSTRUCTOR_EVALUATION_READ', exercise_id));

-- No direct write policies: mutation is atomic through the trusted RPC only.
create or replace function public.save_instructor_evaluation_revision(
  p_evaluation_id text, p_exercise_id text, p_expected_revision integer,
  p_source_profile_id text, p_source_profile_version text, p_source_profile_hash text,
  p_source_evaluation_hash text, p_content jsonb
)
returns setof public.instructor_evaluation_revisions
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_current integer; v_now timestamptz := now();
begin
  if auth.uid() is null or not public.has_authorization_permission('INSTRUCTOR_EVALUATION_WRITE', p_exercise_id) then raise exception 'AUTHORIZATION_DENIED'; end if;
  if p_expected_revision < 0 then raise exception 'REVISION_CONFLICT'; end if;
  select current_revision into v_current from public.instructor_evaluations where exercise_id = p_exercise_id for update;
  if coalesce(v_current, 0) <> p_expected_revision then raise exception 'REVISION_CONFLICT'; end if;
  if v_current is null then
    insert into public.instructor_evaluations values (p_evaluation_id, p_exercise_id, 1, p_source_profile_id, p_source_profile_version, p_source_profile_hash, p_source_evaluation_hash, v_now, v_now);
  else
    update public.instructor_evaluations set current_revision = v_current + 1, updated_at = v_now
      where evaluation_id = p_evaluation_id and exercise_id = p_exercise_id and source_evaluation_hash = p_source_evaluation_hash;
    if not found then raise exception 'SOURCE_CHANGED'; end if;
  end if;
  insert into public.instructor_evaluation_revisions (evaluation_id, exercise_id, revision, evaluator_user_id, source_evaluation_hash, content, created_at)
    values (p_evaluation_id, p_exercise_id, p_expected_revision + 1, auth.uid(), p_source_evaluation_hash,
      jsonb_set(jsonb_set(p_content, '{revision}', to_jsonb(p_expected_revision + 1)), '{evaluator,userId}', to_jsonb(auth.uid()::text)), v_now);
  perform public.record_authorization_decision('INSTRUCTOR_EVALUATION_WRITE', p_exercise_id, 'INSTRUCTOR_EVALUATION_REVISION');
  return query select * from public.instructor_evaluation_revisions where evaluation_id = p_evaluation_id and revision = p_expected_revision + 1;
end;
$$;
revoke all on function public.save_instructor_evaluation_revision(text,text,integer,text,text,text,text,jsonb) from public;
grant execute on function public.save_instructor_evaluation_revision(text,text,integer,text,text,text,text,jsonb) to authenticated;
