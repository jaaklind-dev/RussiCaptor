import { resolve } from "node:path";
const core = require("../lib/deferred-durable-command-acceptance-core.cjs");

const root = resolve(__dirname, "../..");
const localFiles = ["20260918123000_large_canonical_checkpoint_publication_timeout.sql",
  ...core.DEFERRED_MIGRATIONS.map((item: { file: string }) => item.file)];
const baseline = [{ version: "REMOTE", name: core.BASELINE_MIGRATION }];
const transfer = { packageVersion: "1.0.4", patientId: "PT-PELVIC-001",
  initialLocation: "NARVA_HOSPITAL_OUTDOOR", chestInitialLocation: "NARVA_ED",
  actionId: "P01-MOVE-ED", commandId: "MOVE-1", commandType: "PATIENT_LOCATION_TRANSFER",
  visibleForPelvic: true, visibleForChest: false, commandCount: 1, materializationCount: 1,
  finalLocation: "NARVA_ED", evidenceId: "TL-INTERNAL-TRANSFER-MOVE-1", timelineEventCount: 1,
  checkpointRevisionBefore: 20, checkpointRevisionAfter: 21, restartFinalLocation: "NARVA_ED",
  actionExecutableAfterRestart: false, duplicateCount: 0, transportInstanceCountBefore: 0,
  transportInstanceCountAfter: 0, resourceReservationUnchanged: true, destinationUnchanged: true,
  transportClocksUnchanged: true };

describe("RELEASE-PREP-02 / RP2-A1..A10", () => {
  test("RP2-A1/A2 inventory and hash exactly four deferred migrations", () => {
    expect(core.DEFERRED_MIGRATIONS.map((item: { file: string; commandType: string }) =>
      [item.file, item.commandType])).toEqual([
      ["20260925120000_add_imaging_runtime_patient_command.sql", "IMAGING_ORDER"],
      ["20260926120000_add_endotracheal_intubation_runtime_patient_command.sql", "ENDOTRACHEAL_INTUBATION"],
      ["20260926143000_add_patient_complete_runtime_patient_command.sql", "PATIENT_COMPLETE"],
      ["20260927120000_add_patient_location_transfer_runtime_patient_command.sql", "PATIENT_LOCATION_TRANSFER"],
    ]);
    const artifacts = core.validateMigrationArtifacts(root);
    expect(artifacts).toHaveLength(4);
    expect(artifacts.every((item: any) => item.actualSha256 === item.sha256 &&
      item.validation.status === "PASS")).toBe(true);
  });

  test("RP2-A3/A4 enforce cumulative order and stop on unrelated pending migration", () => {
    expect(core.DEFERRED_MIGRATIONS.map((item: { version: string }) => item.version))
      .toEqual(["20260925120000", "20260926120000", "20260926143000", "20260927120000"]);
    expect(core.analyzeLedger({ remoteMigrations: baseline,
      localMigrationFiles: [...localFiles, "20260927090000_unrelated.sql"].sort() }))
      .toMatchObject({ status: "BLOCKED", reason: "UNRELATED_PENDING_MIGRATIONS", dbPushAllowed: false });
  });

  test("RP2-A5 puts P01 transfer before all later location-changing workflows", () => {
    expect(core.PHYSICAL_GATES).toEqual(["RUNTIME", "PATIENT_LOCATION_TRANSFER", "IMAGING",
      "INTERVENTION_READINESS", "ETT", "TRANSPORT", "PATIENT_COMPLETION"]);
  });

  test("RP2-A6/A8 evidence is bounded and explicitly proves transport isolation", () => {
    const value = core.evidenceTemplate().patientLocationTransfer;
    expect(Object.keys(value)).toEqual(expect.arrayContaining(["packageVersion", "patientId", "initialLocation",
      "actionId", "commandId", "materializationCount", "finalLocation", "evidenceId",
      "checkpointRevisionBefore", "checkpointRevisionAfter", "restartFinalLocation", "duplicateCount",
      "transportInstanceCountBefore", "transportInstanceCountAfter", "resourceReservationUnchanged",
      "destinationUnchanged", "transportClocksUnchanged"]));
    expect(core.validateEvidenceSafety(core.evidenceTemplate())).toMatchObject({ status: "PASS" });
  });

  test("RP2-A7 transfer failure prevents Imaging and every later gate", () => {
    const sequence = core.evaluateGateSequence({ RUNTIME: "PASS", PATIENT_LOCATION_TRANSFER: "FAIL",
      IMAGING: "PASS", TRANSPORT: "PASS" });
    expect(sequence.finalStatus).toBe("FAIL");
    expect(sequence.gates.slice(2).every((item: { status: string }) => item.status === "SKIPPED")).toBe(true);
  });

  test("RP2-A8 rejects transfer evidence that mutates transport state", () => {
    const base = { runtime: { freshExercise: true, canonicalCheckpoint: true, writerCount: 1,
      coldRestartRestored: true, runtimeUnavailable: false }, imaging: {}, interventionReadiness: {}, ett: {}, transport: {},
      patientCompletion: {}, patientLocationTransfer: transfer };
    const valid = core.evaluateCombinedEvidence(base);
    expect(valid.gates.find((item: any) => item.gate === "PATIENT_LOCATION_TRANSFER")?.status).toBe("PASS");
    const invalid = core.evaluateCombinedEvidence({ ...base, patientLocationTransfer: {
      ...transfer, transportInstanceCountAfter: 1 } });
    expect(invalid.gates.find((item: any) => item.gate === "PATIENT_LOCATION_TRANSFER")?.status).toBe("FAIL");
  });

  test("RP2-A9 keeps all two-client checks deferred rather than failed", () => {
    const second = core.evidenceTemplate().secondClient;
    expect(second.status).toBe("DEFERRED_SECOND_CLIENT");
    expect(second.gates).toContain("PATIENT_LOCATION_TRANSFER_READER_SUBMISSION");
  });

  test("RP2-A10 cleanup revokes only session-created assignments", () => {
    const plan = core.buildCleanupPlan({ assignments: [{ id: "SESSION-CM", createdBySession: true },
      { id: "EXISTING-EXCON", createdBySession: false }], bootstrapAssignmentId: "BOOTSTRAP" });
    expect(plan.revokeAssignmentIds).toEqual(["SESSION-CM"]);
    expect(plan.preserveAssignmentIds).toEqual(["EXISTING-EXCON"]);
  });
});
