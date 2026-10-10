# PLATFORM_ADMIN break-glass recovery

This is an emergency-only server-side path for restoring platform administration
when no usable administrator session exists. It does not grant CM, EXCON, GLOBAL
operational scope, writer authority, or patient ownership. It is not a mobile UI.

## Prerequisites

- The narrow `20261010051206_platform_admin_break_glass_recovery` migration and
  `platform-admin-recovery` Edge Function must be deployed to the same project.
- Deploy this one function with gateway JWT verification disabled: modern
  `sb_secret_` server keys are opaque, not JWTs. The function itself verifies
  every request with a bounded, read-only Auth Admin capability probe before
  parsing any recovery action. A failed probe denies access. Legacy service-role
  keys remain supported; publishable/anon keys and user JWTs do not authorize recovery.
- A trusted operator must have an existing privileged server credential in their
  local macOS Keychain entry `RussiCaptor-Supabase-ServiceRole-fimcsrivizpliiuoqopv`.
  Never place it in source, the app, a shell argument, or a report.
- Independently verify the exact target Auth user ID and email, current account
  state, and project reference before running recovery.

## Grant and revoke

Run the trusted local operator tool with an exact user ID and matching email:

```text
node scripts/platform-admin-recovery.mjs --action grant --user-id UUID --email ADDRESS
node scripts/platform-admin-recovery.mjs --action revoke --user-id UUID --email ADDRESS
```

Each invocation creates a 256-bit random authorization, stores only its SHA-256
hash server-side, binds it to the operation ID, exact user ID, email and action,
and expires it after 10 minutes. The tool immediately consumes it through the
atomic database operation. The token is never printed or persisted. A prepared
authorization may be cancelled by the trusted endpoint; an expired or consumed
authorization cannot be applied. The operator tool checks the bounded status
by operation ID after a lost response; if it still reports an ambiguous failure,
inspect the operation ID and audit state before any retry.

The grant requires an existing, active, confirmed, unbanned Auth account and an
active operator profile. Revoke preserves the Auth account and all unrelated
exercise-scoped assignments. Reuse of a consumed authorization is denied; the
role effect and audit entry occur at most once per authorization. No direct SQL
grant/revoke is part of the supported procedure.

## Audit and boundary

The atomic operation records `PLATFORM_ADMIN_GRANTED` or
`PLATFORM_ADMIN_REVOKED` in `administrative_action_audit` with target, time,
authorization ID, operation ID and `SERVICE_ROLE_BREAK_GLASS` mechanism. The
service actor is recorded as a mechanism, not misrepresented as another human
user. The existing unaudited grant/revoke RPCs are no longer executable by
`service_role`; the recovery RPC is the supported mutation path.

Only trusted operator tooling receives the one-time authorization. Ordinary
authenticated users, the mobile app and exercise EXCON have no recovery-table
or recovery-RPC access. The Edge Function is POST-only, non-CORS and requires the
server credential even though gateway JWT verification is disabled. No password, token,
credential or full request URL belongs in audit details or logs.

After a temporary grant, verify normal sign-in and Admin UI. Revoke promptly,
refresh the client, and verify Admin access disappears while the Auth account
remains active. Never retain PLATFORM_ADMIN merely to run a CM runtime test.
