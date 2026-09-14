import type { ClinicalTreatmentCommand, ClinicalTreatmentId } from "@/models/ClinicalTreatment";
import type { AcceptedRuntimePatientCommand } from "@/models/RuntimePatientCommand";
import type { RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import { clearInstructorRuntimeOwners, registerInstructorRuntimeOwner } from
  "@/services/runtime/instructor/InstructorRuntimeEventRegistry";
import { createScenarioEngineInstructorRuntimeOwner } from
  "@/services/runtime/instructor/ScenarioEngineInstructorRuntimeOwner";
import { setRuntimeWriterAuthorityState } from
  "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import { materializeRuntimePatientCommand } from "../RuntimePatientCommandMaterializer";
import { RuntimePatientCommandConsumer, type RuntimePatientCommandGateway } from "../RuntimePatientCommandService";
import { resetRuntimePatientCommandCursor } from "../RuntimePatientCommandCursor";

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
  simulationTimeSec = 120, commandSequence = 8): AcceptedRuntimePatientCommand {
  return Object.freeze({ exerciseId, patientId, commandId: treatmentCommand.command.commandId,
    commandType: "CLINICAL_TREATMENT", patientBaseRevision: 4, patientResultingRevision: 5,
    simulationTimeSec, payload: Object.freeze({ treatmentId, command: treatmentCommand }),
    commandSequence, actorUserId: "CM-B" });
}

const lease: RuntimeWriterLease = Object.freeze({ leaseId: "LEASE", exerciseId,
  writerInstanceId: "WRITER", userId: "CM-A", expiresAt: "2099-01-01T00:00:00.000Z" });

function paracetamol(commandId: string, simulationTimeSec: number): ClinicalTreatmentCommand {
  return Object.freeze({ kind: "ANALGESIC", command: Object.freeze({ commandId,
    administrationId: `${commandId}-ADMIN`, patientId, drugId: "PARACETAMOL",
    action: "START", route: "IV", mode: "BOLUS", dose: 1000, doseUnit: "MG",
    vascularAccessId: "IV-1", simulationTimeSec }) });
}

