-- Keep failed Admin-create cleanup one-shot. A consumed bootstrap is an
-- immutable link to its created exercise, even if a caller races consumption.
create or replace function public.trusted_admin_revoke_exercise_bootstrap(
  p_bootstrap_id uuid,
  p_revoked_by uuid
)
returns public.exercise_bootstrap_authorizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_authorization public.exercise_bootstrap_authorizations%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_bootstrap_id is null or p_revoked_by is null then
    raise exception 'INVALID_USER_IDENTIFIER' using errcode = '22023';
  end if;
  if not exists (
    select 1 from auth.users as revoker
    where revoker.id = p_revoked_by
      and not revoker.is_anonymous
      and (revoker.banned_until is null or revoker.banned_until <= v_now)
  ) then
    raise exception 'INVALID_REVOKER' using errcode = '22023';
  end if;

  select bootstrap.* into v_authorization
  from public.exercise_bootstrap_authorizations as bootstrap
  where bootstrap.id = p_bootstrap_id
  for update;

  if not found then
    raise exception 'BOOTSTRAP_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_authorization.consumed_exercise_id is not null or v_authorization.consumed_at is not null then
    raise exception 'BOOTSTRAP_ALREADY_CONSUMED' using errcode = '23514';
  end if;
  if v_authorization.status = 'REVOKED' then
    return v_authorization;
  end if;

  update public.exercise_bootstrap_authorizations
  set status = 'REVOKED', revoked_at = v_now, revoked_by = p_revoked_by
  where id = p_bootstrap_id
  returning * into v_authorization;
  return v_authorization;
end;
$$;

notify pgrst, 'reload schema';
