-- Tie newly staged module versions to their creating run and remove only that
-- run's unreferenced staging data when the run fails.

alter table public.module_versions
  add column if not exists created_by_import_run_id uuid references public.import_runs(id);

update public.module_versions module
set created_by_import_run_id = run_module.import_run_id
from public.import_run_modules run_module
where run_module.module_version_id = module.id
  and module.created_by_import_run_id is null;

alter table public.module_versions
  alter column created_by_import_run_id set not null;

create or replace function public.register_module_version(
  p_import_run_id uuid,
  p_module_id text,
  p_module_version text,
  p_module_type text,
  p_source_file text,
  p_content_hash text,
  p_canonical_payload jsonb,
  p_load_order integer,
  p_load_for_exercise boolean,
  p_required_for_exercise boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_module_version public.module_versions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.import_runs
    where id = p_import_run_id
      and created_by = auth.uid()
      and status = 'PREPARING'
  ) then
    raise exception 'Import run is missing, not owned by caller, or not PREPARING';
  end if;

  if p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'content_hash must be a lowercase SHA-256 hex value';
  end if;

  insert into public.module_versions (
    module_id,
    module_version,
    module_type,
    source_file,
    content_hash,
    canonical_payload,
    created_by_import_run_id,
    registered_by
  )
  values (
    p_module_id,
    p_module_version,
    p_module_type,
    p_source_file,
    p_content_hash,
    p_canonical_payload,
    p_import_run_id,
    auth.uid()
  )
  on conflict (module_id, module_version) do nothing;

  select * into strict v_module_version
  from public.module_versions
  where module_id = p_module_id and module_version = p_module_version;

  if v_module_version.content_hash <> p_content_hash then
    raise exception 'FATAL module version content conflict for %/%', p_module_id, p_module_version;
  end if;

  insert into public.import_run_modules (
    import_run_id,
    module_version_id,
    load_order,
    load_for_exercise,
    required_for_exercise
  )
  values (
    p_import_run_id,
    v_module_version.id,
    p_load_order,
    p_load_for_exercise,
    p_required_for_exercise
  )
  on conflict (import_run_id, module_version_id) do update
  set load_order = excluded.load_order,
      load_for_exercise = excluded.load_for_exercise,
      required_for_exercise = excluded.required_for_exercise;

  return v_module_version.id;
end;
$$;

create or replace function public.fail_import_run(
  p_import_run_id uuid,
  p_error_details jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.import_runs
  set status = 'FAILED',
      finished_at = now(),
      error_details = coalesce(p_error_details, '{}'::jsonb)
  where id = p_import_run_id
    and created_by = auth.uid()
    and status in ('PREPARING', 'STAGED');

  if not found then
    raise exception 'Import run is missing, not owned by caller, or already final';
  end if;

  delete from public.exercise_versions
  where import_run_id = p_import_run_id and not is_active;

  delete from public.import_run_modules
  where import_run_id = p_import_run_id;

  delete from public.module_versions module
  where module.created_by_import_run_id = p_import_run_id
    and not exists (
      select 1 from public.import_run_modules run_module
      where run_module.module_version_id = module.id
    )
    and not exists (
      select 1 from public.exercise_module_bindings binding
      where binding.module_version_id = module.id
    );
end;
$$;
