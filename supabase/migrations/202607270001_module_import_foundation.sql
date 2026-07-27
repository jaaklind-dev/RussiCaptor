-- Minimal persistence foundation for the manifest-driven importer.
-- This migration intentionally leaves public.exercise_states unchanged.

create table if not exists public.import_runs (
  id uuid primary key default gen_random_uuid(),
  manifest_id text not null,
  manifest_version text not null,
  status text not null default 'PREPARING'
    check (status in ('PREPARING', 'STAGED', 'SUCCEEDED', 'FAILED')),
  error_details jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  check (
    (status in ('PREPARING', 'STAGED') and finished_at is null)
    or (status in ('SUCCEEDED', 'FAILED') and finished_at is not null)
  )
);

create table if not exists public.module_versions (
  id uuid primary key default gen_random_uuid(),
  module_id text not null,
  module_version text not null,
  module_type text not null,
  source_file text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  canonical_payload jsonb not null,
  created_by_import_run_id uuid not null references public.import_runs(id),
  registered_at timestamptz not null default now(),
  registered_by uuid not null default auth.uid() references auth.users(id),
  unique (module_id, module_version)
);

create table if not exists public.import_run_modules (
  import_run_id uuid not null references public.import_runs(id) on delete cascade,
  module_version_id uuid not null references public.module_versions(id),
  load_order integer not null check (load_order >= 0),
  load_for_exercise boolean not null,
  required_for_exercise boolean not null,
  primary key (import_run_id, module_version_id),
  unique (import_run_id, load_order)
);

create table if not exists public.exercise_versions (
  id uuid primary key default gen_random_uuid(),
  exercise_id text not null,
  exercise_version text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  canonical_payload jsonb not null,
  import_run_id uuid not null references public.import_runs(id),
  is_active boolean not null default false,
  activated_at timestamptz,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id),
  unique (exercise_id, exercise_version),
  check (not is_active or (activated_at is not null and deactivated_at is null))
);

create table if not exists public.exercise_module_bindings (
  exercise_version_id uuid not null references public.exercise_versions(id) on delete cascade,
  module_version_id uuid not null references public.module_versions(id),
  binding_type text not null check (binding_type in ('RUNTIME', 'TEMPLATE', 'EXCLUDED')),
  required boolean not null default true,
  primary key (exercise_version_id, module_version_id)
);

create unique index if not exists exercise_versions_one_active_per_exercise
  on public.exercise_versions (exercise_id)
  where is_active;

create index if not exists import_runs_created_by_created_at_idx
  on public.import_runs (created_by, created_at desc);

create index if not exists module_versions_content_hash_idx
  on public.module_versions (content_hash);

create index if not exists import_run_modules_module_version_id_idx
  on public.import_run_modules (module_version_id);

create index if not exists exercise_versions_import_run_id_idx
  on public.exercise_versions (import_run_id);

create index if not exists exercise_module_bindings_module_version_id_idx
  on public.exercise_module_bindings (module_version_id);

alter table public.import_runs enable row level security;
alter table public.module_versions enable row level security;
alter table public.import_run_modules enable row level security;
alter table public.exercise_versions enable row level security;
alter table public.exercise_module_bindings enable row level security;

drop policy if exists "authenticated users can read import runs" on public.import_runs;
create policy "authenticated users can read import runs"
on public.import_runs for select to authenticated using (true);

drop policy if exists "authenticated users can create import runs" on public.import_runs;
create policy "authenticated users can create import runs"
on public.import_runs for insert to authenticated
with check (
  created_by = auth.uid()
  and status = 'PREPARING'
  and finished_at is null
  and error_details is null
);

drop policy if exists "authenticated users can read module versions" on public.module_versions;
create policy "authenticated users can read module versions"
on public.module_versions for select to authenticated using (true);

drop policy if exists "authenticated users can read import run modules" on public.import_run_modules;
create policy "authenticated users can read import run modules"
on public.import_run_modules for select to authenticated using (true);

drop policy if exists "import owner can manage import run modules" on public.import_run_modules;
create policy "import owner can manage import run modules"
on public.import_run_modules for all to authenticated
using (
  exists (
    select 1 from public.import_runs run
    where run.id = import_run_id
      and run.created_by = auth.uid()
      and run.status = 'PREPARING'
  )
)
with check (
  exists (
    select 1 from public.import_runs run
    where run.id = import_run_id
      and run.created_by = auth.uid()
      and run.status = 'PREPARING'
  )
);

