const TARGET_MIGRATION = Object.freeze({
  version: "20260925120000",
  file: "20260925120000_add_imaging_runtime_patient_command.sql",
});

const EXPECTED_NARVA_IMAGING = Object.freeze({
  packageId: "russicaptor.narva-trauma",
  packageVersion: "1.0.1",
  patientId: "PT-CHEST-001",
  emptyPatientId: "PT-PELVIC-001",
  definitionId: "P02-CXR",
  orderId: "P02-ORD-CXR",
  modality: "XR",
  title: "Rindkere röntgen",
  report: "Massiivsele hemopneumotooraksile sobiv leid.",
  delaySeconds: 420,
});

const fail = (code, detail) => ({ status: "FAIL", code, detail });
const pass = (detail) => ({ status: "PASS", detail });
const blocked = (code, detail) => ({ status: "BLOCKED", code, detail });

function evaluatePrecheck(facts) {
  const checks = [
    facts.head === facts.expectedHead ? pass("expected HEAD") : blocked("HEAD_MISMATCH", `${facts.head} != ${facts.expectedHead}`),
    facts.clean === true ? pass("working tree clean") : blocked("DIRTY_TREE", "working tree is not clean"),
    facts.deviceState === "device" ? pass("Android device ready") : blocked("DEVICE_UNAVAILABLE", facts.deviceState ?? "absent"),
    facts.apkMatches === true ? pass("APK identity verified") : blocked("APK_MISMATCH", "expected APK/version not verified"),
    facts.supabaseProjectRef === "fimcsrivizpliiuoqopv" ? pass("Supabase project verified") : blocked("PROJECT_REF_MISMATCH", facts.supabaseProjectRef ?? "missing"),
    facts.keychainCredentialAvailable === true ? pass("approved Keychain credential available") : blocked("KEYCHAIN_CREDENTIAL_UNAVAILABLE", "exact item unavailable"),
    facts.packageAvailable === true ? pass("Narva trauma package available") : blocked("PACKAGE_UNAVAILABLE", "required package missing"),
    facts.assignmentConflict === false ? pass("no assignment conflict") : blocked("ACTIVE_ASSIGNMENT_CONFLICT", "conflicting scoped assignment"),
    facts.unexpectedActiveLease === false ? pass("no unexpected writer lease") : blocked("UNEXPECTED_ACTIVE_LEASE", "target exercise already has an unexpected lease"),
  ];
  return { status: checks.some(item => item.status === "BLOCKED") ? "BLOCKED" : "PASS", checks, mutationAllowed: checks.every(item => item.status === "PASS") };
}

function inspectMigrationState({ localVersions, deployedVersions, pendingLocalVersions }) {
  if (!localVersions.includes(TARGET_MIGRATION.version)) return blocked("MIGRATION_ARTIFACT_MISSING", TARGET_MIGRATION.file);
  if (deployedVersions.includes(TARGET_MIGRATION.version)) return { ...pass("already deployed"), state: "DEPLOYED", deploy: false };
  const unrelated = pendingLocalVersions.filter(version => version !== TARGET_MIGRATION.version);
  if (unrelated.length) return blocked("UNRELATED_PENDING_MIGRATIONS", unrelated.join(","));
  return { ...pass("expected migration is the sole pending migration"), state: "MISSING", deploy: true,
    command: "npx supabase db push --linked", expectedVersion: TARGET_MIGRATION.version };
}

function resolveScopedAssignment({ assignments, userId, role, exerciseId }) {
  const active = assignments.filter(item => item.status === "ACTIVE" && item.userId === userId && item.role === role);
  const exact = active.find(item => item.scopeType === "EXERCISE" && item.scopeId === exerciseId);
  if (exact) return { action: "REUSE", assignmentId: exact.id, createdByHarness: false };
  if (active.length) return { action: "CONFLICT", code: "ACTIVE_ASSIGNMENT_CONFLICT", assignmentIds: active.map(item => item.id) };
  return { action: "GRANT", rpc: "trusted_admin_grant_exercise_role", createdByHarness: true,
    parameters: { userId, role, scopeType: "EXERCISE", scopeId: exerciseId } };
}

function assertNarvaPackageContent(definitions) {
  const chest = definitions.filter(item => item.patientId === EXPECTED_NARVA_IMAGING.patientId);
  const pelvic = definitions.filter(item => item.patientId === EXPECTED_NARVA_IMAGING.emptyPatientId);
  const leakage = definitions.filter(item => item.patientId === "PT-001" || /^P(?:09|11|12)$/.test(item.patientId)
    || item.packageId === "russicaptor.narva-iro-evacuation");
  if (chest.length !== 1) return fail("P02_DEFINITION_COUNT", chest.length);
  const item = chest[0];
  for (const key of ["definitionId", "modality", "title", "delaySeconds"]) {
    if (item[key] !== EXPECTED_NARVA_IMAGING[key]) return fail(`P02_${key.toUpperCase()}_MISMATCH`, item[key]);
  }
  if (pelvic.length) return fail("P01_IMAGING_NOT_EMPTY", pelvic.length);
  if (leakage.length) return fail("IMAGING_CONTENT_LEAKAGE", leakage.map(item => item.definitionId));
  return pass("exact approved P02 definition; P01 and unrelated packages empty");
}

