const {
  EXPECTED_NARVA_IMAGING, TARGET_MIGRATION, assertNarvaPackageContent, assertPreThreshold,
  assertRepeatedAdvancement, assertRestartEvidence, assertThresholdRelease, buildCleanupPlan,
  evaluatePrecheck, inspectMigrationState, resolveScopedAssignment,
} = require("../lib/narva-imaging-physical-acceptance-core.cjs");

const validPrecheck = { head: "HEAD", expectedHead: "HEAD", clean: true, deviceState: "device", apkMatches: true,
  supabaseProjectRef: "fimcsrivizpliiuoqopv", keychainCredentialAvailable: true, packageAvailable: true,
  assignmentConflict: false, unexpectedActiveLease: false };
const resulted = { exerciseId: "EX", imagingInstanceId: "IMAGING:CMD", status: "RESULTED",
  orderedAtSimulationTimeSec: 100, availableAtSimulationTimeSec: 520, simulationTimeSec: 521,
  releasedAtSimulationTimeSec: 521, resultCount: 1, report: EXPECTED_NARVA_IMAGING.report };

describe("Narva Imaging physical acceptance preparation", () => {
  test("P-A1 blocks before mutation when any precheck fails", () => {
    const value = evaluatePrecheck({ ...validPrecheck, deviceState: "absent" });
    expect(value).toMatchObject({ status: "BLOCKED", mutationAllowed: false });
  });

  test("P-A2 recognizes an already-deployed exact migration", () => {
    expect(inspectMigrationState({ localVersions: [TARGET_MIGRATION.version], deployedVersions: [TARGET_MIGRATION.version],
      pendingLocalVersions: [] })).toMatchObject({ status: "PASS", state: "DEPLOYED", deploy: false });
  });

  test("P-A3 detects missing migration without deploying it and blocks unrelated pending migrations", () => {
    expect(inspectMigrationState({ localVersions: [TARGET_MIGRATION.version], deployedVersions: [],
      pendingLocalVersions: [TARGET_MIGRATION.version] })).toMatchObject({ status: "PASS", state: "MISSING", deploy: true,
      command: "npx supabase db push --linked" });
    expect(inspectMigrationState({ localVersions: [TARGET_MIGRATION.version], deployedVersions: [],
      pendingLocalVersions: ["OTHER", TARGET_MIGRATION.version] })).toMatchObject({ status: "BLOCKED", code: "UNRELATED_PENDING_MIGRATIONS" });
  });

  test("P-A4 reuses an exact assignment and fails closed on an active conflict", () => {
    const exact = { id: "A", userId: "U", role: "CM", scopeType: "EXERCISE", scopeId: "EX", status: "ACTIVE" };
    expect(resolveScopedAssignment({ assignments: [exact], userId: "U", role: "CM", exerciseId: "EX" }))
      .toEqual({ action: "REUSE", assignmentId: "A", createdByHarness: false });
    expect(resolveScopedAssignment({ assignments: [{ ...exact, scopeId: "OTHER" }], userId: "U", role: "CM", exerciseId: "EX" }))
      .toMatchObject({ action: "CONFLICT", code: "ACTIVE_ASSIGNMENT_CONFLICT" });
  });

  test("P-A5 accepts exactly the approved P02 definition and empty P01 without leakage", () => {
    expect(assertNarvaPackageContent([{ packageId: EXPECTED_NARVA_IMAGING.packageId,
      patientId: EXPECTED_NARVA_IMAGING.patientId, definitionId: EXPECTED_NARVA_IMAGING.definitionId,
      modality: "XR", title: EXPECTED_NARVA_IMAGING.title, delaySeconds: 420 }])).toMatchObject({ status: "PASS" });
  });

  test("P-A6 rejects early result exposure", () => {
    expect(assertPreThreshold({ simulationTimeSec: 519, availableAtSimulationTimeSec: 520,
      status: "PROCESSING", resultCount: 0, reportVisible: false })).toMatchObject({ status: "PASS" });
    expect(assertPreThreshold({ simulationTimeSec: 519, availableAtSimulationTimeSec: 520,
      status: "RESULTED", resultCount: 1, reportVisible: true })).toMatchObject({ status: "FAIL", code: "EARLY_RESULT_RELEASE" });
  });

  test("P-A7 accepts one approved result at/after threshold", () => {
    expect(assertThresholdRelease(resulted)).toMatchObject({ status: "PASS" });
  });

  test("P-A8 detects a duplicate or mutated release", () => {
    expect(assertThresholdRelease({ ...resulted, resultCount: 2 })).toMatchObject({ status: "FAIL", code: "RESULT_COUNT" });
    expect(assertRepeatedAdvancement(resulted, { ...resulted, releasedAtSimulationTimeSec: 522 }))
      .toMatchObject({ status: "FAIL", code: "RESULT_MUTATED_AFTER_RELEASE" });
  });

  test("P-A9 compares complete restart evidence", () => {
    expect(assertRestartEvidence(resulted, { ...resulted })).toMatchObject({ status: "PASS" });
    expect(assertRestartEvidence(resulted, { ...resulted, imagingInstanceId: "OTHER" }))
      .toMatchObject({ status: "FAIL", code: "RESTART_STATE_MISMATCH" });
  });

  test("P-A10 cleanup revokes only harness-created assignments and stops caffeinate last", () => {
    const plan = buildCleanupPlan({ createdAssignments: [{ id: "A", createdByHarness: true },
      { id: "REUSED", createdByHarness: false }], bootstrap: { id: "B", createdByHarness: true },
      unrelatedAssignments: [{ id: "KEEP" }] });
    expect(plan.revokeAssignmentIds).toEqual(["A"]);
    expect(plan.preserveAssignmentIds).toEqual(["KEEP"]);
    expect(plan.orderedSteps.at(-1)).toBe("STOP_CAFFEINATE");
  });
});
