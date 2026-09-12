import fs from "node:fs";
import path from "node:path";

import type { AcceptedRuntimePatientCommand, RuntimePatientCommandSubmission } from "@/models/RuntimePatientCommand";
import type { RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import type { NarvaIroScenarioControlCommandType } from "@/models/NarvaIroScenario";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import { NARVA_IRO_EXERCISE_PACKAGE } from "@/services/exercise/NarvaExercisePackages";
import { exercisePackageRegistry } from "@/services/exercise/ExercisePackageService";
import { getPatientResourceDebugSnapshot } from "@/services/ResourceRuntimeDebugService";
import { clearInstructorRuntimeOwners, registerInstructorRuntimeOwner } from
  "@/services/runtime/instructor/InstructorRuntimeEventRegistry";
import { createScenarioEngineInstructorRuntimeOwner } from
  "@/services/runtime/instructor/ScenarioEngineInstructorRuntimeOwner";
import { resetNarvaIroScenarioControlCommands } from
  "@/services/runtime/instructor/NarvaIroScenarioControlCommandService";
import { setRuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import { InMemoryRuntimePatientCommandGateway, type RuntimeCommandActor } from
  "../InMemoryRuntimePatientCommandGateway";
import { materializeRuntimePatientCommand } from "../RuntimePatientCommandMaterializer";
import { RuntimePatientCommandConsumer } from "../RuntimePatientCommandService";
import { resetRuntimePatientCommandCursor } from "../RuntimePatientCommandCursor";

const exerciseId = "EX-IRO-CONTROLS";
const patientId = "PT-IRO-001";
const fixture = packagePatientDatasetRegistry.resolve("patients.narva-iro-evacuation.v2").patients[0].runtimeFixture!;
const lease: RuntimeWriterLease = Object.freeze({ leaseId: "LEASE-IRO", exerciseId,
  writerInstanceId: "WRITER-IRO", userId: "EXCON-A", expiresAt: "2099-01-01T00:00:00.000Z" });

function command(commandType: NarvaIroScenarioControlCommandType, payload: Readonly<Record<string, unknown>> = {},
  commandSequence = 1, simulationTimeSec = 0): AcceptedRuntimePatientCommand {
  return Object.freeze({ exerciseId, patientId, commandId: `${commandType}-${commandSequence}`, commandType,
    patientBaseRevision: commandSequence - 1, patientResultingRevision: commandSequence,
    simulationTimeSec, payload, commandSequence, actorUserId: "EXCON-A" });
}

function setup(simulationTimeSec = 0): ClinicalScenarioEngine {
  const engine = new ClinicalScenarioEngine(); engine.reset(structuredClone(fixture));
  if (simulationTimeSec) engine.advanceTo(simulationTimeSec);
  setRuntimeWriterAuthorityState("WRITER");
  registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, patientId));
  return engine;
}

