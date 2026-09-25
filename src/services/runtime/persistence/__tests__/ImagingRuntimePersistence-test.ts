import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";

const setup = () => {
  const record = packagePatientDatasetRegistry.resolve("patients.narva-iro-evacuation.v2").patients[0];
  const engine = new ClinicalScenarioEngine(undefined, undefined, () => true);
  engine.reset(structuredClone(record.runtimeFixture!));
  return { engine, patientId: record.patient.id };
};
const definition = (patientId: string) => ({ definitionId: "CXR", patientId, title: "Rindkere röntgen",
  modality: "XR" as const, reportSource: "Immutable report", delaySeconds: 60,
  packageId: "package", packageVersion: "1", packageHash: "hash" });

describe("I2 Imaging canonical Runtime checkpoint persistence", () => {
  test("full payload roundtrip preserves pending instance and writer reconciliation releases once", () => {
    const { engine: source, patientId } = setup();
    source.orderImaging({ commandId: "CMD-1", exerciseId: "EX-I2", patientId, orderedBy: "CM",
      orderedAtSimulationTimeSec: 0, definition: definition(patientId) });
    source.advanceTo(20); const payload = source.captureRuntimePayload();
    expect(payload.imaging?.instances[0]).toMatchObject({ status: "PROCESSING", availableAtSimulationTimeSec: 60 });
    const { engine: restored } = setup(); restored.rehydrateRuntimePayload(payload);
    expect(restored.getImagingWorkflow()).toEqual(payload.imaging);
    restored.advanceTo(60);
    expect(restored.getImagingWorkflow().instances).toEqual([expect.objectContaining({ status: "RESULTED",
      result: { report: "Immutable report", releasedAtSimulationTimeSec: 60 } })]);
    restored.advanceTo(600);
    expect(restored.getImagingWorkflow().instances).toHaveLength(1);
  });

  test("terminal fence is canonical and blocks overdue release after restore", () => {
    const { engine: source, patientId } = setup();
    source.orderImaging({ commandId: "CMD-T", exerciseId: "EX-I2", patientId, orderedBy: "CM",
      orderedAtSimulationTimeSec: 0, definition: definition(patientId) });
    source.fenceLaboratoryAtTerminal(10);
    const { engine: restored } = setup(); restored.rehydrateRuntimePayload(source.captureRuntimePayload());
    restored.advanceTo(100);
    expect(restored.getImagingWorkflow()).toMatchObject({ terminalFencedAtSimulationTimeSec: 10,
      instances: [expect.objectContaining({ status: "ORDERED" })] });
  });
});