drop policy if exists "authenticated users can read exercise versions" on public.exercise_versions;
create policy "authenticated users can read exercise versions"
on public.exercise_versions for select to authenticated using (true);

drop policy if exists "import owner can create exercise versions" on public.exercise_versions;
create policy "import owner can create exercise versions"
on public.exercise_versions for insert to authenticated
with check (
  created_by = auth.uid()
  and not is_active
  and activated_at is null
  and deactivated_at is null
  and exists (
    select 1 from public.import_runs run
    where run.id = import_run_id
      and run.created_by = auth.uid()
      and run.status = 'PREPARING'
  )
);

drop policy if exists "authenticated users can read exercise module bindings" on public.exercise_module_bindings;
create policy "authenticated users can read exercise module bindings"
on public.exercise_module_bindings for select to authenticated using (true);

drop policy if exists "import owner can manage exercise module bindings" on public.exercise_module_bindings;
create policy "import owner can manage exercise module bindings"
on public.exercise_module_bindings for all to authenticated
using (
  exists (
    select 1
    from public.exercise_versions version
    join public.import_runs run on run.id = version.import_run_id
    where version.id = exercise_version_id
      and run.created_by = auth.uid()
      and run.status = 'PREPARING'
  )
)
with check (
  exists (
    select 1
    from public.exercise_versions version
    join public.import_runs run on run.id = version.import_run_id
    where version.id = exercise_version_id
      and run.created_by = auth.uid()
      and run.status = 'PREPARING'
  )
);

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

create or replace function public.activate_exercise_import(
  p_import_run_id uuid,
  p_exercise_version_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exercise_id text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  perform 1
  from public.import_runs
  where id = p_import_run_id
    and created_by = auth.uid()
    and status = 'STAGED'
  for update;

  if not found then
    raise exception 'Import run is missing, not owned by caller, or not STAGED';
  end if;

  select exercise_id into v_exercise_id
  from public.exercise_versions
  where id = p_exercise_version_id
    and import_run_id = p_import_run_id
    and created_by = auth.uid()
    and not is_active
  for update;

  if v_exercise_id is null then
    raise exception 'Staged exercise version is missing or does not belong to import run';
  end if;

  if exists (
    select 1
    from public.import_run_modules run_module
    join public.module_versions module on module.id = run_module.module_version_id
    where run_module.import_run_id = p_import_run_id
      and run_module.required_for_exercise
      and run_module.load_for_exercise
      and module.module_type <> 'EXERCISE_INSTANCE'
      and not exists (
        select 1
        from public.exercise_module_bindings binding
        where binding.exercise_version_id = p_exercise_version_id
          and binding.module_version_id = run_module.module_version_id
          and binding.binding_type <> 'EXCLUDED'
      )
  ) then
    raise exception 'Required module binding is missing';
  end if;

  update public.exercise_versions
  set is_active = false, deactivated_at = now()
  where exercise_id = v_exercise_id and is_active;

  update public.exercise_versions
  set is_active = true, activated_at = now(), deactivated_at = null
  where id = p_exercise_version_id;

  update public.import_runs
  set status = 'SUCCEEDED', finished_at = now(), error_details = null
  where id = p_import_run_id;
end;
$$;

create or replace function public.stage_import_run(p_import_run_id uuid)
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
  set status = 'STAGED'
  where id = p_import_run_id
    and created_by = auth.uid()
    and status = 'PREPARING';

  if not found then
    raise exception 'Import run is missing, not owned by caller, or not PREPARING';
  end if;
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

revoke all on function public.register_module_version(
  uuid, text, text, text, text, text, jsonb, integer, boolean, boolean
) from public;
grant execute on function public.register_module_version(
  uuid, text, text, text, text, text, jsonb, integer, boolean, boolean
) to authenticated;

revoke all on function public.activate_exercise_import(uuid, uuid) from public;
grant execute on function public.activate_exercise_import(uuid, uuid) to authenticated;

revoke all on function public.stage_import_run(uuid) from public;
grant execute on function public.stage_import_run(uuid) to authenticated;

revoke all on function public.fail_import_run(uuid, jsonb) from public;
grant execute on function public.fail_import_run(uuid, jsonb) to authenticated;
