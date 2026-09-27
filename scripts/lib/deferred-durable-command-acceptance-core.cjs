const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const imaging = require("./narva-imaging-physical-acceptance-core.cjs");

const PROJECT_REF = "fimcsrivizpliiuoqopv";
const BASELINE_MIGRATION = "large_canonical_checkpoint_publication_timeout";
const DEFERRED_MIGRATIONS = Object.freeze([
  Object.freeze({ version: "20260925120000", name: "add_imaging_runtime_patient_command",
    file: "20260925120000_add_imaging_runtime_patient_command.sql", commandType: "IMAGING_ORDER",
    sha256: "53998d103eff56f36b6826fe3ede9a40298dd2c81def8dd07de299aa585a7bfd" }),
  Object.freeze({ version: "20260926120000", name: "add_endotracheal_intubation_runtime_patient_command",
    file: "20260926120000_add_endotracheal_intubation_runtime_patient_command.sql",
    commandType: "ENDOTRACHEAL_INTUBATION",
    sha256: "b1b411031e5bd3903ad3e5bbc71cdaf14b776cef5236bb02320395d609acdf39" }),
  Object.freeze({ version: "20260926143000", name: "add_patient_complete_runtime_patient_command",
    file: "20260926143000_add_patient_complete_runtime_patient_command.sql", commandType: "PATIENT_COMPLETE",
    sha256: "48553387691c2a3884375b29a7345ab20e8c66baa0d55fbb74b77780f416c371" }),
  Object.freeze({ version: "20260927120000", name: "add_patient_location_transfer_runtime_patient_command",
    file: "20260927120000_add_patient_location_transfer_runtime_patient_command.sql",
    commandType: "PATIENT_LOCATION_TRANSFER",
    sha256: "5bfc19e82927c8208cc2d9d21fb662acfb933ca260d9c3f00d3c6fb494a260a4" }),
]);
const PHYSICAL_GATES = Object.freeze(["RUNTIME", "IMAGING", "INTERVENTION_READINESS", "ETT",
  "TRANSPORT", "PATIENT_COMPLETION"]);
const SECOND_CLIENT_GATES = Object.freeze(["IMAGING_READER_CONVERGENCE", "ETT_READER_SUBMISSION",
  "TRANSPORT_READER_SUBMISSION", "PATIENT_COMPLETION_READER_SUBMISSION", "ACTIVE_CLIENT_TAKEOVER"]);

const sha256 = value => createHash("sha256").update(value).digest("hex");
const status = (value, code, detail) => Object.freeze({ status: value, code, detail });

function validateMigrationArtifacts(root) {
  const cumulative = [];
  return DEFERRED_MIGRATIONS.map(migration => {
    const filePath = path.join(root, "supabase/migrations", migration.file);
    if (!fs.existsSync(filePath)) return { ...migration, validation: status("BLOCKED", "MISSING", filePath) };
    const sql = fs.readFileSync(filePath, "utf8"); cumulative.push(migration.commandType);
    const forbidden = /\b(drop\s+table|truncate|delete\s+from|drop\s+policy|disable\s+row\s+level\s+security)\b/i.test(sql);
    const exactHash = sha256(sql) === migration.sha256;
    const cumulativeWhitelist = cumulative.every(type => sql.includes(`'${type}'`));
    const narrowObjects = /alter table public\.runtime_patient_commands/i.test(sql)
      && /create or replace function public\.submit_runtime_patient_command/i.test(sql)
      && !/create\s+table|alter\s+table\s+(?!public\.runtime_patient_commands)/i.test(sql);
    const validation = exactHash && cumulativeWhitelist && narrowObjects && !forbidden
      ? status("PASS", "STATIC_VALID", "cumulative whitelist and RPC validation only")
      : status("FAIL", "MIGRATION_STATIC_VALIDATION_FAILED",
        JSON.stringify({ exactHash, cumulativeWhitelist, narrowObjects, forbidden }));
    return { ...migration, actualSha256: sha256(sql), validation };
  });
}

