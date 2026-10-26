-- One atomic server-side statement: no intermediate DDL commit.
DO $bootstrap_patch$
BEGIN
  PERFORM set_config('search_path','pg_catalog',true);
  LOCK TABLE public.exercise_bootstrap_authorizations IN ACCESS EXCLUSIVE MODE;
  IF encode(sha256(convert_to(pg_get_functiondef('public.trusted_admin_grant_exercise_bootstrap(uuid,uuid,timestamp with time zone,text)'::regprocedure),'UTF8')),'hex') <> '19feb454782a5eaf2ce6cd6e3a015827892b579fd8d5b1115cae4cb5ad6dc023'
    OR encode(sha256(convert_to(pg_get_functiondef('rc_history.guard_runtime()'::regprocedure),'UTF8')),'hex') <> 'ce4ab6c02b3ea5858b8643938b8ec4aa9a344c852d135f4aebb1a3e0bba83262'
  THEN RAISE EXCEPTION 'BOOTSTRAP_PATCH_SOURCE_CAS_MISMATCH' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid='public.exercise_bootstrap_one_active_per_user_idx'::regclass
    AND indrelid='public.exercise_bootstrap_authorizations'::regclass AND indisunique AND indnkeyatts=1
    AND pg_get_expr(indpred,indrelid)='(status = ''ACTIVE''::text)')
  THEN RAISE EXCEPTION 'BOOTSTRAP_PATCH_INDEX_CAS_MISMATCH' USING ERRCODE='55000'; END IF;
  DROP INDEX public.exercise_bootstrap_one_active_per_user_idx;
  CREATE UNIQUE INDEX exercise_bootstrap_one_active_per_user_idx
    ON public.exercise_bootstrap_authorizations(user_id)
    WHERE status = 'ACTIVE' AND consumed_exercise_id IS NULL;
  EXECUTE $definition$
CREATE OR REPLACE FUNCTION public.trusted_admin_grant_exercise_bootstrap(p_user_id uuid, p_issued_by uuid, p_expires_at timestamp with time zone, p_purpose text DEFAULT 'FRESH_EXERCISE_BOOTSTRAP'::text)
 RETURNS public.exercise_bootstrap_authorizations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_authorization public.exercise_bootstrap_authorizations%rowtype;
  v_now timestamptz := clock_timestamp();
  v_purpose text := btrim(coalesce(p_purpose, ''));
begin
  if p_user_id is null or p_issued_by is null then
    raise exception 'INVALID_USER_IDENTIFIER' using errcode = '22023';
  end if;
  if p_expires_at is null
    or p_expires_at <= v_now
    or p_expires_at > v_now + interval '15 minutes' then
    raise exception 'INVALID_BOOTSTRAP_EXPIRY' using errcode = '22023';
  end if;
  if length(v_purpose) not between 1 and 160 then
    raise exception 'INVALID_BOOTSTRAP_PURPOSE' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from auth.users as target_user
    join public.operator_profiles as target_profile
      on target_profile.user_id = target_user.id
    where target_user.id = p_user_id
      and not target_user.is_anonymous
      and (target_user.banned_until is null or target_user.banned_until <= v_now)
      and target_profile.status = 'ACTIVE'
  ) then
    raise exception 'TARGET_OPERATOR_NOT_ACTIVE' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from auth.users as issuer
    where issuer.id = p_issued_by
      and not issuer.is_anonymous
      and (issuer.banned_until is null or issuer.banned_until <= v_now)
  ) then
    raise exception 'INVALID_ISSUER' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('EXERCISE_BOOTSTRAP' || E'\n' || p_user_id::text, 0)
  );

  update public.exercise_bootstrap_authorizations
  set status = 'REVOKED',
      revoked_at = v_now,
      revoked_by = p_issued_by
  where user_id = p_user_id
    and status = 'ACTIVE'
    and consumed_exercise_id is null
    and expires_at <= v_now;

  select bootstrap.*
  into v_authorization
  from public.exercise_bootstrap_authorizations as bootstrap
  where bootstrap.user_id = p_user_id
    and bootstrap.status = 'ACTIVE'
    and (bootstrap.consumed_exercise_id is null or bootstrap.expires_at > v_now)
  for update;

  if found then
    if v_authorization.expires_at is distinct from p_expires_at
      or v_authorization.purpose is distinct from v_purpose then
      raise exception 'ACTIVE_BOOTSTRAP_CONFLICT' using errcode = '23505';
    end if;
    return v_authorization;
  end if;

  insert into public.exercise_bootstrap_authorizations (
    user_id,
    status,
    purpose,
    issued_at,
    expires_at,
    issued_by
  ) values (
    p_user_id,
    'ACTIVE',
    v_purpose,
    v_now,
    p_expires_at,
    p_issued_by
  )
  returning * into v_authorization;

  return v_authorization;
end;
$function$
;
$definition$;
END
$bootstrap_patch$;
