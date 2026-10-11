-- WP-NEXT-02: production operator identity and least-privilege authorization.
-- Provisioning remains a trusted administrative operation: no client mutation
-- policy is created for profiles or role assignments.

create table if not exists public.operator_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','DISABLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id)
);
alter table public.operator_profiles enable row level security;
drop policy if exists "operator reads own profile" on public.operator_profiles;
create policy "operator reads own profile" on public.operator_profiles for select to authenticated
using (user_id=(select auth.uid()) and status='ACTIVE');
revoke all on public.operator_profiles from anon;
grant select on public.operator_profiles to authenticated;

do $$ declare v_name text;
begin
  select conname into v_name from pg_constraint
  where conrelid='public.authorization_role_assignments'::regclass and contype='c'
    and pg_get_constraintdef(oid) like '%role%EXCON%' limit 1;
  if v_name is not null then execute format('alter table public.authorization_role_assignments drop constraint %I',v_name); end if;
end $$;
alter table public.authorization_role_assignments
  add constraint authorization_role_assignments_role_check check(role in ('CM','EXCON')) not valid;
alter table public.authorization_role_assignments validate constraint authorization_role_assignments_role_check;
alter table public.authorization_role_assignments
  add constraint authorization_cm_exercise_scope_check check(role<>'CM' or scope_type='EXERCISE') not valid;
alter table public.authorization_role_assignments validate constraint authorization_cm_exercise_scope_check;
create index if not exists authorization_role_assignments_scope_lookup_idx
  on public.authorization_role_assignments(user_id,role,scope_type,scope_id,status,expires_at);

create or replace function public.has_authorization_permission(p_permission text,p_exercise_id text default null)
returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null
    and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)
    and p_permission in ('EXERCISE_JOIN','CM_WORKFLOW_WRITE','EXCON_EXERCISE_CONTROL','EXERCISE_PACKAGE_IMPORT',
      'INSTRUCTOR_EVALUATION_READ','INSTRUCTOR_EVALUATION_WRITE','EXERCISE_RUNTIME_RECOVERY')
    and exists (
      select 1 from public.operator_profiles profile
      join public.authorization_role_assignments assignment on assignment.user_id=profile.user_id
      where profile.user_id=(select auth.uid()) and profile.status='ACTIVE'
        and assignment.status='ACTIVE' and (assignment.expires_at is null or assignment.expires_at>now())
        and (
          (assignment.role='CM' and p_permission in ('EXERCISE_JOIN','CM_WORKFLOW_WRITE'))
          or (assignment.role='EXCON' and p_permission in ('EXERCISE_JOIN','EXCON_EXERCISE_CONTROL','EXERCISE_PACKAGE_IMPORT',
            'INSTRUCTOR_EVALUATION_READ','INSTRUCTOR_EVALUATION_WRITE','EXERCISE_RUNTIME_RECOVERY'))
        )
        and (assignment.scope_type='GLOBAL' or (assignment.scope_type='EXERCISE' and p_exercise_id is not null and assignment.scope_id=p_exercise_id))
        and (p_permission<>'EXERCISE_PACKAGE_IMPORT' or assignment.scope_type='GLOBAL')
    );
$$;
revoke all on function public.has_authorization_permission(text,text) from public,anon;
grant execute on function public.has_authorization_permission(text,text) to authenticated;