describe("durable clinical-treatment simulation-time authority", () => {
  afterEach(() => { clearInstructorRuntimeOwners(); setRuntimeWriterAuthorityState("UNRESOLVED");
    resetRuntimePatientCommandCursor(); });

  test("no-writer Fibryga and TXA stay queued until the recovered checkpoint reaches accepted intent time", async () => {
    const engine = setup(60);
    const fibryga = Object.freeze({ kind: "MEDICATION", command: Object.freeze({ commandId: "FIB-NO-WRITER",
      administrationId: "FIB-NO-WRITER-ADMIN", medicationId: "FIBRINOGEN_CONCENTRATE", patientId,
      route: "IV", dose: 5, unit: "G", timestamp: 120, administrator: "CLINICAL_TREATMENT",
      vascularAccessId: "IV-1" }) }) satisfies ClinicalTreatmentCommand;
    const txa = Object.freeze({ kind: "TXA", command: Object.freeze({ commandId: "TXA-NO-WRITER",
      action: "START", regimenId: "TXA-NO-WRITER-REGIMEN", patientId, simulationTimeSec: 120,
      vascularAccessId: "IV-1" }) }) satisfies ClinicalTreatmentCommand;
    const commands = [accepted("FIBRINOGEN_CONCENTRATE", fibryga, 120, 1),
      accepted("TRANEXAMIC_ACID", txa, 120, 2)];
    const record = jest.fn(async () => undefined);
    const gateway: RuntimePatientCommandGateway = {
      submit: jest.fn(), loadAfter: jest.fn(async () => commands), record,
    };
    const consumer = new RuntimePatientCommandConsumer(gateway, materializeRuntimePatientCommand,
      () => engine.captureRuntimePayload().simulationTimeSec);

    await expect(consumer.drain(exerciseId, lease)).resolves.toBe(0);
    expect(record).not.toHaveBeenCalled();
    expect(engine.getMedicationState()).toHaveLength(0);
    expect(engine.getTranexamicAcidState()).toHaveLength(0);

    engine.advanceTo(120);
    await expect(consumer.drain(exerciseId, lease)).resolves.toBe(2);
    expect(record).toHaveBeenNthCalledWith(1, exerciseId, 1, lease,
      expect.objectContaining({ status: "MATERIALIZED", result: expect.objectContaining({ status: "APPLIED" }) }));
    expect(record).toHaveBeenNthCalledWith(2, exerciseId, 2, lease,
      expect.objectContaining({ status: "MATERIALIZED", result: expect.objectContaining({ status: "APPLIED" }) }));
    expect(engine.getMedicationState()).toContainEqual(expect.objectContaining({ medicationId: "FIBRINOGEN_CONCENTRATE",
      timestamp: 120 }));
    expect(engine.getTranexamicAcidState()).toContainEqual(expect.objectContaining({
      startedAtSimulationTimeSec: 120, timingClassification: "WITHIN_WINDOW" }));
  });

  test.each([0, 1, 5, 8, 10, 30, 60, 120])(
    "materializes Paracetamol from an accepted reader snapshot after %i seconds of writer-only clock advance",
    lagSec => {
      const intentTime = 1774;
      const engine = setup(intentTime + lagSec);
      const treatment = paracetamol(`PARACETAMOL-READER-${lagSec}`, intentTime);
      const command = accepted("PARACETAMOL", treatment, intentTime, 63);

      expect(materializeRuntimePatientCommand(command))
        .toMatchObject({ status: "MATERIALIZED", result: { status: "APPLIED", runtimeResult: {
          state: { startedAtSimulationTimeSec: intentTime, prescribedDose: 1000, doseUnit: "MG" },
        } } });
      expect(materializeRuntimePatientCommand(command))
        .toMatchObject({ status: "MATERIALIZED", result: { status: "IDEMPOTENT" } });
      expect(engine.getAnalgesicState(patientId)).toEqual([expect.objectContaining({
        administrationId: `PARACETAMOL-READER-${lagSec}-ADMIN`, startedAtSimulationTimeSec: intentTime,
      })]);
    });

  test("keeps a future Paracetamol intent queued until the recovered writer reaches it", async () => {
    const engine = setup(100);
    const treatment = paracetamol("PARACETAMOL-FUTURE-120", 120);
    const command = accepted("PARACETAMOL", treatment, 120, 1);
    const record = jest.fn(async () => undefined);
    const gateway: RuntimePatientCommandGateway = {
      submit: jest.fn(), loadAfter: jest.fn(async () => [command]), record,
    };
    const consumer = new RuntimePatientCommandConsumer(gateway, materializeRuntimePatientCommand,
      () => engine.captureRuntimePayload().simulationTimeSec);

    await expect(consumer.drain(exerciseId, lease)).resolves.toBe(0);
    expect(record).not.toHaveBeenCalled();
    engine.advanceTo(120);
    await expect(consumer.drain(exerciseId, lease)).resolves.toBe(1);
    expect(record).toHaveBeenCalledWith(exerciseId, 1, lease,
      expect.objectContaining({ status: "MATERIALIZED", result: expect.objectContaining({ status: "APPLIED" }) }));
    expect(engine.getAnalgesicState(patientId)).toContainEqual(expect.objectContaining({
      administrationId: "PARACETAMOL-FUTURE-120-ADMIN", startedAtSimulationTimeSec: 120,
    }));
  });

  test("uses the same accepted-intent rule for delayed crystalloid bolus and vasopressor infusion", () => {
    const engine = setup(180);
    const fluid = Object.freeze({ kind: "FLUID", command: Object.freeze({ commandId: "RINGER-DELAYED",
      action: "START", administrationId: "RINGER-DELAYED-ADMIN", patientId, fluidType: "RINGER",
      simulationTimeSec: 120, mode: "BOLUS", prescribedVolumeMl: 500, volumeUnit: "ML",
      rateMlHour: 1000, rateUnit: "ML_H", vascularAccessId: "IV-1",
    }) }) satisfies ClinicalTreatmentCommand;
    const norepinephrine = Object.freeze({ kind: "NOREPINEPHRINE", command: Object.freeze({
      commandId: "NOREPINEPHRINE-DELAYED", action: "START", infusionId: "NOREPINEPHRINE-DELAYED-ADMIN",
      patientId, simulationTimeSec: 120, doseMicrogramsPerKgMin: 0.1, unit: "MCG_KG_MIN",
      vascularAccessId: "IV-1",
    }) }) satisfies ClinicalTreatmentCommand;

    expect(materializeRuntimePatientCommand(accepted("RINGER", fluid, 120, 1)))
      .toMatchObject({ status: "MATERIALIZED", result: { status: "APPLIED", runtimeResult: {
        state: { startedAtSimulationTimeSec: 120, prescribedVolumeMl: 500 },
      } } });
    expect(materializeRuntimePatientCommand(accepted("NOREPINEPHRINE", norepinephrine, 120, 2)))
      .toMatchObject({ status: "MATERIALIZED", result: { status: "APPLIED", runtimeResult: {
        state: { startedAtSimulationTimeSec: 120, doseMicrogramsPerKgMin: 0.1 },
      } } });
    expect(engine.getFluidTherapyState(patientId)).toContainEqual(expect.objectContaining({
      administrationId: "RINGER-DELAYED-ADMIN", startedAtSimulationTimeSec: 120,
    }));
    expect(engine.getNorepinephrineState(patientId)).toContainEqual(expect.objectContaining({
      infusionId: "NOREPINEPHRINE-DELAYED-ADMIN", startedAtSimulationTimeSec: 120,
    }));
  });

  test.each([
    ["future intent", 601, 601],
    ["payload/envelope mismatch", 599, 600],
    ["malformed intent", Number.NaN, 600],
  ])("rejects a genuinely invalid durable Paracetamol %s", (_label, commandTime, acceptedTime) => {
    setup(600);
    const treatment = paracetamol(`PARACETAMOL-BAD-${_label}`, commandTime);
    expect(materializeRuntimePatientCommand(accepted("PARACETAMOL", treatment, acceptedTime)))
      .toMatchObject({ status: "REJECTED", result: { rejectionReason: "STALE_SIMULATION_TIME" } });
  });

  test("rejects a durable treatment bound to a different exercise lineage", () => {
    setup(600);
    const treatment = paracetamol("PARACETAMOL-WRONG-EXERCISE", 600);
    expect(materializeRuntimePatientCommand(Object.freeze({
      ...accepted("PARACETAMOL", treatment, 600), exerciseId: "EX-OTHER-LINEAGE",
    }))).toMatchObject({ status: "REJECTED" });
  });

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
