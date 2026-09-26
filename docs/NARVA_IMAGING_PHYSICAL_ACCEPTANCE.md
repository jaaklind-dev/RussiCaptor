# Narva Imaging physical acceptance harness

The single entry point is `scripts/narva-imaging-physical-acceptance.mjs`. It is fail-closed and writes a mode-0600 JSON evidence report without credentials or full checkpoints.

## Preparation-only verification

```sh
node scripts/narva-imaging-physical-acceptance.mjs --mode prepare
```

This validates the local migration and canonical Narva definition. It never reads a secret, deploys a migration, grants a role, creates an exercise, or touches a device.

## Future physical run

1. Keep the Mac unlocked with `caffeinate -di`. Record the Samsung's brightness, brightness mode, and stay-awake value; keep it awake/unlocked and never send power/sleep key events.
2. Run the physical precheck with the accepted source HEAD, exact APK identity and connected serial recorded in the session:

   ```sh
   node scripts/narva-imaging-physical-acceptance.mjs --mode physical-precheck --device <SERIAL> --output artifacts/narva-imaging-physical-precheck.json
   ```

3. Inspect the linked Supabase migration ledger. Deploy only `20260925120000_add_imaging_runtime_patient_command.sql`, and only when it is the sole pending local migration, through `npx supabase db push --linked`. Re-read the ledger afterward. Never substitute direct SQL.
4. Through the exact approved Keychain service-role item and supported audited RPCs, reuse a valid scoped assignment or grant temporary bootstrap, then scoped EXCON/CM. On `ACTIVE_ASSIGNMENT_CONFLICT`, resolve the existing assignment through the audited lifecycle; do not retry or grant GLOBAL.
5. Create a fresh `russicaptor.narva-trauma@1.0.3` exercise in the normal app UI. Record exercise/runtime/assignment/lease/checkpoint identifiers. Assert the package content before ordering.
6. Submit one `P02-CXR` through the production `IMAGING_ORDER` route. Capture pre-threshold, post-threshold, repeated-advance and cold-restart evidence in one JSON document. Do not dump full checkpoints.
   For I4, verify the RESULTED report is exact, no placeholder image is shown, the result has no asset reference, and cold restart preserves the same report-only provenance.
7. Validate the evidence:

   ```sh
   node scripts/narva-imaging-physical-acceptance.mjs --mode verify-evidence --evidence <SESSION-EVIDENCE.json> --output artifacts/narva-imaging-physical-result.json
   ```

8. If the supported UI exposes repeat ordering, submit a new command and verify a distinct second instance. Otherwise record `REPEAT_UI_NOT_EXPOSED`; do not add a bypass.
   A separate optional demo smoke may verify that `demo.head-ct.image01.v1` resolves before and after restart without appearing in Narva. It must not broaden or interfere with the Narva gate.
9. Clean up in the recorded order: stop commands, collect evidence, revoke only created CM/EXCON/bootstrap assignments, verify assignments, stop app/runtime, verify lease release, restore device settings, then stop caffeinate last. Preserve the exercise evidence.

Any violated product invariant is `FAIL`. Missing device, authorization, credential or environment is `BLOCKED`. A single-device run may pass while the multi-client physical convergence sub-gate remains `DEFERRED_SECOND_CLIENT`.