create or replace function public.record_authorization_decision(p_permission text,p_exercise_id text,p_operation text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_authorized boolean; v_assignments uuid[];
begin
  if (select auth.uid()) is null or coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false) then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501';
  end if;
  if p_permission not in ('EXERCISE_JOIN','CM_WORKFLOW_WRITE','EXCON_EXERCISE_CONTROL','EXERCISE_PACKAGE_IMPORT',
    'INSTRUCTOR_EVALUATION_READ','INSTRUCTOR_EVALUATION_WRITE','EXERCISE_RUNTIME_RECOVERY') then raise exception 'UNSUPPORTED_PERMISSION'; end if;
  v_authorized:=public.has_authorization_permission(p_permission,p_exercise_id);
  select coalesce(array_agg(id order by id),'{}') into v_assignments from public.authorization_role_assignments
    where user_id=(select auth.uid()) and status='ACTIVE' and (expires_at is null or expires_at>now())
      and (scope_type='GLOBAL' or (scope_type='EXERCISE' and scope_id=p_exercise_id));
  insert into public.authorization_audit(user_id,permission,exercise_id,operation,decision,reason,freshness,assignment_ids)
    values((select auth.uid()),p_permission,p_exercise_id,p_operation,case when v_authorized then 'AUTHORIZED' else 'DENIED' end,
      case when v_authorized then null else 'PERMISSION_DENIED' end,'VERIFIED_ONLINE',v_assignments) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_authorization_decision(text,text,text) from public,anon;
grant execute on function public.record_authorization_decision(text,text,text) to authenticated;

alter table public.authorization_audit drop constraint if exists authorization_audit_permission_check;
alter table public.authorization_audit add constraint authorization_audit_permission_check check(permission in
  ('EXERCISE_JOIN','CM_WORKFLOW_WRITE','EXCON_EXERCISE_CONTROL','EXERCISE_PACKAGE_IMPORT',
   'INSTRUCTOR_EVALUATION_READ','INSTRUCTOR_EVALUATION_WRITE','EXERCISE_RUNTIME_RECOVERY'));

drop policy if exists "authenticated users can read exercise state" on public.exercise_states;
drop policy if exists "authenticated users can create exercise state" on public.exercise_states;
drop policy if exists "authenticated users can update exercise state" on public.exercise_states;
create policy "scoped operators read exercise state" on public.exercise_states for select to authenticated
using(public.has_authorization_permission('EXERCISE_JOIN',exercise_id));
create policy "scoped operators create exercise state" on public.exercise_states for insert to authenticated
with check(updated_by=(select auth.uid()) and
  (public.has_authorization_permission('CM_WORKFLOW_WRITE',exercise_id) or public.has_authorization_permission('EXCON_EXERCISE_CONTROL',exercise_id)));
create policy "scoped operators update exercise state" on public.exercise_states for update to authenticated
using(public.has_authorization_permission('CM_WORKFLOW_WRITE',exercise_id) or public.has_authorization_permission('EXCON_EXERCISE_CONTROL',exercise_id))
with check(updated_by=(select auth.uid()) and
  (public.has_authorization_permission('CM_WORKFLOW_WRITE',exercise_id) or public.has_authorization_permission('EXCON_EXERCISE_CONTROL',exercise_id)));

-- Runtime RPCs are SECURITY DEFINER for atomic authority writes. These table
-- triggers provide an additional server-side permission boundary without
-- changing lease, CAS, checkpoint or hash semantics.
create or replace function public.enforce_runtime_operator_scope()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_exercise_id text;
begin
  v_exercise_id:=coalesce(new.exercise_id,old.exercise_id);
  if not (public.has_authorization_permission('CM_WORKFLOW_WRITE',v_exercise_id)
    or public.has_authorization_permission('EXCON_EXERCISE_CONTROL',v_exercise_id)) then
    raise exception 'AUTHORIZATION_DENIED' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
drop trigger if exists runtime_writer_lease_operator_scope on public.runtime_writer_leases;
create trigger runtime_writer_lease_operator_scope before insert or update or delete on public.runtime_writer_leases
for each row execute function public.enforce_runtime_operator_scope();
drop trigger if exists runtime_checkpoint_operator_scope on public.runtime_checkpoints;
create trigger runtime_checkpoint_operator_scope before insert or update or delete on public.runtime_checkpoints
for each row execute function public.enforce_runtime_operator_scope();

