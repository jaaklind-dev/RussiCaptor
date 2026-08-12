-- Transactional WP-41A backend authorization smoke test. Leaves no rows behind.
begin;

select set_config('request.jwt.claim.sub', (select id::text from auth.users order by created_at limit 1), true);

do $$
declare
  v_user uuid := auth.uid();
  v_assignment uuid;
  v_audit uuid;
begin
  if v_user is null then raise exception 'Smoke test requires one auth.users row'; end if;

  if public.has_authorization_permission('INSTRUCTOR_EVALUATION_WRITE', 'WP41A') then
    raise exception 'Unassigned user was authorized';
  end if;

  insert into public.authorization_role_assignments (user_id, role, scope_type, scope_id, issued_by)
  values (v_user, 'EXCON', 'EXERCISE', 'WP41A', v_user)
  returning id into v_assignment;

  if not public.has_authorization_permission('INSTRUCTOR_EVALUATION_READ', 'WP41A') then raise exception 'Assigned EXCON read was denied'; end if;
  if not public.has_authorization_permission('INSTRUCTOR_EVALUATION_WRITE', 'WP41A') then raise exception 'Assigned EXCON write was denied'; end if;
  if public.has_authorization_permission('INSTRUCTOR_EVALUATION_WRITE', 'OTHER') then raise exception 'Scope mismatch was authorized'; end if;
  if public.has_authorization_permission('UNKNOWN', 'WP41A') then raise exception 'Unknown permission was authorized'; end if;

  update public.authorization_role_assignments
  set status = 'REVOKED', revoked_at = now(), revoked_by = v_user
  where id = v_assignment;
  if public.has_authorization_permission('INSTRUCTOR_EVALUATION_WRITE', 'WP41A') then raise exception 'Revoked role was authorized'; end if;

  v_audit := public.record_authorization_decision('INSTRUCTOR_EVALUATION_WRITE', 'WP41A', 'WP41A_TEST');
  if not exists (select 1 from public.authorization_audit where id = v_audit and user_id = v_user and decision = 'DENIED') then raise exception 'Authorization audit was not authoritatively derived'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  if public.has_authorization_permission('INSTRUCTOR_EVALUATION_WRITE', 'WP41A') then raise exception 'Unauthenticated call was authorized'; end if;
end $$;

rollback;
