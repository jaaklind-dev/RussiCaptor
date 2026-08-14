import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import { RuntimePersistenceError, type RuntimeProvenance } from "@/models/PersistedRuntimeState";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { PELVIC_INJURY_EXERCISE_PACKAGE, PLEURAL_INJURY_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import { CARDIAC_ARREST_REFERENCE_FIXTURE } from "@/services/golden/CardiacArrestReferenceFixture";
import { canonicalRuntimePersistenceService, isCapturedCanonicalRuntimeArtifact, moduleCompositionHash } from "@/services/runtime/persistence/CanonicalRuntimePersistenceService";

const tick = (patientId: string, step: number): GoldenInputEvent => ({
  sequenceId: "WP44A", step, offsetSec: step * 60, eventType: "ENGINE_TICK", actor: "ENGINE",
  target: patientId, eventId: `WP44A-${patientId}-${step}`, result: "SUCCESS", payload: { tickMin: 1 },
});

function fixture(pkg: ExercisePackage): GoldenFixture {
  return structuredClone(packagePatientDatasetRegistry.resolve(pkg.patientDatasetId).patients[0].runtimeFixture!);
}

function provenance(pkg: ExercisePackage, patientId: string): RuntimeProvenance {
  return { exerciseId: `EX-${patientId}`, patientId, packageId: pkg.packageId, packageVersion: pkg.packageVersion,
    packageHash: pkg.packageHash, definitionHash: pkg.manifest.definitionHash,
    moduleCompositionHash: moduleCompositionHash(pkg.definition.clinicalModuleComposition?.modules ?? pkg.requiredClinicalModules ?? []) };
}

function equivalence(pkg: ExercisePackage): void {
  const source = fixture(pkg); const patientId = source.patientId!; const identity = provenance(pkg, patientId);
  const continuous = new ClinicalScenarioEngine(); continuous.reset(source);
  continuous.advanceTo(60); continuous.dispatch(tick(patientId, 1));
  const artifact = canonicalRuntimePersistenceService.capture(continuous, identity);
  continuous.advanceTo(120); continuous.dispatch(tick(patientId, 2));

  const resumed = new ClinicalScenarioEngine(); canonicalRuntimePersistenceService.rehydrate(resumed, artifact, identity);
  resumed.advanceTo(120); resumed.dispatch(tick(patientId, 2));
  expect({ state: resumed.getRuntimeState(), processes: resumed.getPatientProcesses(), events: resumed.getEventLog(), hashes: resumed.getHashes() })
    .toEqual({ state: continuous.getRuntimeState(), processes: continuous.getPatientProcesses(), events: continuous.getEventLog(), hashes: continuous.getHashes() });
}

describe("WP-44A canonical runtime persistence", () => {
  test.each([
    ["Pelvic", PELVIC_INJURY_EXERCISE_PACKAGE, undefined],
    ["Pleural", PLEURAL_INJURY_EXERCISE_PACKAGE, undefined],
    ["Cardiac", PLEURAL_INJURY_EXERCISE_PACKAGE, CARDIAC_ARREST_REFERENCE_FIXTURE],
  ] as const)("%s synchronous and yielding artifacts are byte/hash equivalent", async (_name, pkg, suppliedFixture) => {
    const sourceFixture = structuredClone(suppliedFixture ?? fixture(pkg));
    const patientId = sourceFixture.patientId!;
    const identity = provenance(pkg, patientId);
    const source = new ClinicalScenarioEngine(); source.reset(sourceFixture); source.advanceTo(60);
    const synchronous = canonicalRuntimePersistenceService.capture(source, identity);
    const yielding = await canonicalRuntimePersistenceService.captureAsync(source, identity, async () => Promise.resolve());
    expect(yielding).toEqual(synchronous);
    expect(yielding.payloadHash).toBe(synchronous.payloadHash);
  });

  test("pelvic continuous and rehydrated execution are bit-identical", () => equivalence(PELVIC_INJURY_EXERCISE_PACKAGE));
  test("pleural continuous and rehydrated execution are bit-identical", () => equivalence(PLEURAL_INJURY_EXERCISE_PACKAGE));

  test("cardiac process and intervention idempotency survive rehydration", () => {
    const patientId = CARDIAC_ARREST_REFERENCE_FIXTURE.patientId!;
    const pkg = PLEURAL_INJURY_EXERCISE_PACKAGE;
    const identity = provenance(pkg, patientId);
    const source = new ClinicalScenarioEngine(); source.reset(structuredClone(CARDIAC_ARREST_REFERENCE_FIXTURE));
    source.advanceTo(30); source.dispatch({ ...tick(patientId, 1), offsetSec: 30, payload: { tickMin: 0.5 } });
    source.startClinicalIntervention({ sourceInterventionId: "CPR-PERSISTED", definitionId: "START_CPR", patientId });
    const artifact = canonicalRuntimePersistenceService.capture(source, identity);
    const resumed = new ClinicalScenarioEngine(); canonicalRuntimePersistenceService.rehydrate(resumed, artifact, identity);
    expect(resumed.startClinicalIntervention({ sourceInterventionId: "CPR-PERSISTED", definitionId: "START_CPR", patientId }))
      .toEqual(source.startClinicalIntervention({ sourceInterventionId: "CPR-PERSISTED", definitionId: "START_CPR", patientId }));
    expect(resumed.getEventLog()).toEqual(source.getEventLog());
  });

  test("fails closed on corruption and provenance mismatch without publishing a bootstrap", () => {
    const pkg = PELVIC_INJURY_EXERCISE_PACKAGE; const sourceFixture = fixture(pkg); const identity = provenance(pkg, sourceFixture.patientId!);
    const source = new ClinicalScenarioEngine(); source.reset(sourceFixture);
    const artifact = canonicalRuntimePersistenceService.capture(source, identity);
    const target = new ClinicalScenarioEngine();
    expect(() => canonicalRuntimePersistenceService.rehydrate(target, { ...artifact, payloadHash: "corrupt" }, identity))
      .toThrow(expect.objectContaining<Partial<RuntimePersistenceError>>({ code: "PAYLOAD_HASH_MISMATCH" }));
    expect(() => target.getRuntimeState()).toThrow();
    expect(() => canonicalRuntimePersistenceService.rehydrate(target, artifact, { ...identity, exerciseId: "OTHER" }))
      .toThrow(expect.objectContaining<Partial<RuntimePersistenceError>>({ code: "EXERCISE_IDENTITY_MISMATCH" }));
  });

  test("fails closed when capture metadata and canonical payload clocks disagree", () => {
    const pkg = PELVIC_INJURY_EXERCISE_PACKAGE; const sourceFixture = fixture(pkg); const identity = provenance(pkg, sourceFixture.patientId!);
    const source = new ClinicalScenarioEngine(); source.reset(sourceFixture); source.advanceTo(60);
    const artifact = canonicalRuntimePersistenceService.capture(source, identity);
    const target = new ClinicalScenarioEngine();
    expect(() => canonicalRuntimePersistenceService.rehydrate(target, {
      ...artifact,
      capturedAtSimulationTimeSec: artifact.capturedAtSimulationTimeSec + 1,
    }, identity)).toThrow(expect.objectContaining<Partial<RuntimePersistenceError>>({ code: "RUNTIME_INVARIANT_VIOLATION" }));
    expect(() => target.getRuntimeState()).toThrow();
  });

  test.each([
    [PELVIC_INJURY_EXERCISE_PACKAGE, "PB-CONTINUITY", "PB-1", "PELVIC_BINDER_APPLICATION", "PelvicBinderApplied"],
    [PLEURAL_INJURY_EXERCISE_PACKAGE, "CD-CONTINUITY", "CD-1", "CHEST_DRAIN_INSERTION", "ClinicalEffectApplied"],
  ] as const)("preserves %s Clinical Effect and intervention idempotency", (pkg, interventionId, resourceId, definitionId, effectEventType) => {
    const sourceFixture = fixture(pkg); const patientId = sourceFixture.patientId!; const identity = provenance(pkg, patientId);
    const source = new ClinicalScenarioEngine(); source.reset(sourceFixture);
    source.scheduleIntervention({ interventionId, patientId, resourceId, action: "APPLY", timestamp: 60, definitionId, parameters: {} });
    source.advanceTo(60); source.dispatch(tick(patientId, 1));
    const artifact = canonicalRuntimePersistenceService.capture(source, identity);
    const resumed = new ClinicalScenarioEngine(); canonicalRuntimePersistenceService.rehydrate(resumed, artifact, identity);
    const before = resumed.captureRuntimePayload();
    expect(before.eventLog.filter(event => event.eventType === effectEventType)).toHaveLength(1);
    expect(() => resumed.scheduleIntervention({ interventionId, patientId, resourceId, action: "APPLY", timestamp: 60, definitionId, parameters: {} }))
      .toThrow(`Intervention ${interventionId} esineb mitu korda.`);
    const after = resumed.captureRuntimePayload();
    expect(after.eventLog.filter(event => event.eventType === effectEventType)).toHaveLength(1);
    expect(after.eventLog).toEqual(before.eventLog);
  });

  test("capture is deterministic and rehydration is idempotent", () => {
    const pkg = PLEURAL_INJURY_EXERCISE_PACKAGE; const sourceFixture = fixture(pkg); const identity = provenance(pkg, sourceFixture.patientId!);
    const source = new ClinicalScenarioEngine(); source.reset(sourceFixture);
    const first = canonicalRuntimePersistenceService.capture(source, identity);
    expect(isCapturedCanonicalRuntimeArtifact(first)).toBe(true);
    expect(Object.isFrozen(first.payload)).toBe(true);
    expect(Object.isFrozen(first.payload.eventLog)).toBe(true);
    expect(canonicalRuntimePersistenceService.capture(source, identity)).toEqual(first);
    const target = new ClinicalScenarioEngine(); canonicalRuntimePersistenceService.rehydrate(target, first, identity);
    const before = target.getHashes(); canonicalRuntimePersistenceService.rehydrate(target, first, identity);
    expect(target.getHashes()).toEqual(before);
  });

  test("preserves Botulism root, HV and Hypoxia lifecycle state", () => {
    const botulism: GoldenFixture = { fixtureId: "FX-WP44A-BOT", fixtureType: "PATIENT", patientId: "PT-BOT", seed: 44,
      clockState: "RUNNING", ownershipVersion: 1, activeResources: {}, loadedModules: ["BOTULISM_V1", "HYPOVENTILATION_HYPERCAPNIA_V1", "HYPOXIA_V1"],
      initialState: { PatientID: "PT-BOT", processAssignments: [
        { PatientProcessID: "PP-TOX", TemplateID: "BOT_TOX", ProcessType: "BOT_TOXIN_ACTIVITY", Status: "Active", InitialReserve: 90, ProgressionRate: 1, ParentProcessID: null, InstanceKey: "toxin" },
        { PatientProcessID: "PP-RESP", TemplateID: "BOT_RESP", ProcessType: "BOT_RESPIRATORY_MUSCLE_FAILURE", Status: "Active", InitialReserve: 20, ProgressionRate: 3, ParentProcessID: "PP-TOX", InstanceKey: "resp" },
      ] } };
    const identity: RuntimeProvenance = { exerciseId: "EX-BOT", patientId: "PT-BOT", packageId: "BOT", packageVersion: "1", packageHash: "P", definitionHash: "D", moduleCompositionHash: "M" };
    const source = new ClinicalScenarioEngine(); source.reset(botulism); source.advanceTo(120);
    source.dispatch({ ...tick("PT-BOT", 1), eventType: "ENCOUNTER_ACTIVATE", payload: {} });
    const artifact = canonicalRuntimePersistenceService.capture(source, identity);
    const resumed = new ClinicalScenarioEngine(); canonicalRuntimePersistenceService.rehydrate(resumed, artifact, identity);
    expect(resumed.getBotulismRoot()).toEqual(source.getBotulismRoot());
    expect(resumed.getPatientProcesses()).toEqual(source.getPatientProcesses());
    expect(resumed.getHashes()).toEqual(source.getHashes());
  });

  test("captures and restores 100 independent patient runtimes without cross-patient state", () => {
    const started = performance.now();
    for (let index = 1; index <= 100; index += 1) {
      const patientId = `PT-${String(index).padStart(3, "0")}`;
      const sourceFixture: GoldenFixture = { fixtureId: `FX-${patientId}`, fixtureType: "PROCESS", patientId, seed: index,
        clockState: "RUNNING", ownershipVersion: 1, activeResources: {}, loadedModules: ["HYPOVENTILATION_HYPERCAPNIA_V1"],
        initialState: { processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV-SCALE", ventilationReserve: 80, reserveLossPerMin: 1, co2Burden: 30, co2GainPerMin: 1 } };
      const identity: RuntimeProvenance = { exerciseId: "EX-SCALE", patientId, packageId: "SCALE", packageVersion: "1", packageHash: "P", definitionHash: "D", moduleCompositionHash: "M" };
      const source = new ClinicalScenarioEngine(); source.reset(sourceFixture);
      const artifact = canonicalRuntimePersistenceService.capture(source, identity);
      const resumed = new ClinicalScenarioEngine(); canonicalRuntimePersistenceService.rehydrate(resumed, artifact, identity);
      expect(resumed.getRuntimeState().encounterId).toBe(patientId);
    }
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