-- Package import is a GLOBAL EXCON administrative operation. RLS remains in
-- place and these checks remove the former authenticated-only trust boundary.
drop policy if exists "authenticated users can create import runs" on public.import_runs;
create policy "global excon creates import runs" on public.import_runs for insert to authenticated
with check(created_by=(select auth.uid()) and status='PREPARING' and finished_at is null and error_details is null
  and public.has_authorization_permission('EXERCISE_PACKAGE_IMPORT',null));

create or replace function public.enforce_package_import_operator()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if not public.has_authorization_permission('EXERCISE_PACKAGE_IMPORT',null) then
    raise exception 'AUTHORIZATION_DENIED' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
drop trigger if exists import_run_operator_scope on public.import_runs;
create trigger import_run_operator_scope before insert or update or delete on public.import_runs
for each row execute function public.enforce_package_import_operator();
drop trigger if exists module_version_operator_scope on public.module_versions;
create trigger module_version_operator_scope before insert or update or delete on public.module_versions
for each row execute function public.enforce_package_import_operator();
drop trigger if exists import_run_module_operator_scope on public.import_run_modules;
create trigger import_run_module_operator_scope before insert or update or delete on public.import_run_modules
for each row execute function public.enforce_package_import_operator();
drop trigger if exists exercise_version_operator_scope on public.exercise_versions;
create trigger exercise_version_operator_scope before insert or update or delete on public.exercise_versions
for each row execute function public.enforce_package_import_operator();
drop trigger if exists exercise_module_binding_operator_scope on public.exercise_module_bindings;
create trigger exercise_module_binding_operator_scope before insert or update or delete on public.exercise_module_bindings
for each row execute function public.enforce_package_import_operator();

revoke all on function public.enforce_runtime_operator_scope() from public,anon,authenticated;
revoke all on function public.enforce_package_import_operator() from public,anon,authenticated;

-- Historical migrations predate the explicit anon grant hardening rule. Keep
-- authenticated EXECUTE where the mobile client needs the endpoint, but make
-- anonymous invocation impossible and pin every relevant definer search path.
revoke all on function public.acquire_runtime_writer(text,text,bigint,integer) from anon;
revoke all on function public.renew_runtime_writer(uuid,text,integer) from anon;
revoke all on function public.release_runtime_writer(uuid,text) from anon;
revoke all on function public.publish_runtime_checkpoint_metadata(uuid,text,bigint,jsonb) from anon;
revoke all on function public.publish_runtime_checkpoint_delta(uuid,text,bigint,jsonb,jsonb) from anon;
revoke all on function public.terminate_exercise_with_missing_runtime(text,integer,text) from anon;
revoke all on function public.save_instructor_evaluation_revision(text,text,integer,text,text,text,text,jsonb) from anon;
revoke all on function public.register_module_version(uuid,text,text,text,text,text,jsonb,integer,boolean,boolean) from anon;
revoke all on function public.stage_import_run(uuid) from anon;
revoke all on function public.activate_exercise_import(uuid,uuid) from anon;
revoke all on function public.fail_import_run(uuid,jsonb) from anon;

alter function public.acquire_runtime_writer(text,text,bigint,integer) set search_path='';
alter function public.renew_runtime_writer(uuid,text,integer) set search_path='';
alter function public.release_runtime_writer(uuid,text) set search_path='';
alter function public.publish_runtime_checkpoint_metadata(uuid,text,bigint,jsonb) set search_path='';
alter function public.publish_runtime_checkpoint_delta(uuid,text,bigint,jsonb,jsonb) set search_path='';
alter function public.terminate_exercise_with_missing_runtime(text,integer,text) set search_path='';
alter function public.save_instructor_evaluation_revision(text,text,integer,text,text,text,text,jsonb) set search_path='';
alter function public.register_module_version(uuid,text,text,text,text,text,jsonb,integer,boolean,boolean) set search_path='';
alter function public.stage_import_run(uuid) set search_path='';
alter function public.activate_exercise_import(uuid,uuid) set search_path='';
alter function public.fail_import_run(uuid,jsonb) set search_path='';
