import type { ClinicalTreatmentCommand, ClinicalTreatmentId } from "@/models/ClinicalTreatment";
import type { AcceptedRuntimePatientCommand } from "@/models/RuntimePatientCommand";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import { clearInstructorRuntimeOwners, registerInstructorRuntimeOwner } from
  "@/services/runtime/instructor/InstructorRuntimeEventRegistry";
import { createScenarioEngineInstructorRuntimeOwner } from
  "@/services/runtime/instructor/ScenarioEngineInstructorRuntimeOwner";
import { setRuntimeWriterAuthorityState } from
  "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import { materializeRuntimePatientCommand } from "../RuntimePatientCommandMaterializer";

const exerciseId = "EX-NARVA-DELAYED-TREATMENT";
const patientId = "PT-PELVIC-001";

function setup(currentSimulationTimeSec = 600) {
  const patient = packagePatientDatasetRegistry.resolve("patients.narva-trauma.v1").patients
    .find(item => item.patient.id === patientId)!;
  const source = new ClinicalScenarioEngine();
  source.reset(structuredClone(patient.runtimeFixture!));
  const payload = source.captureRuntimePayload();
  const engine = new ClinicalScenarioEngine();
  engine.rehydrateRuntimePayload({ ...payload, circulation: { states: [{ patientId, vascularAccess: [{
    interventionInstanceId: "IV-1", type: "PERIPHERAL_IV" as const, resourceIds: ["PIV-1"], establishedAt: 0,
  }], hemorrhageControl: [], runningInfusions: [], updatedAt: 0 }], events: [] } });
  engine.advanceTo(currentSimulationTimeSec);
  setRuntimeWriterAuthorityState("WRITER");
  registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, patientId));
  return engine;
}

function accepted(treatmentId: ClinicalTreatmentId, treatmentCommand: ClinicalTreatmentCommand,
  simulationTimeSec = 120): AcceptedRuntimePatientCommand {
  return Object.freeze({ exerciseId, patientId, commandId: treatmentCommand.command.commandId,
    commandType: "CLINICAL_TREATMENT", patientBaseRevision: 4, patientResultingRevision: 5,
    simulationTimeSec, payload: Object.freeze({ treatmentId, command: treatmentCommand }),
    commandSequence: 8, actorUserId: "CM-B" });
}

describe("durable clinical-treatment simulation-time authority", () => {
  afterEach(() => { clearInstructorRuntimeOwners(); setRuntimeWriterAuthorityState("UNRESOLVED"); });

  test("materializes a delayed canonical 5 g IV Fibryga command without weakening dose or access validation", () => {
    const engine = setup();
    const treatment = Object.freeze({ kind: "MEDICATION", command: Object.freeze({ commandId: "FIB-5G",
      administrationId: "FIB-ADMIN-1", medicationId: "FIBRINOGEN_CONCENTRATE", patientId,
      route: "IV", dose: 5, unit: "G", timestamp: 120, administrator: "CLINICAL_TREATMENT",
      vascularAccessId: "IV-1" }) }) satisfies ClinicalTreatmentCommand;
    expect(materializeRuntimePatientCommand(accepted("FIBRINOGEN_CONCENTRATE", treatment)))
      .toMatchObject({ status: "MATERIALIZED", result: { status: "APPLIED" } });
    expect(engine.getMedicationState()).toContainEqual(expect.objectContaining({ administrationId: "FIB-ADMIN-1",
      medicationId: "FIBRINOGEN_CONCENTRATE", dose: 5, unit: "G", route: "IV", timestamp: 120,
      vascularAccessId: "IV-1" }));
    expect(materializeRuntimePatientCommand(accepted("FIBRINOGEN_CONCENTRATE", treatment)))
      .toMatchObject({ status: "MATERIALIZED", result: { status: "IDEMPOTENT" } });
    expect(engine.getMedicationState().filter(item => item.administrationId === "FIB-ADMIN-1")).toHaveLength(1);
    const restored = new ClinicalScenarioEngine(); restored.rehydrateRuntimePayload(engine.captureRuntimePayload());
    expect(restored.getMedicationState()).toEqual(engine.getMedicationState());
  });

  test.each([
    ["KG", 5, "IV-1"],
    ["G", 21, "IV-1"],
    ["G", 5, "OTHER-PATIENT-IV"],
  ] as const)("still rejects invalid Fibryga unit/dose/access (%s, %s, %s)", (unit, dose, accessId) => {
    setup();
    const treatment = Object.freeze({ kind: "MEDICATION", command: Object.freeze({ commandId: `BAD-${unit}-${dose}-${accessId}`,
      administrationId: `BAD-ADMIN-${unit}-${dose}-${accessId}`, medicationId: "FIBRINOGEN_CONCENTRATE", patientId,
      route: "IV", dose, unit, timestamp: 120, administrator: "CLINICAL_TREATMENT",
      vascularAccessId: accessId }) }) satisfies ClinicalTreatmentCommand;
    expect(materializeRuntimePatientCommand(accepted("FIBRINOGEN_CONCENTRATE", treatment)))
      .toMatchObject({ status: "REJECTED" });
  });

  test("preserves delayed non-writer TXA intent time and authoritative injury-window classification", () => {
    const engine = setup(600);
    const treatment = Object.freeze({ kind: "TXA", command: Object.freeze({ commandId: "TXA-DELAYED",
      action: "START", regimenId: "TXA-REGIMEN-1", patientId, simulationTimeSec: 120,
      vascularAccessId: "IV-1" }) }) satisfies ClinicalTreatmentCommand;
    expect(materializeRuntimePatientCommand(accepted("TRANEXAMIC_ACID", treatment)))
      .toMatchObject({ status: "MATERIALIZED", result: { status: "APPLIED", runtimeResult: {
        state: { startedAtSimulationTimeSec: 120, authoritativeInjuryOnsetSimulationTimeSec: -300,
          timingClassification: "WITHIN_WINDOW" } } } });
    expect(engine.getTranexamicAcidState()).toHaveLength(1);
    expect(materializeRuntimePatientCommand(accepted("TRANEXAMIC_ACID", treatment)))
      .toMatchObject({ status: "MATERIALIZED", result: { status: "IDEMPOTENT" } });
    const restored = new ClinicalScenarioEngine(); restored.rehydrateRuntimePayload(engine.captureRuntimePayload());
    expect(restored.getTranexamicAcidState()).toEqual(engine.getTranexamicAcidState());
  });

  test.each([
    ["future command", 601, 601],
    ["payload/envelope mismatch", 119, 120],
    ["non-finite command", Number.NaN, 120],
  ])("rejects a genuinely stale or invalid durable TXA %s", (_label, commandTime, acceptedTime) => {
    setup(600);
    const treatment = Object.freeze({ kind: "TXA", command: Object.freeze({ commandId: `TXA-BAD-${_label}`,
      action: "START", regimenId: `TXA-BAD-${_label}`, patientId, simulationTimeSec: commandTime,
      vascularAccessId: "IV-1" }) }) satisfies ClinicalTreatmentCommand;
    expect(materializeRuntimePatientCommand(accepted("TRANEXAMIC_ACID", treatment, acceptedTime)))
      .toMatchObject({ status: "REJECTED", result: { rejectionReason: "STALE_SIMULATION_TIME" } });
  });
});
