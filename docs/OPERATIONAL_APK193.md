# APK193 / 1.2.6 — optional normal Narva radiographs

Authorized 2026-10-29: build and qualify an operational APK, update only Samsung
SM-X356B / R5GL84X98FD preserving application data, and perform one TEST with
temporary exercise-scoped CM/EXCON, staged 7/10-minute checks and restoration.
Complete the TEST and revoke its task-created roles. No server logic change,
delta pruning, scheduler, public publication or other-device installation.

Based on accepted operational APK192 source
`524814c5e7f03c07fb6069723f5bb85945289161` and the separately versioned Narva
trauma 1.0.7 content extension. The new optional normal PA chest for
PT-PELVIC-001 and normal pelvis for PT-CHEST-001 use the unchanged canonical
ordering, image-at-7/report-at-10 simulation-minute workflow and bundled viewer.
Pathological studies remain. New studies are not automatically ordered.
Historical packages and running exercises are not upgraded or rebound.

Package `russicaptor.narva-trauma@1.0.7` has composed runtime hash
`64468d8ae2dcfbd8c54b4411bf1add55a8ff8b96ca6465bfee08dcebfe1cfc7e`.
See `NARVA_TRAUMA_NORMAL_RADIOGRAPHS_V107.md` for image provenance and scope.
This is normal operational source, not the APK191 diagnostic journal.
No diagnostic/fault-input/test-only mechanism is introduced.

VersionName 1.2.6 / versionCode 193 permit the supported in-place update over
APK192 with the existing pinned signer. No uninstall, storage clear, downgrade,
logout, role broadening or signing-trust change is authorized.

Applicable Runtime/package/imaging invariants remain mandatory. Exact source
qualification, full Jest including unchanged Runtime Hardening/performance,
TypeScript, ESLint, diff and asset checks precede the canonical signed build.
Physical checks and cleanup results must be recorded separately; source tests
do not establish physical acceptance. Existing A2/M1/migration acceptance remains.
The known initial session/role verification timeout is not claimed fixed;
usable authority still requires successful verification through supported flows.
