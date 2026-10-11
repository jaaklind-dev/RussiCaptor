-- A compiled custom package may reuse a frozen Narva laboratory catalog only
-- after its exact immutable package identity has been registered by a platform
-- administrator (or by a reviewed deployment migration). A CM cannot assert
-- catalog eligibility in a command payload alone.
create table public.exercise_package_lab_catalog_bindings (
  package_id text not null,
  package_version text not null,
  package_hash text not null check (package_hash ~ '^[0-9a-f]{64}$'),
  catalog_package_id text not null check (catalog_package_id in ('NARVA_POLYTRAUMA','NARVA_IRO_ASTRUP')),
  registered_at timestamptz not null default now(),
  registered_by uuid,
  registration_source text not null check (registration_source in ('DEPLOYMENT','PLATFORM_ADMIN')),
  primary key (package_id, package_version),
  check (package_id not in ('russicaptor.narva-trauma','russicaptor.narva-iro-evacuation'))
);
alter table public.exercise_package_lab_catalog_bindings enable row level security;
-- Intentionally no client policies: only the owner of the narrowly checked
-- SECURITY DEFINER registration/command RPCs can read or write this table.
revoke all on table public.exercise_package_lab_catalog_bindings from public, anon, authenticated, service_role;

-- This already-compiled TEST package is registered as part of deployment,
-- never by a CM command or a mutable exercise projection.
insert into public.exercise_package_lab_catalog_bindings
  (package_id, package_version, package_hash, catalog_package_id, registration_source)
values
  ('russicaptor.builder-picker-test153', '1.0.0',
   '993ec01c571c158afc9f8715520887dd83dacaac535efd5d3f7cde0f7488129c',
   'NARVA_POLYTRAUMA', 'DEPLOYMENT');

create or replace function public.register_exercise_package_lab_catalog(
  p_package_id text, p_package_version text, p_package_hash text, p_catalog_package_id text
)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.exercise_package_lab_catalog_bindings%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'AUTHORIZATION_DENIED' using errcode = '42501';
  end if;
  if nullif(trim(p_package_id), '') is null or nullif(trim(p_package_version), '') is null
    or not coalesce(p_package_hash ~ '^[0-9a-f]{64}$', false)
    or not coalesce(p_catalog_package_id in ('NARVA_POLYTRAUMA','NARVA_IRO_ASTRUP'), false)
    or p_package_id in ('russicaptor.narva-trauma','russicaptor.narva-iro-evacuation') then
    raise exception 'INVALID_LAB_PACKAGE_BINDING' using errcode = '22023';
  end if;
  insert into public.exercise_package_lab_catalog_bindings
    (package_id, package_version, package_hash, catalog_package_id, registered_by, registration_source)
  values (p_package_id, p_package_version, p_package_hash, p_catalog_package_id,
    (select auth.uid()), 'PLATFORM_ADMIN')
  on conflict (package_id, package_version) do nothing;
  select * into v_existing from public.exercise_package_lab_catalog_bindings
  where package_id = p_package_id and package_version = p_package_version;
  if v_existing.package_hash is distinct from p_package_hash
    or v_existing.catalog_package_id is distinct from p_catalog_package_id then
    raise exception 'LAB_PACKAGE_VERSION_CONFLICT' using errcode = '23505';
  end if;
  return true;
end $$;
-- Authenticated callers may reach this RPC, but only is_platform_admin() may
-- make the immutable registration; no direct table grants are issued.
revoke all on function public.register_exercise_package_lab_catalog(text,text,text,text) from public, anon;
grant execute on function public.register_exercise_package_lab_catalog(text,text,text,text) to authenticated;

