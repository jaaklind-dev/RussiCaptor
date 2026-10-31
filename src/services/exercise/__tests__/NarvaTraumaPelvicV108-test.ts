import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HemorrhagePatientProcessRuntime } from "@/models/HemorrhagePatientProcess";
import type { MassiveTransfusionPatientProcessRuntime } from "@/models/MassiveTransfusion";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { PatientTransportEngine } from "@/services/runtime/PatientTransportEngine";
import { stableJson } from "@/utils/stableJson";
import { sha256Text } from "@/utils/sha256";
import { NARVA_PELVIC_FIXTURE, NARVA_TRAUMA_OUTDOOR_PATIENT_DATASET } from "../NarvaPatientDatasets";
import { NARVA_TRAUMA_EXERCISE_PACKAGE_V107 } from "../NarvaTraumaImagingV107";
import { NARVA_PELVIC_V108_FIXTURE, NARVA_PELVIC_V108_SOURCE_CONTROL,
  NARVA_TRAUMA_EXERCISE_PACKAGE_V108, NARVA_TRAUMA_PELVIC_V108_DATASET } from "../NarvaTraumaPelvicV108";
import { exercisePackageLoader, exercisePackageRegistry, exercisePackageValidator } from "../ExercisePackageService";
import { PackagePatientDatasetRegistry, createPatientMaterializationPlan } from "../PackagePatientMaterializationService";
import { packagePatientDatasetRegistry } from "../CanonicalPatientDatasets";

jest.mock("@/repositories/ScenarioRepository", () => ({ getAllPendingScenarioEvents: () => [], markScenarioEventExecuted: jest.fn() }));
jest.mock("@/services/SyncService", () => ({ notifySync: jest.fn() }));
jest.mock("@/services/WorkflowExecutor", () => ({ executeScenarioEvent: jest.fn() }));

const patientId = "PT-PELVIC-001";
const evidenceDir = process.env.NARVA_PELVIC_EVIDENCE_DIR;
const source = NARVA_TRAUMA_EXERCISE_PACKAGE_V108;
const old = exercisePackageRegistry.require(source.packageId, "1.0.7");
const priorPackageJson = stableJson(old);
const priorDatasetJson = stableJson(NARVA_TRAUMA_OUTDOOR_PATIENT_DATASET);
const candidate = exercisePackageLoader.load(source);
const datasetRegistry = new PackagePatientDatasetRegistry();
datasetRegistry.register(NARVA_TRAUMA_OUTDOOR_PATIENT_DATASET);
datasetRegistry.register(NARVA_TRAUMA_PELVIC_V108_DATASET);

type Spec = Readonly<{ name: string; binderAt?: number; blood: "NONE" | "ED_ONLY" | "CARRY"; restartAt?: number }>;
const specs: readonly Spec[] = [
  { name: "untreated", blood: "NONE" },
  { name: "binder_only", binderAt: 5, blood: "NONE" },
  { name: "blood_ED_only", binderAt: 5, blood: "ED_ONLY" },
  { name: "blood_carry", binderAt: 5, blood: "CARRY" },
  { name: "delayed_care", binderAt: 20, blood: "CARRY" },
  { name: "carry_restart_infusion", binderAt: 5, blood: "CARRY", restartAt: 110 },
];

