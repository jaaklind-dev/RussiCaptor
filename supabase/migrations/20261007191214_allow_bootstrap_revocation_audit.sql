-- The supported failed-create cleanup records this bounded action after
-- revoking an unused bootstrap. Preserve the original allowlist and add only
-- the missing revocation action; no client grant or RLS policy changes.
alter table public.administrative_action_audit
  drop constraint administrative_action_audit_action_check;

alter table public.administrative_action_audit
  add constraint administrative_action_audit_action_check
  check (action in (
    'USER_INVITED', 'PASSWORD_RESET_REQUESTED', 'USER_DEACTIVATED',
    'USER_REACTIVATED', 'EXERCISE_BOOTSTRAP_GRANTED',
    'EXERCISE_BOOTSTRAP_REVOKED', 'CM_GRANTED', 'EXCON_GRANTED',
    'CM_REVOKED', 'EXCON_REVOKED'
  ));