function analyzeLedger({ remoteMigrations, localMigrationFiles }) {
  const remoteNames = new Set(remoteMigrations.map(item => item.name));
  const baselineRemote = remoteNames.has(BASELINE_MIGRATION);
  const states = DEFERRED_MIGRATIONS.map(item => ({ ...item,
    state: remoteNames.has(item.name) ? "DEPLOYED" : "PENDING" }));
  const baselineIndex = localMigrationFiles.findIndex(file => file.includes(BASELINE_MIGRATION));
  const tail = baselineIndex < 0 ? [] : localMigrationFiles.slice(baselineIndex + 1);
  const expectedFiles = new Set(DEFERRED_MIGRATIONS.map(item => item.file));
  const unrelatedPending = tail.filter(file => !expectedFiles.has(file)
    && !remoteNames.has(file.replace(/^\d+_/, "").replace(/\.sql$/, "")));
  const deployedCount = states.filter(item => item.state === "DEPLOYED").length;
  const partialDeployment = deployedCount > 0 && deployedCount < states.length;
  const versionDrift = remoteMigrations.some(remote => {
    const local = localMigrationFiles.find(file => file.endsWith(`_${remote.name}.sql`));
    return local && !local.startsWith(remote.version);
  });
  const safe = baselineRemote && unrelatedPending.length === 0 && !partialDeployment;
  return Object.freeze({ status: safe ? "PASS" : "BLOCKED", baselineRemote, states,
    unrelatedPending, partialDeployment, versionDrift,
    dbPushAllowed: false,
    deploymentPath: "SUPABASE_APPLY_MIGRATION_EXACT_ARTIFACT",
    reason: !baselineRemote ? "BASELINE_LEDGER_MISSING" : unrelatedPending.length
      ? "UNRELATED_PENDING_MIGRATIONS" : partialDeployment ? "PARTIAL_DEPLOYMENT_RECONCILIATION_REQUIRED"
        : versionDrift ? "DB_PUSH_DISABLED_DUE_TO_LEDGER_VERSION_DRIFT" : "EXACT_ARTIFACT_ONLY" });
}

function evaluatePrecheck(facts) {
  const blockers = [];
  if (facts.head !== facts.expectedHead) blockers.push("HEAD_MISMATCH");
  if (!facts.clean) blockers.push("DIRTY_TREE");
  if (facts.projectRef !== PROJECT_REF) blockers.push("PROJECT_REF_MISMATCH");
  if (!facts.keychainItemPresent) blockers.push("KEYCHAIN_ITEM_MISSING");
  if (facts.ledgerStatus !== "PASS") blockers.push("MIGRATION_LEDGER_UNSAFE");
  if (facts.deviceState !== "device") blockers.push("DEVICE_UNAVAILABLE");
  if (!facts.apkMatches) blockers.push("APK_IDENTITY_MISMATCH");
  if (!facts.backendStateVerified) blockers.push("BACKEND_PREFLIGHT_MISSING");
  if (facts.activeAssignmentConflict) blockers.push("ACTIVE_ASSIGNMENT_CONFLICT");
  if (facts.activeBootstrapCount !== 0 || facts.globalAssignmentCount !== 0) blockers.push("UNSAFE_AUTHORIZATION_STATE");
  if (facts.writerCount > 1) blockers.push("MULTIPLE_WRITERS");
  if (facts.unexpectedActiveLease) blockers.push("UNEXPECTED_ACTIVE_LEASE");
  if (!facts.packageAvailable) blockers.push("NARVA_PACKAGE_MISSING");
  return Object.freeze({ status: blockers.length ? "BLOCKED" : "PASS", blockers,
    mutationAllowed: blockers.length === 0 });
}

function evaluateGateSequence(results) {
  const evaluated = []; let stopped = false;
  for (const gate of PHYSICAL_GATES) {
    const supplied = results[gate] ?? "PENDING";
    const gateStatus = stopped ? "SKIPPED" : supplied;
    evaluated.push(Object.freeze({ gate, status: gateStatus }));
    if (gateStatus === "FAIL" || gateStatus === "BLOCKED") stopped = true;
  }
  return Object.freeze({ gates: evaluated, stopped,
    finalStatus: evaluated.some(item => item.status === "FAIL") ? "FAIL"
      : evaluated.some(item => item.status === "BLOCKED") ? "BLOCKED"
        : evaluated.every(item => item.status === "PASS") ? "PASS" : "PENDING" });
}

function assertRuntimeGate(value) {
  return value.freshExercise === true && value.canonicalCheckpoint === true && value.writerCount === 1
    && value.coldRestartRestored === true && value.runtimeUnavailable !== true ? "PASS" : "FAIL";
}

function assertInterventionReadinessGate(value) {
  return value.pelvicBinderAvailable === true && value.chestDrainForPelvicAvailable === false
    && value.chestDrainAvailable === true && value.pelvicBinderForChestAvailable === false
    && value.validControlEnabledWhenReady === true && value.disabledWhenStale === true
    && value.reEnabledAfterConvergence === true ? "PASS" : "FAIL";
}