describe("WP-NARVA-10B1 durable IRO scenario controls", () => {
  afterEach(() => { clearInstructorRuntimeOwners(); resetNarvaIroScenarioControlCommands();
    resetRuntimePatientCommandCursor(); setRuntimeWriterAuthorityState("UNRESOLVED"); });

  test.each([
    "CIRCUIT_DISCONNECT", "HIGH_PRESSURE_KINK", "OXYGEN_DEPLETION", "VENTILATOR_STOP",
  ] as const)("routes ventilation START to existing %s branch and CORRECT to recovery", faultType => {
    const engine = setup();
    expect(materializeRuntimePatientCommand(command("IRO_VENTILATION_FAULT_START", { faultType })))
      .toMatchObject({ status: "MATERIALIZED", result: { ok: true } });
    expect(engine.getNarvaIroScenarioState()).toMatchObject({ ventilationFault: { type: faultType },
      ventilationStage: "EARLY" });
    expect(materializeRuntimePatientCommand(command("IRO_VENTILATION_FAULT_CORRECT", {}, 2)))
      .toMatchObject({ status: "MATERIALIZED", result: { ok: true } });
    expect(engine.getNarvaIroScenarioState().ventilationFault?.correctedAtSimulationTimeSec).toBe(0);
  });

  test("routes vasopressor START/CORRECT through the writer and preserves reference progression", () => {
    const engine = setup();
    expect(materializeRuntimePatientCommand(command("IRO_VASOPRESSOR_FAULT_START"))).toMatchObject({ status: "MATERIALIZED" });
    expect(getPatientResourceDebugSnapshot(patientId).narvaIroScenario).toMatchObject({
      vasopressorFault: { startedAtSimulationTimeSec: 0 }, vasopressorStage: "S0",
    });
    engine.advanceTo(60);
    expect(engine.getNarvaIroScenarioState()).toMatchObject({ vasopressorStage: "S2", systolicBp: 75,
      diastolicBp: 40, etco2: 4.8 });
    expect(materializeRuntimePatientCommand(command("IRO_VASOPRESSOR_FAULT_CORRECT", {}, 2, 60)))
      .toMatchObject({ status: "MATERIALIZED" });
    expect(getPatientResourceDebugSnapshot(patientId).narvaIroScenario)
      .toMatchObject({ vasopressorFault: { correctedAtSimulationTimeSec: 60 }, vasopressorStage: "S2R" });
    engine.advanceTo(180);
    expect(engine.getNarvaIroScenarioState().vasopressorStage).toBe("S2R");
  });

  test("rejects malformed ventilation payload without mutating Runtime", () => {
    const engine = setup(); const before = engine.captureRuntimePayload();
    expect(materializeRuntimePatientCommand(command("IRO_VENTILATION_FAULT_START", { faultType: "UNKNOWN" })))
      .toMatchObject({ status: "REJECTED", result: { errorCode: "INVALID_COMMAND_PAYLOAD" } });
    expect(engine.captureRuntimePayload()).toEqual(before);
    expect(materializeRuntimePatientCommand(command("IRO_HOLD", { derivedPhysiology: true }, 2)))
      .toMatchObject({ status: "REJECTED", result: { errorCode: "INVALID_COMMAND_PAYLOAD" } });
    expect(engine.captureRuntimePayload()).toEqual(before);
  });

  test("uses accepted simulation time after writer recovery and applies ordered START/HOLD/RESUME/CORRECT once", async () => {
    let actor: RuntimeCommandActor = { userId: "EXCON-A", role: "EXCON", exerciseIds: [exerciseId] };
    const gateway = new InMemoryRuntimePatientCommandGateway(() => actor); gateway.seed(exerciseId, patientId);
    const submissions: RuntimePatientCommandSubmission[] = [
      { ...command("IRO_VASOPRESSOR_FAULT_START", {}, 1, 0) },
      { ...command("IRO_HOLD", {}, 2, 30) },
      { ...command("IRO_RESUME", {}, 3, 60) },
      { ...command("IRO_VASOPRESSOR_FAULT_CORRECT", {}, 4, 90) },
    ];
    for (const submission of submissions) expect((await gateway.submit(submission)).status).toBe("APPLIED");
    expect((await gateway.submit(submissions[0])).status).toBe("IDEMPOTENT");
    const engine = setup(120);
    const consumer = new RuntimePatientCommandConsumer(gateway, materializeRuntimePatientCommand,
      () => engine.getRuntimeState().exerciseTimeSec);
    await expect(consumer.drain(exerciseId, lease)).resolves.toBe(4);
    expect(engine.getNarvaIroScenarioState()).toMatchObject({ hold: false, vasopressorFault: {
      startedAtSimulationTimeSec: 0, accumulatedHoldSec: 30, correctedAtSimulationTimeSec: 90,
    } });
    expect(gateway.accepted()).toHaveLength(4);
    const payload = engine.captureRuntimePayload(); const restored = new ClinicalScenarioEngine();
    restored.rehydrateRuntimePayload(payload);
    expect(restored.getNarvaIroScenarioState()).toEqual(engine.getNarvaIroScenarioState());
    actor = { userId: "EXCON-A", role: "EXCON", exerciseIds: ["OTHER"] };
    const wrongExercise: RuntimePatientCommandSubmission = { exerciseId, patientId, commandId: "WRONG-EXERCISE",
      commandType: "IRO_HOLD", patientBaseRevision: 4, simulationTimeSec: 120, payload: {} };
    expect((await gateway.submit(wrongExercise)).status).toBe("AUTHORIZATION_DENIED");
  });

  test("server-equivalent gateway rejects CM, wrong-exercise EXCON and completion-fenced controls", async () => {
    let actor: RuntimeCommandActor | undefined;
    const gateway = new InMemoryRuntimePatientCommandGateway(() => actor); gateway.seed(exerciseId, patientId, "CM-A");
    const submission: RuntimePatientCommandSubmission = { ...command("IRO_VASOPRESSOR_FAULT_START") };
    expect((await gateway.submit(submission)).status).toBe("AUTHORIZATION_DENIED");
    actor = { userId: "CM-A", role: "CM", exerciseIds: [exerciseId] };
    expect((await gateway.submit(submission)).status).toBe("AUTHORIZATION_DENIED");
    actor = { userId: "EXCON-A", role: "EXCON", exerciseIds: ["OTHER"] };
    expect((await gateway.submit(submission)).status).toBe("AUTHORIZATION_DENIED");
    actor = { userId: "EXCON-A", role: "EXCON", exerciseIds: [exerciseId] }; gateway.fence(exerciseId);
    expect((await gateway.submit(submission)).status).toBe("COMPLETION_FENCED");
    expect(gateway.accepted()).toHaveLength(0);
  });

  test("restores a checkpoint while HOLD is active without advancing the fault clock", () => {
    const engine = setup();
    materializeRuntimePatientCommand(command("IRO_VASOPRESSOR_FAULT_START", {}, 1, 0));
    engine.advanceTo(30); materializeRuntimePatientCommand(command("IRO_HOLD", {}, 2, 30));
    engine.advanceTo(120);
    expect(engine.getNarvaIroScenarioState()).toMatchObject({ hold: true, vasopressorStage: "S1",
      vasopressorFault: { heldAtSimulationTimeSec: 30 } });
    const payload = engine.captureRuntimePayload(); const restored = new ClinicalScenarioEngine();
    restored.rehydrateRuntimePayload(payload);
    expect(restored.getNarvaIroScenarioState()).toEqual(engine.getNarvaIroScenarioState());
  });

  test("keeps the immutable IRO package hashes unchanged", () => {
    expect(NARVA_IRO_EXERCISE_PACKAGE).toMatchObject({ packageVersion: "1.0.1",
      packageHash: "31d8267f61a62ccc3423d4ef15ac8f1f566d4603ab4ae0d55c7f21e7126b5cc4",
      manifest: { definitionHash: "587b1b041131af126af2019550a0c3fcc3be70807d71b7c812d9d097d924b770" } });
    expect(exercisePackageRegistry.require("russicaptor.narva-iro-evacuation", "1.0.1"))
      .toMatchObject({ packageVersion: "1.0.1",
      packageHash: "da184dfe5e9916fc4f401470cb3715b353746950630d892c3acf33c393fa2b95",
      manifest: { definitionHash: "6c099abc91940639891adb36fa4a1e91e9f0c39336b769ec96622b7f4eecdfd0" } });
  });
});