function replay(spec: Spec) {
  let engine = new ClinicalScenarioEngine(); engine.reset(structuredClone(NARVA_PELVIC_V108_FIXTURE));
  let transport = new PatientTransportEngine(candidate.transportConfiguration!, {
    [patientId]: "NARVA_ED", "PT-CHEST-001": "NARVA_ED",
  });
  const actions: { minute: number; actionId: string }[] = [];
  let sequence = 0;
  const mtp = () => engine.getPatientProcesses().find(p => p.processType === "MASSIVE_TRANSFUSION") as unknown as MassiveTransfusionPatientProcessRuntime;
  function action(minute: number, actionId: string, payload: Record<string, unknown> = {}) {
    engine.dispatch({ sequenceId: spec.name, step: ++sequence, offsetSec: minute * 60, eventType: "ACTION",
      actor: "EXCON", target: patientId, eventId: `${spec.name}:${sequence}`, actionId, result: "SUCCESS", payload });
    actions.push({ minute, actionId });
  }
  function point(minute: number) {
    const state = engine.getRuntimeState(); const readings = state.vitalSignState!.readings;
    const h = engine.getPatientProcesses().find(p => p.processType === "HEMORRHAGE") as HemorrhagePatientProcessRuntime;
    return { minute, sbp: readings.systolicBp.current, dbp: readings.diastolicBp.current,
      hr: readings.heartRate.current, gcs: readings.gcs.current, mentalStatus: state.mentalStatusCode,
      globalStatus: state.globalStatus, clinicalState: state.physiologicDecompensation!.clinicalState,
      lossMl: h.clinicalState.cumulativeLossMl, rateMlMin: h.clinicalState.bleedingRateMlMin,
      bloodMl: mtp().clinicalState.transfusedVolumeMl, units: structuredClone(mtp().clinicalState.administeredUnits),
      inventory: structuredClone(mtp().clinicalState.inventory) };
  }
  if (spec.blood !== "NONE") for (const [index, gauge] of [18, 16].entries()) {
    engine.scheduleIntervention({ interventionId: `PIV-${index}`, patientId, resourceId: `PIV-PELVIC-${index + 1}`,
      action: "APPLY", timestamp: 0, definitionId: "PERIPHERAL_IV_ACCESS", parameters: { location: "arm", gauge, attempts: 1 } });
    engine.applyScheduledResourceInterventionsAtCurrentTime();
  }
  const points = [point(0)];
  for (let minute = 1; minute <= 225; minute++) {
    const at = minute - 1;
    engine.advanceTo(at * 60);
    if (at === 25) expect(transport.start("CHEST", "PT-CHEST-001", "NARVA-REANIMOBILE-01", "IVKH", at * 60).status).toBe("STARTED");
    const alive = engine.getRuntimeState().globalStatus !== "Dead";
    if (alive && at === 105) expect(transport.start("PELVIC", patientId, "NARVA-REANIMOBILE-01", "PERH", at * 60).status).toBe("STARTED");
    if (alive && at === spec.binderAt) {
      engine.scheduleIntervention({ interventionId: "BINDER", patientId, resourceId: "PB-PELVIC-1", action: "APPLY",
        timestamp: at * 60, definitionId: "PELVIC_BINDER_APPLICATION", parameters: {} });
      engine.applyScheduledResourceInterventionsAtCurrentTime();
      if (spec.blood !== "NONE") action(at, "MTP_ACTIVATION");
    }
    const m = mtp().clinicalState;
    // Same numerical comparator as replay R1, not a clinical prescription.
    if (alive && spec.blood !== "NONE" && minute >= Math.max(10, spec.binderAt ?? 0) && m.activated &&
      (spec.blood === "CARRY" || minute <= 105) && engine.getRuntimeState().vitalSignState!.readings.systolicBp.current < 95 &&
      m.administrations.every(a => a.state !== "RUNNING") && m.administeredUnits.RBC < 8 && m.administeredUnits.PLASMA < 8) {
      action(at, "RBC_ADMINISTRATION", { units: 1, deliveryMode: "PRESSURE_BAG", vascularAccessLineId: "IV-1" });
      action(at, "PLASMA_ADMINISTRATION", { units: 1, deliveryMode: "PRESSURE_BAG", vascularAccessLineId: "IV-2" });
    }
    if (alive && mtp().clinicalState.transfusionCalcium.calciumRecommended) action(at, "CALCIUM_ADMINISTRATION");
    engine.advanceTo(minute * 60);
    engine.dispatch({ sequenceId: spec.name, step: ++sequence, offsetSec: minute * 60, eventType: "ENGINE_TICK",
      actor: "ENGINE", target: patientId, eventId: `${spec.name}:tick:${minute}`, result: "SUCCESS", payload: { tickMin: 1 } });
    transport.advanceTo(minute * 60); points.push(point(minute));
    if (minute === spec.restartAt) {
      const restored = new ClinicalScenarioEngine(); restored.reset(structuredClone(NARVA_PELVIC_V108_FIXTURE));
      restored.rehydrateRuntimePayload(engine.captureRuntimePayload()); engine = restored;
      transport = new PatientTransportEngine(candidate.transportConfiguration!, {}, transport.snapshot());
      expect(point(minute)).toEqual(points.at(-1));
    }
  }
  return { spec, points, actions, transport: transport.snapshot() };
}

