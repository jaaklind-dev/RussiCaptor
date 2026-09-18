import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import type { LaboratoryResultGenerator } from "@/models/LaboratoryWorkflow";
import { stableJson } from "@/utils/stableJson";
import { sha256Text } from "@/utils/sha256";
import { NARVA_LAB_PHYSIOLOGY_GENERATOR_VERSION } from
  "@/services/runtime/laboratory/NarvaLabPhysiologyV1Generator";
import { createScenarioEngineExerciseClockTarget } from
  "@/services/runtime/exercise/ScenarioEngineExerciseClockTarget";

const generator: LaboratoryResultGenerator = ({ sample, resultGroupType }) => ({
  generationVersion: "TEST_FIXTURE_V1", payload: { type: resultGroupType,
    sampledAt: sample.sampledAtSimulationTimeSec, sourceStateVersion: sample.sourceRuntimeStateVersion },
});

describe("laboratory canonical Runtime checkpoint persistence", () => {
  test("restart and writer takeover retain sample/timing and generate each result once", () => {
    const record = packagePatientDatasetRegistry.resolve("patients.narva-trauma.v1").patients[0];
    const patientId = record.patient.id;
    const source = new ClinicalScenarioEngine(generator); source.reset(structuredClone(record.runtimeFixture!));
    source.advanceTo(1000);
    source.orderLaboratory({ orderId: "ORDER-1", exerciseId: "EX-LAB", patientId,
      exercisePackageId: "russicaptor.narva-trauma", labPackageId: "NARVA_POLYTRAUMA",
      orderedBy: "CM-A", orderedAtSimulationTimeSec: 1000 });
    source.collectLaboratorySample({ sampleId: "SAMPLE-1", orderId: "ORDER-1",
      sampledAtSimulationTimeSec: 1000, sourcePatientRevision: 4 });
    source.advanceTo(2000);
    const payload = source.captureRuntimePayload();
    expect(payload.laboratory?.samples).toHaveLength(1);

    const reader = new ClinicalScenarioEngine(); reader.rehydrateRuntimePayload(payload);
    expect(reader.getLaboratoryWorkflow()).toEqual(payload.laboratory); // no reader-local generator

    const takeover = new ClinicalScenarioEngine(generator); takeover.rehydrateRuntimePayload(reader.captureRuntimePayload());
    const beforeHash = sha256Text(stableJson(takeover.getLaboratoryWorkflow()));
    takeover.advanceTo(2500);
    expect(takeover.getLaboratoryWorkflow().resultGroups.filter(item => item.status === "RESULTED")).toHaveLength(1);
    takeover.advanceTo(2500);
    expect(takeover.getLaboratoryWorkflow().resultGroups.filter(item => item.status === "RESULTED")).toHaveLength(1);
    expect(sha256Text(stableJson(payload.laboratory))).toBe(beforeHash);
    expect(takeover.captureRuntimePayload().laboratory?.samples[0]).toEqual(payload.laboratory?.samples[0]);
  });

  test("terminal fence persists inside the canonical Runtime payload", () => {
    const record = packagePatientDatasetRegistry.resolve("patients.narva-trauma.v1").patients[0];
    const patientId = record.patient.id;
    const source = new ClinicalScenarioEngine(generator); source.reset(structuredClone(record.runtimeFixture!));
    source.orderLaboratory({ orderId: "ORDER-T", exerciseId: "EX-LAB", patientId,
      exercisePackageId: "russicaptor.narva-trauma", labPackageId: "NARVA_POLYTRAUMA",
      orderedBy: "CM-A", orderedAtSimulationTimeSec: 0 });
    source.fenceLaboratoryAtTerminal(10);
    const restored = new ClinicalScenarioEngine(generator); restored.rehydrateRuntimePayload(source.captureRuntimePayload());
    restored.advanceTo(4000);
    expect(restored.getLaboratoryWorkflow()).toMatchObject({ terminalFencedAtSimulationTimeSec: 10,
      orders: [{ status: "ORDERED" }] });
    expect(() => restored.orderLaboratory({ orderId: "ORDER-LATE", exerciseId: "EX-LAB", patientId,
      exercisePackageId: "russicaptor.narva-trauma", labPackageId: "NARVA_POLYTRAUMA",
      orderedBy: "CM-A", orderedAtSimulationTimeSec: 4000 })).toThrow("LAB_TERMINAL_FENCED");
  });

  test("production generator is writer-gated and deterministic across reader restart and takeover", () => {
    const record = packagePatientDatasetRegistry.resolve("patients.narva-trauma.v1").patients[0];
    const patientId = record.patient.id;
    const writer = new ClinicalScenarioEngine(undefined, () => true);
    writer.reset(structuredClone(record.runtimeFixture!)); writer.advanceTo(1_000);
    writer.orderLaboratory({ orderId: "ORDER-P", exerciseId: "EX-LAB", patientId,
      exercisePackageId: "russicaptor.narva-trauma", labPackageId: "NARVA_POLYTRAUMA",
      orderedBy: "CM-A", orderedAtSimulationTimeSec: 1_000 });
    writer.collectLaboratorySample({ sampleId: "SAMPLE-P", orderId: "ORDER-P",
      sampledAtSimulationTimeSec: 1_000, sourcePatientRevision: 4 });
    const persisted = writer.captureRuntimePayload();

    const reader = new ClinicalScenarioEngine(undefined, () => false);
    reader.rehydrateRuntimePayload(persisted); reader.advanceTo(2_500);
    expect(reader.getLaboratoryWorkflow().resultGroups.every(item => item.status === "PROCESSING")).toBe(true);

    const takeoverA = new ClinicalScenarioEngine(undefined, () => true);
    const takeoverB = new ClinicalScenarioEngine(undefined, () => true);
    takeoverA.rehydrateRuntimePayload(reader.captureRuntimePayload());
    takeoverB.rehydrateRuntimePayload(reader.captureRuntimePayload());
    takeoverA.advanceTo(2_500); takeoverB.advanceTo(2_500);
    const first = takeoverA.getLaboratoryWorkflow(); const second = takeoverB.getLaboratoryWorkflow();
    expect(first).toEqual(second);
    expect(first.resultGroups.find(item => item.type === "ASTRUP")).toMatchObject({
      status: "PARTIALLY_RESULTED", generationVersion: NARVA_LAB_PHYSIOLOGY_GENERATOR_VERSION,
      resultPayload: { sampledAtSimulationTimeSec: 1_000, pendingAnalyteIds: ["LAB_ASTRUP_HB_FR"] },
    });
  });

  test("production clock progression releases an overdue second sample across a large jump exactly once (G22)", () => {
    const record = packagePatientDatasetRegistry.resolve("patients.narva-trauma.v1").patients[0];
    const patientId = record.patient.id;
    const writer = new ClinicalScenarioEngine(undefined, () => true);
    writer.reset(structuredClone(record.runtimeFixture!)); writer.advanceTo(1_000);
    writer.orderLaboratory({ orderId: "ORDER-1", exerciseId: "EX-LAB", patientId,
      exercisePackageId: "russicaptor.narva-trauma", labPackageId: "NARVA_POLYTRAUMA",
      orderedBy: "CM-A", orderedAtSimulationTimeSec: 1_000 });
    writer.collectLaboratorySample({ sampleId: "SAMPLE-1", orderId: "ORDER-1",
      sampledAtSimulationTimeSec: 1_000, sourcePatientRevision: 4 });
    writer.advanceTo(3_400);
    writer.orderLaboratory({ orderId: "ORDER-2", exerciseId: "EX-LAB", patientId,
      exercisePackageId: "russicaptor.narva-trauma", labPackageId: "NARVA_POLYTRAUMA",
      orderedBy: "CM-A", orderedAtSimulationTimeSec: 5_555 });
    writer.advanceTo(5_555);
    writer.collectLaboratorySample({ sampleId: "SAMPLE-2", orderId: "ORDER-2",
      sampledAtSimulationTimeSec: 5_555, sourcePatientRevision: 20 });

    const target = createScenarioEngineExerciseClockTarget(writer, patientId);
    target.advance(5_555, 7_054);
    expect(writer.getLaboratoryWorkflow().resultGroups.find(item =>
      item.sampleId === "SAMPLE-2" && item.type === "ASTRUP")?.status).toBe("PROCESSING");
    target.advance(7_054, 8_291);
    const after = writer.getLaboratoryWorkflow();
    expect(after.resultGroups.find(item => item.sampleId === "SAMPLE-2" && item.type === "ASTRUP"))
      .toMatchObject({ status: "PARTIALLY_RESULTED", generatedAtSimulationTimeSec: 8_291 });
    const hash = sha256Text(stableJson(after));
    target.advance(8_291, 8_292);
    expect(writer.getLaboratoryWorkflow().resultGroups.filter(item =>
      item.sampleId === "SAMPLE-2" && item.type === "ASTRUP")).toHaveLength(1);
    expect(writer.getLaboratoryWorkflow().resultGroups.find(item =>
      item.sampleId === "SAMPLE-2" && item.type === "ASTRUP")?.generatedAtSimulationTimeSec).toBe(8_291);
    expect(sha256Text(stableJson(writer.getLaboratoryWorkflow()))).toBe(hash);
  });

  test("restart and takeover release an overdue writer result while a reader remains read-only (G04/G06/G22)", () => {
    const record = packagePatientDatasetRegistry.resolve("patients.narva-trauma.v1").patients[0];
    const patientId = record.patient.id;
    const source = new ClinicalScenarioEngine(undefined, () => true);
    source.reset(structuredClone(record.runtimeFixture!)); source.advanceTo(1_000);
    source.orderLaboratory({ orderId: "ORDER-R", exerciseId: "EX-LAB", patientId,
      exercisePackageId: "russicaptor.narva-trauma", labPackageId: "NARVA_POLYTRAUMA",
      orderedBy: "CM-A", orderedAtSimulationTimeSec: 1_000 });
    source.collectLaboratorySample({ sampleId: "SAMPLE-R", orderId: "ORDER-R",
      sampledAtSimulationTimeSec: 1_000, sourcePatientRevision: 4 });
    source.advanceTo(2_499);
    const beforeThreshold = source.captureRuntimePayload();

    const restartedWriter = new ClinicalScenarioEngine(undefined, () => true);
    restartedWriter.rehydrateRuntimePayload(beforeThreshold); restartedWriter.advanceTo(2_500);
    expect(restartedWriter.getLaboratoryWorkflow().resultGroups.find(item => item.type === "ASTRUP")?.status)
      .toBe("PARTIALLY_RESULTED");

    const reader = new ClinicalScenarioEngine(undefined, () => false);
    reader.rehydrateRuntimePayload(beforeThreshold); reader.advanceTo(8_291);
    expect(reader.getLaboratoryWorkflow().resultGroups.every(item => item.status === "PROCESSING")).toBe(true);
    const overdue = reader.captureRuntimePayload();
    const takeover = new ClinicalScenarioEngine(undefined, () => true);
    takeover.rehydrateRuntimePayload(overdue); takeover.advanceTo(8_291);
    expect(takeover.getLaboratoryWorkflow().resultGroups.find(item => item.type === "ASTRUP"))
      .toMatchObject({ status: "PARTIALLY_RESULTED", generatedAtSimulationTimeSec: 8_291 });
    expect(takeover.advanceTo(8_291)).toBeUndefined();
    expect(takeover.getLaboratoryWorkflow().resultGroups.filter(item => item.type === "ASTRUP")).toHaveLength(1);
  });
});
