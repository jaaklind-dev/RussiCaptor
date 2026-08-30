# RussiCaptor full dress-rehearsal checklist

## Before exercise

- [ ] Record release version, versionCode, Git SHA and environment.
- [ ] Verify required Supabase migrations and security-advisor blockers.
- [ ] Verify two distinct CM accounts and one EXCON account with correct exercise scopes.
- [ ] Verify `EXERCISE_RUNTIME_RECOVERY` only for the designated EXCON role.
- [ ] Charge devices; verify 5G/Wi-Fi and a spare network path.
- [ ] Test login, session restore and logout on every device.
- [ ] Start a technical exercise and confirm durable checkpoint publication.
- [ ] Confirm spare EXCON device can open diagnostics without taking authority.

## During exercise

- [ ] Monitor Realtime, Runtime writer/lease expiry, checkpoint revision/freshness and warnings.
- [ ] Confirm stale or offline devices cannot silently mutate authority.
- [ ] Export a privacy-safe diagnostic snapshot at the agreed checkpoint.

## Failure drills

- [ ] CM short disconnect and authoritative reconnect convergence.
- [ ] CM long disconnect and stale-owner rejection.
- [ ] Runtime writer process/device loss and EXCON takeover.
- [ ] EXCON device loss and spare EXCON re-entry.
- [ ] Valid-checkpoint recovery and missing-checkpoint audited termination fixture.
- [ ] Network switch between Wi-Fi and mobile data.
- [ ] Device restart with existing local durable state.

## End exercise

- [ ] Complete through the supported lifecycle control.
- [ ] Confirm Runtime stopped and lease inactive/released.
- [ ] Confirm terminal checkpoint/archive and recovery/control audit availability.
- [ ] Export final diagnostic snapshot.
- [ ] Confirm no active test exercise, temporary assignment or unresolved ownership conflict remains.
- [ ] Preserve audit evidence and record any deviation without editing backend rows.
