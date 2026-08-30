# RussiCaptor multi-device GO / NO-GO

Run `node scripts/multi-device-rehearsal-check.mjs` before touching the exercise. Remote evidence flags may be set to `PASS` only after a trusted administrator verifies them; they never contain credentials.

## GO

- [ ] Canonical `RussiCaptor-1.0.0-2.apk`, production signer, versionCode 2 and known Git SHA
- [ ] Required migrations deployed; Supabase healthy
- [ ] CM-A, CM-B and EXCON accounts authenticate
- [ ] Short-lived exercise-scoped roles active; no unrelated assignment
- [ ] Two devices online (three for independent EXCON-loss drill)
- [ ] `russicaptor.runtime-continuity-reference@1.0.0` prepared and RUNNING
- [ ] `PT-PELVIC-001` and `PT-PLEURAL-001` visible; durable checkpoint exists
- [ ] No other RUNNING test conflict, stale lease or orphan ownership

## NO-GO

STOP for a wrong signer/version/SHA, missing migration, backend outage, failed authentication, missing scope, stale RUNNING conflict, active stale lease, missing checkpoint, or unresolved owner. Never repair operational rows with SQL.

Afterward run `node scripts/multi-device-rehearsal-check.mjs --cleanup`; cleanup is complete only when roles are revoked, exercise terminal, lease inactive and ownership clear.