function assertPreThreshold(instance) {
  if (!(instance.simulationTimeSec < instance.availableAtSimulationTimeSec)) return fail("NOT_PRE_THRESHOLD", instance);
  if (instance.status === "RESULTED" || instance.resultCount !== 0 || instance.reportVisible === true) {
    return fail("EARLY_RESULT_RELEASE", instance);
  }
  return pass("report remains hidden before availableAt");
}

function assertThresholdRelease(instance) {
  if (instance.status !== "RESULTED") return fail("RESULT_NOT_RELEASED", instance.status);
  if (instance.resultCount !== 1) return fail("RESULT_COUNT", instance.resultCount);
  if (instance.report !== EXPECTED_NARVA_IMAGING.report) return fail("REPORT_MISMATCH", instance.report);
  if (!Number.isFinite(instance.releasedAtSimulationTimeSec)
    || instance.releasedAtSimulationTimeSec < instance.availableAtSimulationTimeSec) {
    return fail("INVALID_RELEASE_TIME", instance.releasedAtSimulationTimeSec);
  }
  return pass("approved report released exactly once at/after threshold");
}

function assertRepeatedAdvancement(before, after) {
  for (const key of ["imagingInstanceId", "resultCount", "report", "releasedAtSimulationTimeSec"]) {
    if (before[key] !== after[key]) return fail("RESULT_MUTATED_AFTER_RELEASE", key);
  }
  return pass("result remained immutable and singular");
}

function assertRestartEvidence(before, after) {
  for (const key of ["exerciseId", "imagingInstanceId", "status", "report", "orderedAtSimulationTimeSec",
    "availableAtSimulationTimeSec", "releasedAtSimulationTimeSec", "resultCount"]) {
    if (before[key] !== after[key]) return fail("RESTART_STATE_MISMATCH", key);
  }
  if (after.runtimeUnavailable === true) return fail("RUNTIME_UNAVAILABLE_AFTER_RESTART", true);
  return pass("restart restored the same canonical resulted instance");
}

function assertRepeatStudy(first, second) {
  if (second.uiExposed === false && second.productionCommandAvailable === false) {
    return { status: "BLOCKED", code: "REPEAT_UI_NOT_EXPOSED", detail: "no supported production repeat route" };
  }
  if (first.imagingInstanceId === second.imagingInstanceId || first.commandId === second.commandId) {
    return fail("REPEAT_IDENTITY_NOT_DISTINCT", second.imagingInstanceId);
  }
  if (second.repeatOrdinal !== first.repeatOrdinal + 1) return fail("REPEAT_ORDINAL_INVALID", second.repeatOrdinal);
  return pass("repeat uses a distinct command and lifecycle instance");
}

function buildCleanupPlan({ createdAssignments, bootstrap, unrelatedAssignments }) {
  return {
    revokeAssignmentIds: createdAssignments.filter(item => item.createdByHarness).map(item => item.id),
    revokeBootstrapId: bootstrap?.createdByHarness ? bootstrap.id : undefined,
    preserveAssignmentIds: unrelatedAssignments.map(item => item.id),
    orderedSteps: ["STOP_COMMANDS", "COLLECT_FINAL_EVIDENCE", "REVOKE_CM", "REVOKE_EXCON",
      "REVOKE_BOOTSTRAP", "VERIFY_ASSIGNMENTS", "STOP_APP_RUNTIME", "VERIFY_LEASE_RELEASE",
      "RESTORE_DEVICE_SETTINGS", "STOP_CAFFEINATE"],
  };
}

function finalClassification(assertions) {
  if (assertions.some(item => item.status === "FAIL")) return "FAIL";
  if (assertions.some(item => item.status === "BLOCKED")) return "BLOCKED";
  return "PASS";
}

module.exports = {
  TARGET_MIGRATION,
  EXPECTED_NARVA_IMAGING,
  evaluatePrecheck,
  inspectMigrationState,
  resolveScopedAssignment,
  assertNarvaPackageContent,
  assertPreThreshold,
  assertThresholdRelease,
  assertRepeatedAdvancement,
  assertRestartEvidence,
  assertRepeatStudy,
  buildCleanupPlan,
  finalClassification,
};