function assertEttGate(value) {
  return value.commandCount === 1 && value.materializationCount === 1 && value.canonicalActive === true
    && value.ventilationPrerequisitePreserved === true && value.restartRestored === true
    && value.duplicateCount === 0 ? "PASS" : "FAIL";
}

function assertTransportGate(value) {
  return value.commandCount === 1 && value.instanceCount === 1 && value.acceptedTimeAnchored === true
    && value.restartSameInstance === true && value.transitionsExactlyOnce === true
    && value.vehicleReuseAtThreshold === true && value.patientAutoCompleted === false ? "PASS" : "FAIL";
}

function assertPatientCompletionGate(value) {
  return value.commandCount === 1 && value.materializationCount === 1 && value.status === "Completed"
    && value.assignmentRemovalCount === 1 && value.pendingEventsCancellationCount === 1
    && value.timelineEventCount === 1 && value.restartRestored === true && value.duplicateEffects === 0
    && value.exerciseCompleted === false ? "PASS" : "FAIL";
}

function evaluateCombinedEvidence(evidence) {
  const imagingAssertions = [imaging.assertNarvaPackageContent(evidence.imaging?.packageDefinitions ?? []),
    imaging.assertPreThreshold(evidence.imaging?.preThreshold ?? {}),
    imaging.assertThresholdRelease(evidence.imaging?.resulted ?? {}),
    imaging.assertRepeatedAdvancement(evidence.imaging?.resulted ?? {},
      evidence.imaging?.afterRepeatedAdvance ?? {}),
    imaging.assertRestartEvidence(evidence.imaging?.resulted ?? {}, evidence.imaging?.afterColdRestart ?? {})];
  return evaluateGateSequence({ RUNTIME: assertRuntimeGate(evidence.runtime ?? {}),
    IMAGING: imaging.finalClassification(imagingAssertions),
    INTERVENTION_READINESS: assertInterventionReadinessGate(evidence.interventionReadiness ?? {}),
    ETT: assertEttGate(evidence.ett ?? {}), TRANSPORT: assertTransportGate(evidence.transport ?? {}),
    PATIENT_COMPLETION: assertPatientCompletionGate(evidence.patientCompletion ?? {}) });
}

function buildCleanupPlan({ assignments, bootstrapAssignmentId }) {
  const created = assignments.filter(item => item.createdBySession);
  return Object.freeze({ revokeAssignmentIds: created.map(item => item.id),
    revokeBootstrapId: created.some(item => item.id === bootstrapAssignmentId) ? bootstrapAssignmentId : undefined,
    preserveAssignmentIds: assignments.filter(item => !item.createdBySession).map(item => item.id),
    steps: Object.freeze(["STOP_COMMANDS", "COLLECT_FINAL_EVIDENCE", "REVOKE_CM", "REVOKE_EXCON",
      "REVOKE_BOOTSTRAP", "VERIFY_ASSIGNMENTS", "STOP_APP_RUNTIME", "VERIFY_LEASE_RELEASE",
      "RESTORE_DEVICE_SETTINGS", "STOP_CAFFEINATE_LAST"]) });
}

function evidenceTemplate() {
  return Object.freeze({ schemaVersion: 1, secretMaterialRecorded: false, projectRef: PROJECT_REF,
    repository: { head: "", clean: false }, migrationLedger: { before: [], after: [], hashes: {} },
    apk: { versionCode: "", sha256: "" }, exercise: { exerciseId: "", runtimeId: "", writerLeaseId: "",
      assignmentIds: [], checkpointRevisions: [] }, commands: [], imaging: {}, ett: {}, transport: {},
    runtime: {}, interventionReadiness: {}, patientCompletion: {}, duplicates: {}, restarts: [], cleanup: {}, secondClient: {
      status: "DEFERRED_SECOND_CLIENT", gates: SECOND_CLIENT_GATES } });
}

function validateEvidenceSafety(value) {
  const serialized = JSON.stringify(value);
  const forbidden = /"(?:secret|password|token|credential|serviceRole|fullCheckpoint)"\s*:/i;
  return forbidden.test(serialized) ? status("FAIL", "SECRET_OR_FULL_CHECKPOINT_FIELD", "forbidden evidence key")
    : status("PASS", "EVIDENCE_SAFE", "metadata only");
}

module.exports = { PROJECT_REF, BASELINE_MIGRATION, DEFERRED_MIGRATIONS, PHYSICAL_GATES,
  SECOND_CLIENT_GATES, validateMigrationArtifacts, analyzeLedger, evaluatePrecheck,
  evaluateGateSequence, evaluateCombinedEvidence, buildCleanupPlan, evidenceTemplate, validateEvidenceSafety };