describe("WP-NARVA-10B1 forward-only authorization migration", () => {
  const sql = fs.readFileSync(path.resolve(__dirname,
    "../../../../../supabase/migrations/20260912083420_narva_iro_scenario_controls.sql"), "utf8");

  test("adds only the six canonical IRO command types to the existing inbox", () => {
    for (const type of ["IRO_VASOPRESSOR_FAULT_START", "IRO_VASOPRESSOR_FAULT_CORRECT",
      "IRO_VENTILATION_FAULT_START", "IRO_VENTILATION_FAULT_CORRECT", "IRO_HOLD", "IRO_RESUME"]) {
      expect(sql).toContain(`'${type}'`);
    }
    expect(sql).toMatch(/alter table public\.runtime_patient_commands/);
    expect(sql).not.toMatch(/create table public\.iro/i);
  });

  test("requires exercise-scoped EXCON permission server-side and retains completion fencing", () => {
    expect(sql).toMatch(/if v_is_iro_control then[\s\S]+has_authorization_permission\('EXCON_EXERCISE_CONTROL',p_exercise_id\)/);
    expect(sql).toMatch(/AUTHENTICATION_REQUIRED/);
    expect(sql).toMatch(/AUTHORIZATION_DENIED/);
    expect(sql).toMatch(/COMPLETION_FENCED/);
    expect(sql).toMatch(/exercise_lifecycle_from_state\(v_exercise\.state\)<>'RUNNING'/);
    expect(sql).not.toMatch(/service_role|bypassrls/i);
  });

  test("validates branch payloads and preserves durable audit/order fields", () => {
    expect(sql).toMatch(/CIRCUIT_DISCONNECT[\s\S]+HIGH_PRESSURE_KINK[\s\S]+OXYGEN_DEPLETION[\s\S]+VENTILATOR_STOP/);
    expect(sql).toMatch(/insert into public\.runtime_patient_commands/);
    expect(sql).toMatch(/actor_user_id/);
    expect(sql).toMatch(/simulation_time_sec/);
    expect(sql).toMatch(/runtime_patient_command_notifications/);
  });
});