create or replace function public.lab_catalog_scope_allowed(
  p_exercise_id text, p_state jsonb, p_catalog_package_id text
)
returns boolean
language sql stable security invoker set search_path = '' as $$
  select case
    when p_catalog_package_id = 'NARVA_POLYTRAUMA'
      and p_state->'exercisePackageReference'->>'packageId' = 'russicaptor.narva-trauma'
      then true
    when p_catalog_package_id = 'NARVA_IRO_ASTRUP'
      and p_state->'exercisePackageReference'->>'packageId' = 'russicaptor.narva-iro-evacuation'
      then true
    else exists (
      select 1 from public.exercise_package_lab_catalog_bindings as binding
      where binding.package_id = p_state->'exercisePackageReference'->>'packageId'
        and binding.package_version = p_state->'exercisePackageReference'->>'packageVersion'
        and binding.package_hash = p_state->'patientMaterialization'->>'packageHash'
        and binding.catalog_package_id = p_catalog_package_id
        and p_state->'patientMaterialization'->>'packageId' = binding.package_id
        and p_state->'patientMaterialization'->>'packageVersion' = binding.package_version
        and p_state->'patientMaterialization'->>'exerciseId' = p_exercise_id
    )
  end;
$$;
revoke all on function public.lab_catalog_scope_allowed(text,jsonb,text) from public, anon, authenticated;

-- Keep a running/paused exercise's package hash as immutable as its package
-- ID/version. Both values are published during supported Admin creation.
create or replace function public.enforce_active_exercise_package_identity()
returns trigger
language plpgsql set search_path = '' as $$
declare
  v_old_lifecycle text;
begin
  v_old_lifecycle := coalesce(
    old.state->'exerciseSession'->>'lifecycleState',
    case old.state->'exerciseSession'->>'state'
      when 'running' then 'RUNNING'
      when 'paused' then 'PAUSED'
      else 'READY'
    end
  );
  if v_old_lifecycle not in ('RUNNING', 'PAUSED') then return new; end if;
  if (old.state->'exercisePackageReference'->>'packageId',
      old.state->'exercisePackageReference'->>'packageVersion',
      old.state->'patientMaterialization'->>'packageHash') is distinct from
     (new.state->'exercisePackageReference'->>'packageId',
      new.state->'exercisePackageReference'->>'packageVersion',
      new.state->'patientMaterialization'->>'packageHash')
    or old.state->'exercisePackageReference'->>'packageId' is null
    or old.state->'exercisePackageReference'->>'packageVersion' is null
    or new.state->'exercisePackageReference'->>'packageId' is null
    or new.state->'exercisePackageReference'->>'packageVersion' is null then
    raise exception 'ACTIVE_EXERCISE_PACKAGE_IDENTITY_CONFLICT' using errcode = '23514';
  end if;
  return new;
end $$;

-- Preserve the installed RPC's other command validation and authorization
-- verbatim. Fail migration if its expected narrow scope predicate differs.
do $body$
declare
  v_definition text;
  v_old text := $old$
  if p_command_type='LAB_ORDER' and (
      (p_command_payload->>'labPackageId'='NARVA_POLYTRAUMA' and
        v_exercise.state->'exercisePackageReference'->>'packageId' is distinct from 'russicaptor.narva-trauma')
      or (p_command_payload->>'labPackageId'='NARVA_IRO_ASTRUP' and
        v_exercise.state->'exercisePackageReference'->>'packageId' is distinct from 'russicaptor.narva-iro-evacuation')
    ) then raise exception 'LAB_PACKAGE_SCOPE_DENIED' using errcode='42501'; end if;$old$;
  v_new text := $new$
  if p_command_type='LAB_ORDER' and not public.lab_catalog_scope_allowed(
      p_exercise_id, v_exercise.state, p_command_payload->>'labPackageId') then
    raise exception 'LAB_PACKAGE_SCOPE_DENIED' using errcode='42501';
  end if;$new$;
begin
  select pg_get_functiondef('public.submit_runtime_patient_command(text,text,text,text,bigint,numeric,jsonb)'::regprocedure)
    into v_definition;
  if length(v_definition) - length(replace(v_definition, v_old, '')) <> length(v_old) then
    raise exception 'LAB_SCOPE_PREDICATE_SHAPE_UNEXPECTED';
  end if;
  execute replace(v_definition, v_old, v_new);
end $body$;
