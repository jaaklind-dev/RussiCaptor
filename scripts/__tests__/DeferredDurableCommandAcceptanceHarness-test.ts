import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const core = require("../lib/deferred-durable-command-acceptance-core.cjs");

const root = resolve(__dirname, "../..");
const localFiles = ["20260918123000_large_canonical_checkpoint_publication_timeout.sql",
  ...core.DEFERRED_MIGRATIONS.map((item: { file: string }) => item.file)];
const baseline = [{ version: "REMOTE-DIFFERENT-VERSION", name: core.BASELINE_MIGRATION }];

describe("RELEASE-PREP-01 deferred durable command acceptance harness", () => {
  test("RP-A1 inventories the deferred durable-command migrations", () => {
    expect(core.DEFERRED_MIGRATIONS.map((item: { commandType: string }) => item.commandType))
      .toEqual(["IMAGING_ORDER", "ENDOTRACHEAL_INTUBATION", "PATIENT_COMPLETE",
        "PATIENT_LOCATION_TRANSFER"]);
    expect(core.validateMigrationArtifacts(root).map((item: { validation: { status: string } }) =>
      item.validation.status)).toEqual(["PASS", "PASS", "PASS", "PASS"]);
  });

  test("RP-A2 freezes exact migration SHA-256 values", () => {
    const actual = core.validateMigrationArtifacts(root);
    expect(actual.map((item: { actualSha256: string }) => item.actualSha256))
      .toEqual(core.DEFERRED_MIGRATIONS.map((item: { sha256: string }) => item.sha256));
  });

  test("RP-A3 unrelated pending migration blocks before deployment", () => {
    const result = core.analyzeLedger({ remoteMigrations: baseline,
      localMigrationFiles: [...localFiles, "20260927000000_unrelated.sql"].sort() });
    expect(result).toMatchObject({ status: "BLOCKED", reason: "UNRELATED_PENDING_MIGRATIONS",
      dbPushAllowed: false });
    expect(core.evaluatePrecheck({ head: "H", expectedHead: "H", clean: true,
      projectRef: core.PROJECT_REF, keychainItemPresent: true, ledgerStatus: "PASS",
      migrationArtifactsValid: true, deviceState: "device",
      apkMatches: true, backendStateVerified: false, activeAssignmentConflict: false,
      activeBootstrapCount: 0, globalAssignmentCount: 0, writerCount: 0,
      unexpectedActiveLease: false, packageAvailable: true })).toMatchObject({ status: "BLOCKED",
      blockers: expect.arrayContaining(["BACKEND_PREFLIGHT_MISSING"]) });
  });

  test("RP-A4 recognizes all exact semantic migrations as already deployed", () => {
    const remote = [...baseline, ...core.DEFERRED_MIGRATIONS.map((item: { name: string }, index: number) =>
      ({ version: `REMOTE-${index}`, name: item.name }))];
    expect(core.analyzeLedger({ remoteMigrations: remote, localMigrationFiles: localFiles }))
      .toMatchObject({ status: "PASS", states: [
        expect.objectContaining({ state: "DEPLOYED" }), expect.objectContaining({ state: "DEPLOYED" }),
        expect.objectContaining({ state: "DEPLOYED" }), expect.objectContaining({ state: "DEPLOYED" })] });
  });

  test("RP-A5 partial deployment stops for ledger reconciliation", () => {
    const remote = [...baseline, { version: "REMOTE", name: core.DEFERRED_MIGRATIONS[0].name }];
    expect(core.analyzeLedger({ remoteMigrations: remote, localMigrationFiles: localFiles }))
      .toMatchObject({ status: "BLOCKED", partialDeployment: true,
        reason: "PARTIAL_DEPLOYMENT_RECONCILIATION_REQUIRED" });
  });

  test("RP-A6 fixes the physical gate order", () => {
    expect(core.PHYSICAL_GATES).toEqual(["RUNTIME", "PATIENT_LOCATION_TRANSFER", "IMAGING",
      "INTERVENTION_READINESS", "ETT", "TRANSPORT", "PATIENT_COMPLETION"]);
    const resulted = { exerciseId: "EX", imagingInstanceId: "I", status: "RESULTED",
      report: "Massiivsele hemopneumotooraksile sobiv leid.", orderedAtSimulationTimeSec: 1,
      availableAtSimulationTimeSec: 421, releasedAtSimulationTimeSec: 422, resultCount: 1 };
    expect(core.evaluateCombinedEvidence({
      runtime: { freshExercise: true, canonicalCheckpoint: true, writerCount: 1,
        coldRestartRestored: true, runtimeUnavailable: false },
      patientLocationTransfer: { packageVersion: "1.0.4", patientId: "PT-PELVIC-001",
        initialLocation: "NARVA_HOSPITAL_OUTDOOR", chestInitialLocation: "NARVA_ED",
        actionId: "P01-MOVE-ED", commandId: "MOVE-1", commandType: "PATIENT_LOCATION_TRANSFER",
        visibleForPelvic: true, visibleForChest: false, commandCount: 1, materializationCount: 1,
        finalLocation: "NARVA_ED", evidenceId: "TL-INTERNAL-TRANSFER-MOVE-1", timelineEventCount: 1,
        checkpointRevisionBefore: 10, checkpointRevisionAfter: 11, restartFinalLocation: "NARVA_ED",
        actionExecutableAfterRestart: false, duplicateCount: 0, transportInstanceCountBefore: 0,
        transportInstanceCountAfter: 0, resourceReservationUnchanged: true, destinationUnchanged: true,
        transportClocksUnchanged: true },
      imaging: { packageDefinitions: [{ packageId: "russicaptor.narva-trauma", patientId: "PT-CHEST-001",
        definitionId: "P02-CXR", modality: "XR", title: "Rindkere röntgen", delaySeconds: 420 }],
        preThreshold: { simulationTimeSec: 420, availableAtSimulationTimeSec: 421, status: "PROCESSING",
          resultCount: 0, reportVisible: false }, resulted, afterRepeatedAdvance: { ...resulted },
        afterColdRestart: { ...resulted } },
      interventionReadiness: { pelvicBinderAvailable: true, chestDrainForPelvicAvailable: false,
        chestDrainAvailable: true, pelvicBinderForChestAvailable: false, validControlEnabledWhenReady: true,
        disabledWhenStale: true, reEnabledAfterConvergence: true },
      ett: { commandCount: 1, materializationCount: 1, canonicalActive: true,
        ventilationPrerequisitePreserved: true, restartRestored: true, duplicateCount: 0 },
      transport: { commandCount: 1, instanceCount: 1, acceptedTimeAnchored: true,
        restartSameInstance: true, transitionsExactlyOnce: true, vehicleReuseAtThreshold: true,
        patientAutoCompleted: false },
      patientCompletion: { commandCount: 1, materializationCount: 1, status: "Completed",
        assignmentRemovalCount: 1, pendingEventsCancellationCount: 1, timelineEventCount: 1,
        restartRestored: true, duplicateEffects: 0, exerciseCompleted: false },
    })).toMatchObject({ finalStatus: "PASS" });
  });

  test("RP-A7 foundational failure prevents later gates", () => {
    const sequence = core.evaluateGateSequence({ RUNTIME: "FAIL", IMAGING: "PASS" });
    expect(sequence.finalStatus).toBe("FAIL");
    expect(sequence.gates.slice(1).every((item: { status: string }) => item.status === "SKIPPED")).toBe(true);
  });

  test("RP-A8 cleanup revokes only assignments created by this session", () => {
    const plan = core.buildCleanupPlan({ assignments: [{ id: "CM", createdBySession: true },
      { id: "KEEP", createdBySession: false }], bootstrapAssignmentId: "CM" });
    expect(plan.revokeAssignmentIds).toEqual(["CM"]); expect(plan.preserveAssignmentIds).toEqual(["KEEP"]);
    expect(plan.steps.at(-1)).toBe("STOP_CAFFEINATE_LAST");
  });

  test("RP-A9 evidence schema contains no secret or full-checkpoint fields and is mode-0600 compatible", () => {
    const template = core.evidenceTemplate();
    expect(core.validateEvidenceSafety(template)).toMatchObject({ status: "PASS" });
    expect(core.validateEvidenceSafety({ password: "x" })).toMatchObject({ status: "FAIL" });
    const directory = mkdtempSync(join(tmpdir(), "release-prep-")); const file = join(directory, "evidence.json");
    writeFileSync(file, JSON.stringify(template), { mode: 0o600 }); chmodSync(file, 0o600);
    expect(readFileSync(file, "utf8")).not.toContain("fullCheckpoint");
  });

  test("RP-A10 single-device completion defers second-client gates rather than failing", () => {
    const template = core.evidenceTemplate();
    expect(template.secondClient.status).toBe("DEFERRED_SECOND_CLIENT");
    expect(template.secondClient.gates).toEqual(core.SECOND_CLIENT_GATES);
  });
});
