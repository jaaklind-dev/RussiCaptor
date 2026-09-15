import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import type { LaboratoryResultGenerator } from "@/models/LaboratoryWorkflow";
import { stableJson } from "@/utils/stableJson";
import { sha256Text } from "@/utils/sha256";

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
});
