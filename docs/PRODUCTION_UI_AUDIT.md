# RussiCaptor production-UI audit

Work package: `PRODUCTION-UI-CLEANUP-01`

This audit covers the 25 routes originally present under `src/app` (excluding layout files) and their shared cards, modals, banners, empty states, and error presentations. The unused Expo starter “Explore” route was development-only and was removed, leaving 24 production routes. It changes presentation only; canonical identifiers, persistence, commands, roles, and test selectors remain unchanged.

## Production policy

- **USER** — clinical, operational, account, exercise, and release information needed for the current task.
- **ADMIN_DIAGNOSTIC** — support information shown only in the platform-admin “Tehnilised üksikasjad” route.
- **DEVELOPMENT_ONLY** — raw identifiers, hashes, revisions, provider/module keys, backend names, raw errors, and acceptance-only controls. These are hidden from normal production workflows. Stable `testID` values remain non-visible.

## Screen inventory

| Area | Screens reviewed | USER content retained | ADMIN_DIAGNOSTIC retained | DEVELOPMENT_ONLY removed or hidden |
| --- | ---: | --- | --- | --- |
| Auth | 3 | product/build number, login, bounded callback and password guidance | none | Git SHA, environment, Supabase project ref, raw configuration/auth errors, tokens and callback data |
| CM | 6 | exercise state/time, scenario patient name, triage, location, clinical data/actions, terminal/read-only state | none | visible `PT-*` IDs, Runtime/state-version wording, raw readiness internals |
| EXCON | 12 | exercise/patient/resource state, controls, timeline, debrief, analytics and evaluation results | none in the normal EXCON workflow | patient IDs in primary cards/headers, package/protocol hashes, provider/module IDs, runtime event IDs, raw command errors, English control states, workbook/module import controls, diagnostics shortcut |
| Administration | 3 | user name/email/status, exercise package/version/status, participant counts, roles and lifecycle actions | platform-admin-only technical-details route | UUID fallbacks, raw `EX-*` IDs in daily lists, raw enums, RPC errors, Runtime/writer-lease terminology |
| Global/startup | 1 | safe startup progress and release identity | none | backend implementation names and raw failure payloads |

## DEVELOPMENT_ONLY inventory

- Login Git SHA, build environment and Supabase project reference.
- Visible CM patient IDs and canonical Runtime state version.
- Visible EXCON patient IDs in overview/header/event-success text.
- Package, definition, protocol, analytics, assessment and replay hashes in operational views.
- Module, provider, resolver, protocol and definition IDs in package summary cards.
- Runtime event IDs and command error codes in success/failure messages.
- Raw account/assignment/lifecycle enums and raw backend errors.
- Writer instance IDs and validation-only controls outside the gated validation harness.
- Developer resource and clinical assessment cards (already protected by `__DEV__`).
- Shared-workflow acceptance controls (already protected by the validation-harness flag).
- The reachable Expo starter tutorial route (`/explore`).
- Workbook and manifest/module import controls from the normal EXCON workflow.
- The normal EXCON diagnostics shortcut and unused demo-user styling.
- Raw event IDs, sequence numbers, event types and JSON metadata from the main timeline detail.
- Raw analytics provider/metric/evidence identifiers and patient IDs from analytics filters and cards.
- Raw assessment protocol/expectation/evidence/diagnostic identifiers from assessment views.
- Evaluation profile/evaluation hashes, expectation and evaluator IDs, revision lists, and internal WP references.
- Patient IDs from EXCON active-patient, upcoming-event, event-history, takeover, timeline and debrief views.

## ADMIN_DIAGNOSTIC inventory

The explicit platform-admin technical-details route retains only support-relevant, read-only operational metadata and supported recovery actions:

- internal exercise ID;
- checkpoint and workflow revisions;
- writer/lease state and expiry;
- current readiness/synchronization state;
- pending mutation/conflict counts;
- bounded diagnostic export.

The Supabase project reference and secret/auth material are not displayed. Validation fault-injection controls remain behind the existing validation-harness feature gate.

## USER-facing technical content intentionally retained

- app version and Android build number on the login screen;
- package display name and package version;
- exercise simulation time and speed;
- patient triage and clinically meaningful location/status;
- EXCON operational resource, participant, readiness, and terminal-state summaries;
- exact IDs only where an explicit technical recovery view needs them.

## Accessibility and automation

Visible development strings were removed independently of semantic identity. Route parameters, React keys, command identities, accessibility roles/labels, and deterministic `testID` values remain available. No coordinate-only interaction was introduced.

## Security result

Normal production screens do not render service-role secrets, access/refresh tokens, invite/recovery tokens, callback URLs, passwords, or raw authorization grants. Known UI failures use bounded Estonian messages; detailed operational troubleshooting remains separated from daily workflows.