const trajectories = new Map<string, ReturnType<typeof replay>>();
beforeAll(() => {
  global.fetch = jest.fn(() => { throw new Error("LOCAL_TEST_NETWORK_FORBIDDEN"); }) as typeof fetch;
  specs.forEach(spec => trajectories.set(spec.name, replay(spec)));
  if (evidenceDir) {
    writeFileSync(join(evidenceDir, "TRAJECTORIES-V108.json"), JSON.stringify([...trajectories.values()], null, 2));
    writeFileSync(join(evidenceDir, "CANDIDATE-PACKAGE.json"), JSON.stringify(candidate, null, 2));
    writeFileSync(join(evidenceDir, "CANDIDATE-DATASET.json"), JSON.stringify(NARVA_TRAUMA_PELVIC_V108_DATASET, null, 2));
    writeFileSync(join(evidenceDir, "IDENTITY.json"), JSON.stringify({ sourceHash: source.packageHash,
      canonicalHash: candidate.packageHash, datasetHash: sha256Text(stableJson(NARVA_TRAUMA_PELVIC_V108_DATASET)),
      originalPackageHash: old.packageHash }, null, 2));
  }
});

test("new candidate and materialization validate through the existing workflow", () => {
  expect(exercisePackageValidator.validate(source)).toEqual([]);
  expect(exercisePackageValidator.validate(candidate)).toEqual([]);
  expect(candidate.packageVersion).toBe("1.0.8");
  expect(createPatientMaterializationPlan("LOCAL-CANDIDATE", candidate, datasetRegistry).patients.map(p => p.patient.id))
    .toEqual(["PT-CHEST-001", "PT-PELVIC-001"]);
});
test("active catalog materializes the approved version while preserving historical binding", () => {
  const latest = exercisePackageRegistry.latest(source.packageId)!;
  expect(latest.packageVersion).toBe("1.0.8");
  expect(latest.packageHash).toBe("004bafe3c3641524a0a4872016f5e08c461b4c29f640c1b4cdf5590534c542f9");
  expect(sha256Text(stableJson(NARVA_TRAUMA_PELVIC_V108_DATASET)))
    .toBe("822377f9d6763cfa7d72cbb0103ef29f36553f3609d95082a3d38a7ed208cc36");
  const plan = createPatientMaterializationPlan("LOCAL-INTEGRATION", latest, packagePatientDatasetRegistry);
  expect(plan.patients.map(record => record.patient.id)).toEqual(["PT-CHEST-001", "PT-PELVIC-001"]);
  expect(exercisePackageRegistry.require(source.packageId, "1.0.7").packageHash)
    .toBe("64468d8ae2dcfbd8c54b4411bf1add55a8ff8b96ca6465bfee08dcebfe1cfc7e");
  expect(createPatientMaterializationPlan("LOCAL-HISTORICAL", old, packagePatientDatasetRegistry).patients)
    .toHaveLength(2);
});
test("published package, dataset and original fixture remain immutable", () => {
  expect(stableJson(old)).toBe(priorPackageJson); expect(old.packageHash).toBe("64468d8ae2dcfbd8c54b4411bf1add55a8ff8b96ca6465bfee08dcebfe1cfc7e");
  expect(stableJson(NARVA_TRAUMA_OUTDOOR_PATIENT_DATASET)).toBe(priorDatasetJson);
  expect((NARVA_PELVIC_FIXTURE.initialState as Record<string, unknown>).physiologicDecompensationEnabled).toBeUndefined();
});
test("only the pelvic runtime fixture changes in the new patient dataset", () => {
  const chest = (d: typeof NARVA_TRAUMA_PELVIC_V108_DATASET) => d.patients.find(p => p.patient.id === "PT-CHEST-001");
  expect(chest(NARVA_TRAUMA_PELVIC_V108_DATASET)).toEqual(chest(NARVA_TRAUMA_OUTDOOR_PATIENT_DATASET));
  const prior = NARVA_TRAUMA_OUTDOOR_PATIENT_DATASET.patients.find(p => p.patient.id === patientId)!;
  const next = NARVA_TRAUMA_PELVIC_V108_DATASET.patients.find(p => p.patient.id === patientId)!;
  expect(next.patient).toEqual(prior.patient); expect(next.initialLocationId).toBe(prior.initialLocationId);
  expect(NARVA_PELVIC_V108_FIXTURE.loadedModules).toEqual(NARVA_PELVIC_FIXTURE.loadedModules);
  expect(NARVA_PELVIC_V108_SOURCE_CONTROL.correctMaturation.map(s => s.rateMlMin)).toEqual([20,12,8,6]);
});
test("all unrelated package semantics, grants-free treatment scope and timings remain unchanged", () => {
  for (const key of Object.keys(NARVA_TRAUMA_EXERCISE_PACKAGE_V107) as (keyof typeof source)[]) {
    if (["packageVersion", "patientDatasetId", "imagingConfiguration", "metadata", "manifest", "packageHash"].includes(key)) continue;
    expect(source[key]).toEqual(NARVA_TRAUMA_EXERCISE_PACKAGE_V107[key]);
  }
});
test("four version-bound image references retain exact bytes, reports and 7/10 timing", () => {
  source.imagingConfiguration!.definitions.forEach((next, i) => {
    const prior = NARVA_TRAUMA_EXERCISE_PACKAGE_V107.imagingConfiguration!.definitions[i];
    expect(next.order).toEqual(prior.order);
    expect({ ...next.study, asset: undefined }).toEqual({ ...prior.study, asset: undefined });
    expect(next.study.asset!.sha256).toBe(prior.study.asset!.sha256);
    expect(next.study.asset!.provenance).toEqual(prior.study.asset!.provenance);
    expect(next.study.asset!.packageVersion).toBe("1.0.8");
    expect(next.order.workflow.imageDelayMinutes).toBe(7); expect(next.order.workflow.delayMinutes).toBe(10);
  });
});
test.each(["untreated", "binder_only", "delayed_care"])("%s cannot remain GCS15/stable indefinitely or resurrect after death", name => {
  const row = trajectories.get(name)!; const death = row.points.find(p => p.clinicalState === "DEAD");
  expect(death).toBeDefined(); expect(row.points.slice(death!.minute).every(p => p.clinicalState === "DEAD" && p.globalStatus === "Dead" && p.gcs === 3 && p.hr === 0)).toBe(true);
  expect(row.points.at(-1)!.lossMl).toBe(death!.lossMl);
  expect(row.actions.every(a => a.minute < death!.minute)).toBe(true);
});
test("early blood plus ongoing transport support preserves a conditional rescue window", () => {
  const row = trajectories.get("blood_carry")!; const end = row.points.at(-1)!;
  expect(end.clinicalState).toBe("ALIVE"); expect(end.sbp).toBeGreaterThan(90);
  expect(row.points.some(p => p.gcs < 15)).toBe(true); expect(end.gcs).toBe(15);
  expect(end.units).toEqual({ RBC: 6, PLASMA: 6, PLATELETS: 0 });
  expect(end.inventory).toEqual({ RBC: 2, PLASMA: 2, PLATELETS: 0 });
  expect(row.actions.filter(a => a.minute >= 105 && a.actionId === "RBC_ADMINISTRATION").map(a => a.minute)).toEqual([106,161]);
});
test("omitting blood on the two-hour journey worsens perfusion and GCS", () => {
  const no = trajectories.get("blood_ED_only")!.points.at(-1)!; const yes = trajectories.get("blood_carry")!.points.at(-1)!;
  expect(no.sbp).toBeLessThan(yes.sbp); expect(no.gcs).toBeLessThan(yes.gcs);
});
test("restart with running transfusion in transit preserves the complete trajectory", () => {
  expect(trajectories.get("carry_restart_infusion")!.points).toEqual(trajectories.get("blood_carry")!.points);
  expect(trajectories.get("carry_restart_infusion")!.transport).toEqual(trajectories.get("blood_carry")!.transport);
});
test("same inputs replay deterministically without external fetch", () => {
  expect(replay(specs.find(s => s.name === "blood_carry")!)).toEqual(trajectories.get("blood_carry"));
  expect(global.fetch).not.toHaveBeenCalled();
});

test("candidate readiness: severe low-pressure/low-GCS state must not be labelled Stable", () => {
  const end = trajectories.get("blood_ED_only")!.points.at(-1)!;
  expect(end.sbp).toBeLessThan(60); expect(end.gcs).toBeLessThanOrEqual(12);
  expect(end.globalStatus).not.toBe("Stable");
});
