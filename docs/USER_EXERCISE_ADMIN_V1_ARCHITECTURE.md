# User and exercise administration v1

## Boundary

This module adds platform administration beside the validated Narva runtime. It
does not alter clinical packages, patient state, Runtime materialization, writer
election, or the meaning of CM and EXCON. The published validated baseline tag
continues to identify `987eb5fc0cacf6bf2fc027cbda81b791aa088926`.

## Existing authority reused

- Supabase Auth remains the persistent user-identity provider.
- `operator_profiles` remains the source of operator display name and enabled
  state.
- `authorization_role_assignments` remains the source of exercise-scoped CM and
  EXCON authority.
- `trusted_admin_grant_exercise_role` and
  `trusted_admin_revoke_exercise_role` remain the only role mutation paths.
- Fresh exercise creation continues through the existing one-shot bootstrap and
  canonical exercise preparation path.
- Runtime writer, patient ownership, and exercise finalization continue through
  their existing audited lifecycle. Administration does not edit their tables.

## New platform authority

`platform_admins` is a narrow allow-list of permanent, non-anonymous Supabase
users. It is separate from CM and EXCON assignments. A platform administrator
does not thereby become an exercise participant, writer, patient owner, CM, or
EXCON.

The mobile client may ask only whether its own authenticated identity is an
active platform administrator. It cannot list or mutate the allow-list. Every
privileged operation is re-authorized inside a trusted Edge Function before the
service-role client is used.

## Data model

### User

- Supabase Auth user ID and email/sign-in identity;
- `operator_profiles.display_name`;
- Auth invitation/confirmation and last-sign-in metadata;
- effective active/disabled state from Auth ban status and operator profile;
- no password, reset token, access token, or readable credential field.

### Exercise

- canonical exercise ID from `exercise_states`;
- package ID/version and lifecycle projected from canonical state;
- creation/update time, participant counts, and current writer lease;
- terminal exercises are read-only in administration.

### Assignment

- existing assignment ID, user ID, exercise ID, CM/EXCON role, status,
  issue/revocation timestamps, and audit actors;
- only `EXERCISE` scope is accepted by administration; `GLOBAL` is rejected.

### Administrative audit

`administrative_action_audit` records actor, bounded action, target user,
exercise, outcome, timestamp, and non-secret details. It never records
passwords, access tokens, invitation tokens, reset tokens, or API keys.

## Trusted server boundary

Two domain-scoped Edge Functions are used rather than a generic command
executor:

1. `platform-admin-users` lists bounded user metadata and performs invite,
   password-reset request, deactivate, and reactivate operations.
2. `platform-admin-exercises` lists/creates exercises and grants or revokes
   exercise-scoped CM/EXCON roles through existing trusted RPCs.

Each function authenticates the caller, checks `platform_admins` server-side,
validates an explicit operation-specific payload, performs one bounded action,
and writes an audit outcome. The client contains only the publishable key and
the signed-in user's session; it never receives a Supabase secret/service-role
key.

## Account lifecycle

- Invite uses Supabase Auth `inviteUserByEmail`; the user chooses the password.
- Reset uses Supabase Auth's email recovery flow; the administrator receives no
  password or reset token.
- Deactivation first checks for active CM/EXCON assignments, patient ownership,
  and writer leases. It fails closed while operational state exists. The state
  must be released through its existing Runtime lifecycle before retrying.
- Once clear, assignments are revoked through the trusted role-revocation RPC,
  the profile is disabled, and the Auth user is banned.
- Reactivation removes the Auth ban and re-enables the profile; it does not
  restore prior exercise roles.

This v1 deliberately does not impersonate an operator or directly null Runtime
ownership. That avoids introducing a second canonical cleanup authority.

## Exercise creation

The administrator chooses a registered package. The trusted server issues one
short-lived bootstrap authorization for the administrator. The existing client
exercise-preparation flow consumes it and creates the canonical exercise. No
exercise ID is accepted from free-form user input.

## Required additive schema

The feature requires one additive migration containing:

- `platform_admins` with RLS, revoked client grants, and an explicit deny policy;
- `administrative_action_audit` with RLS, revoked client grants, and an explicit deny policy;
- a self-only `is_platform_admin()` predicate;
- service-role-only helpers for profile upsert/status and bounded audit writes;
- read-only administrative projections for users/exercises where needed;
- hardened grants ensuring ordinary authenticated users cannot invoke trusted
  provisioning functions.

No existing runtime table, role meaning, package row, RLS policy, or migration
history entry is removed or rewritten.
