import type { CirculationState } from "@/models/CirculationState";
import type { GoldenInputEvent } from "@/models/GoldenTest";
import type { HemorrhagePatientProcessRuntime } from "@/models/HemorrhagePatientProcess";
import {
  NOREPINEPHRINE_DOSE_UNIT,
  type NorepinephrineCommand,
} from "@/models/NorepinephrineInfusion";
import { getPatientResourceDebugSnapshot } from "@/services/ResourceRuntimeDebugService";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { mtpReferenceFixture, pressureDependentHemorrhageFixture } from "@/services/exercise/CanonicalPatientDatasets";
import {
  DEFAULT_NOREPINEPHRINE_CONFIGURATION,
  NorepinephrineInfusionRuntime,
  norepinephrineClinicalFeatureContract,
  norepinephrineEffectAt,
  norepinephrineTargetEffect,
} from "@/services/runtime/medication/NorepinephrineInfusion";

const patientId = "PT-PELVIC-001";
const circulation: CirculationState = {
  patientId,
  vascularAccess: [{
    interventionInstanceId: "IV-1",
    type: "PERIPHERAL_IV",
    resourceIds: ["PIV-1"],
    establishedAt: 0,
  }],
  hemorrhageControl: [],
  runningInfusions: [],
  updatedAt: 0,
};

const command = (
  action: NorepinephrineCommand["action"],
  commandId: string,
  simulationTimeSec: number,
  doseMicrogramsPerKgMin?: number,
): NorepinephrineCommand => ({
  commandId,
  action,
  infusionId: "NE-INF-1",
  patientId,
  simulationTimeSec,
  ...(action === "START" ? { vascularAccessId: "IV-1" } : {}),
  ...(action === "STOP" ? {} : { doseMicrogramsPerKgMin, unit: NOREPINEPHRINE_DOSE_UNIT }),
});

const tick = (time: number, id = `TICK-${time}`): GoldenInputEvent => ({
  sequenceId: "NOREPINEPHRINE",
  step: time,
  offsetSec: time,
  eventType: "ENGINE_TICK",
  actor: "ENGINE",
  target: patientId,
  eventId: id,
  result: "SUCCESS",
  payload: { tickMin: 1 },
});

function engineWithAccess(): ClinicalScenarioEngine {
  const engine = new ClinicalScenarioEngine();
  engine.reset(mtpReferenceFixture);
  engine.scheduleIntervention({
    interventionId: "PIV-NOREPI",
    patientId,
    resourceId: "PIV-1",
    action: "APPLY",
    timestamp: 0,
    definitionId: "PERIPHERAL_IV_ACCESS",
    parameters: { location: "arm", gauge: 18, attempts: 1 },
  });
  engine.applyScheduledResourceInterventionsAtCurrentTime();
  engine.advanceTo(180);
  engine.dispatch(tick(180));
  return engine;
}

describe("Clinical Feature Contract and norepinephrine infusion", () => {
  test("declares a reusable deterministic authoritative feature contract", () => {
    expect(norepinephrineClinicalFeatureContract).toMatchObject({
      featureId: "NOREPINEPHRINE",
      category: "MEDICATION",
      schemaVersion: 1,
      determinism: { clock: "SIMULATION_TIME", wallClockAllowed: false },
      persistence: { boundary: "RUNTIME_CHECKPOINT", detached: true },
      idempotency: { key: "COMMAND_ID", duplicateEffectAllowed: false },
      visibility: { assessment: true, debug: true },
      regressionIsolation: { absentFeatureChangesBaseline: false },
    });
    expect(norepinephrineClinicalFeatureContract.physiology.order).toEqual([
      "UNDERLYING_PHYSIOLOGY",
      "HEMORRHAGE_SOURCE_CONTROL",
      "VOLUME_RESUSCITATION",
      "VASOPRESSOR",
      "FINAL_HEMODYNAMICS",
    ]);
  });

  test("dose response is finite, bounded and monotonic across supported extremes", () => {
    const doses = [0, 0.01, 0.1, 0.5, 2];
    const effects = doses.map(value => norepinephrineTargetEffect(value));
    expect(effects[0]).toEqual({ systolicIncreaseMmHg: 0, diastolicIncreaseMmHg: 0 });
    expect(effects.every(effect => Number.isFinite(effect.systolicIncreaseMmHg) &&
      Number.isFinite(effect.diastolicIncreaseMmHg) && effect.systolicIncreaseMmHg >= 0 &&
      effect.diastolicIncreaseMmHg >= 0 &&
      effect.systolicIncreaseMmHg <= DEFAULT_NOREPINEPHRINE_CONFIGURATION.maximumSystolicIncreaseMmHg &&
      effect.diastolicIncreaseMmHg <= DEFAULT_NOREPINEPHRINE_CONFIGURATION.maximumDiastolicIncreaseMmHg)).toBe(true);
    expect(effects.map(effect => effect.systolicIncreaseMmHg)).toEqual(
      [...effects].map(effect => effect.systolicIncreaseMmHg).sort((a, b) => a - b),
    );
  });

  test.each([
    [Number.NaN, NOREPINEPHRINE_DOSE_UNIT, "INVALID_DOSE"],
    [Number.POSITIVE_INFINITY, NOREPINEPHRINE_DOSE_UNIT, "INVALID_DOSE"],
    [-0.01, NOREPINEPHRINE_DOSE_UNIT, "INVALID_DOSE"],
    [2.01, NOREPINEPHRINE_DOSE_UNIT, "INVALID_DOSE"],
    [0.1, "MCG_MIN", "INVALID_UNIT"],
  ])("rejects invalid dose/unit input %s %s", (dose, unit, expected) => {
    const runtime = new NorepinephrineInfusionRuntime();
    const invalid = { ...command("START", `INVALID-${String(dose)}-${unit}`, 0, dose), unit };
    expect(runtime.execute(invalid, circulation)).toMatchObject({ status: "REJECTED", rejectionReason: expected });
  });

  test("requires canonical IV access and accepts peripheral or central access", () => {
    const missing = new NorepinephrineInfusionRuntime();
    expect(missing.execute(command("START", "NO-IV", 0, 0.1), { ...circulation, vascularAccess: [] }))
      .toMatchObject({ status: "REJECTED", rejectionReason: "MISSING_VASCULAR_ACCESS" });
    const ioOnly = { ...circulation, vascularAccess: [{ ...circulation.vascularAccess[0], type: "IO" as const }] };
    expect(new NorepinephrineInfusionRuntime().execute(command("START", "IO", 0, 0.1), ioOnly))
      .toMatchObject({ status: "REJECTED", rejectionReason: "MISSING_VASCULAR_ACCESS" });
    const central = { ...circulation, vascularAccess: [{ ...circulation.vascularAccess[0], type: "CENTRAL_ACCESS" as const }] };
    expect(new NorepinephrineInfusionRuntime().execute(command("START", "CENTRAL", 0, 0.1), central).status).toBe("APPLIED");
  });

  test("start is command-idempotent and a second active infusion is rejected", () => {
    const runtime = new NorepinephrineInfusionRuntime();
    const start = command("START", "START-1", 0, 0.1);
    expect(runtime.execute(start, circulation).status).toBe("APPLIED");
    expect(runtime.execute(start, circulation).status).toBe("IDEMPOTENT");
    expect(runtime.snapshot()?.infusions).toHaveLength(1);
    expect(runtime.snapshot()?.events.filter(event => event.eventType === "NorepinephrineInfusionStarted")).toHaveLength(1);
    expect(runtime.execute({ ...start, commandId: "START-2", infusionId: "NE-INF-2" }, circulation))
      .toMatchObject({ status: "REJECTED", rejectionReason: "ALREADY_ACTIVE" });
  });

  test("dose change continues from current effect and duplicate command does not double-apply", () => {
    const runtime = new NorepinephrineInfusionRuntime();
    runtime.execute(command("START", "START", 0, 0.1), circulation);
    const before = norepinephrineEffectAt(runtime.snapshot()!.infusions[0], 60);
    const changed = command("CHANGE_DOSE", "CHANGE", 60, 0.5);
    expect(runtime.execute(changed).status).toBe("APPLIED");
    expect(runtime.execute(changed).status).toBe("IDEMPOTENT");
    const state = runtime.snapshot()!.infusions[0];
    expect(state.transition).toMatchObject({
      startedAtSimulationTimeSec: 60,
      fromSystolicIncreaseMmHg: before.systolicIncreaseMmHg,
      fromDiastolicIncreaseMmHg: before.diastolicIncreaseMmHg,
    });
    expect(runtime.snapshot()!.events.filter(event => event.eventType === "NorepinephrineDoseChanged")).toHaveLength(1);
  });

  test("stop decays deterministically and repeated stop is safe", () => {
    const runtime = new NorepinephrineInfusionRuntime();
    runtime.execute(command("START", "START", 0, 0.2), circulation);
    const stopped = command("STOP", "STOP", 120);
    expect(runtime.execute(stopped).status).toBe("APPLIED");
    expect(runtime.execute(stopped).status).toBe("IDEMPOTENT");
    expect(runtime.snapshot()!.infusions[0].status).toBe("STOPPING");
    expect(norepinephrineEffectAt(runtime.snapshot()!.infusions[0], 180).systolicIncreaseMmHg).toBeGreaterThan(0);
    const events = runtime.advanceTo(999);
    expect(events).toContainEqual(expect.objectContaining({
      eventType: "NorepinephrineInfusionStopped",
      timestamp: 240,
    }));
    expect(runtime.snapshot()!.infusions[0].status).toBe("STOPPED");
    expect(runtime.execute(command("STOP", "STOP-2", 999)).status).toBe("NO_OP");
  });

  test("runtime snapshot round-trips start, dose change, stop and idempotency evidence", () => {
    const original = new NorepinephrineInfusionRuntime();
    original.execute(command("START", "START", 0, 0.1), circulation);
    original.execute(command("CHANGE_DOSE", "CHANGE", 90, 0.4));
    original.execute(command("STOP", "STOP", 180));
    const snapshot = original.snapshot()!;
    const restored = new NorepinephrineInfusionRuntime();
    restored.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.projectionsAt(210)).toEqual(original.projectionsAt(210));
    expect(restored.execute(command("STOP", "STOP", 180)).status).toBe("IDEMPOTENT");
  });

  test("ScenarioEngine checkpoint rehydrate preserves treatment, effect, SBP, MAP and HR", () => {
    const engine = engineWithAccess();
    const accessId = engine.getCirculationState(patientId).vascularAccess[0].interventionInstanceId;
    const startCommand = {
      ...command("START", "START-SCENARIO", 180, 0.2),
      vascularAccessId: accessId,
    };
    expect(engine.executeNorepinephrineCommand(startCommand).status).toBe("APPLIED");
    expect(engine.executeNorepinephrineCommand(startCommand).status).toBe("IDEMPOTENT");
    expect(engine.getEventLog().filter(event => event.eventType === "NorepinephrineInfusionStarted")).toHaveLength(1);
    engine.advanceTo(300);
    engine.dispatch(tick(300));
    const before = engine.getRuntimeState();
    const payload = engine.captureRuntimePayload();
    const restored = new ClinicalScenarioEngine();
    restored.rehydrateRuntimePayload(payload);
    expect(restored.getNorepinephrineState()).toEqual(engine.getNorepinephrineState());
    expect(restored.getRuntimeState().vitalSignState).toEqual(before.vitalSignState);
    expect(restored.getRuntimeState().mapCalculated).toBe(before.mapCalculated);
    expect(restored.getRuntimeState().displayedVitals.hr).toBe(before.displayedVitals.hr);
    expect(restored.captureRuntimePayload()).toEqual(payload);

    expect(restored.executeNorepinephrineCommand(command("CHANGE_DOSE", "CHANGE-SCENARIO", 300, 0.5)).status)
      .toBe("APPLIED");
    const changedPayload = restored.captureRuntimePayload();
    const changedRestart = new ClinicalScenarioEngine();
    changedRestart.rehydrateRuntimePayload(changedPayload);
    expect(changedRestart.captureRuntimePayload()).toEqual(changedPayload);
    expect(changedRestart.getNorepinephrineState()).toEqual(restored.getNorepinephrineState());

    expect(changedRestart.executeNorepinephrineCommand(command("STOP", "STOP-SCENARIO", 300)).status).toBe("APPLIED");
    const stoppedPayload = changedRestart.captureRuntimePayload();
    const stoppedRestart = new ClinicalScenarioEngine();
    stoppedRestart.rehydrateRuntimePayload(stoppedPayload);
    expect(stoppedRestart.captureRuntimePayload()).toEqual(stoppedPayload);
    expect(stoppedRestart.getNorepinephrineState()).toEqual(changedRestart.getNorepinephrineState());
  });

  test("assessment and resource debug snapshots expose detached treatment state", () => {
    const engine = engineWithAccess();
    const accessId = engine.getCirculationState(patientId).vascularAccess[0].interventionInstanceId;
    engine.executeNorepinephrineCommand({
      ...command("START", "VISIBLE", 180, 0.15),
      vascularAccessId: accessId,
    });
    expect(engine.getAssessmentSnapshot().clinicalFeatures).toContainEqual(expect.objectContaining({
      featureId: "NOREPINEPHRINE",
      doseMicrogramsPerKgMin: 0.15,
      status: "RUNNING",
    }));
    expect(getPatientResourceDebugSnapshot(patientId).medicationState?.clinicalFeatures)
      .toContainEqual(expect.objectContaining({ featureId: "NOREPINEPHRINE" }));
    const detached = engine.getNorepinephrineState().map(item => ({ ...item }));
    detached[0].doseMicrogramsPerKgMin = 999;
    expect(engine.getNorepinephrineState()[0].doseMicrogramsPerKgMin).toBe(0.15);
  });

  test("no-drug baseline remains byte-for-byte deterministic", () => {
    const first = new ClinicalScenarioEngine();
    const second = new ClinicalScenarioEngine();
    first.reset(mtpReferenceFixture);
    second.reset(mtpReferenceFixture);
    [60, 120, 180].forEach(time => {
      first.advanceTo(time); first.dispatch(tick(time, `BASE-A-${time}`));
      second.advanceTo(time); second.dispatch(tick(time, `BASE-A-${time}`));
    });
    expect(first.captureRuntimePayload()).toEqual(second.captureRuntimePayload());
    expect(first.getRuntimeState()).toEqual(second.getRuntimeState());
    expect(first.getHashes()).toEqual(second.getHashes());
    expect(first.captureRuntimePayload().medication).not.toHaveProperty("norepinephrine");
  });

  test("pelvic hemorrhage responds only through the normal SBP-dependent path", () => {
    const treated = new ClinicalScenarioEngine();
    const control = new ClinicalScenarioEngine();
    treated.reset(pressureDependentHemorrhageFixture);
    control.reset(pressureDependentHemorrhageFixture);
    treated.scheduleIntervention({ interventionId: "PIV-NOREPI", patientId: "PT-DECOMP-01", resourceId: "PIV-1",
      action: "APPLY", timestamp: 0, definitionId: "PERIPHERAL_IV_ACCESS",
      parameters: { location: "arm", gauge: 18, attempts: 1 } });
    treated.applyScheduledResourceInterventionsAtCurrentTime();
    for (const time of [60, 120, 180]) {
      treated.advanceTo(time); treated.dispatch({ ...tick(time, `TREATED-${time}`), target: "PT-DECOMP-01" });
      control.advanceTo(time); control.dispatch({ ...tick(time, `CONTROL-${time}`), target: "PT-DECOMP-01" });
    }
    const accessId = treated.getCirculationState("PT-DECOMP-01").vascularAccess[0].interventionInstanceId;
    treated.executeNorepinephrineCommand({ ...command("START", "PELVIC-START", 180, 2),
      patientId: "PT-DECOMP-01", vascularAccessId: accessId });
    for (const time of [240, 300, 360]) {
      treated.advanceTo(time); treated.dispatch({ ...tick(time, `TREATED-${time}`), target: "PT-DECOMP-01" });
      control.advanceTo(time); control.dispatch({ ...tick(time, `CONTROL-${time}`), target: "PT-DECOMP-01" });
    }
    const treatedHemorrhage = treated.getPatientProcesses().find(
      (item): item is HemorrhagePatientProcessRuntime => item.processType === "HEMORRHAGE",
    )!;
    const controlHemorrhage = control.getPatientProcesses().find(
      (item): item is HemorrhagePatientProcessRuntime => item.processType === "HEMORRHAGE",
    )!;
    expect(treated.getRuntimeState().displayedVitals.sbp).toBeGreaterThan(control.getRuntimeState().displayedVitals.sbp!);
    expect(treated.getRuntimeState().mapCalculated).toBeGreaterThan(control.getRuntimeState().mapCalculated!);
    expect(Number.isFinite(treated.getRuntimeState().displayedVitals.hr)).toBe(true);
    expect(treated.getRuntimeState().vitalSignState?.activeContributors.some(contributor =>
      contributor.layer === "MEDICATION" && contributor.vital === "heartRate")).toBe(false);
    expect(treatedHemorrhage.configuration).toEqual(controlHemorrhage.configuration);
    expect(treatedHemorrhage.clinicalState.bleedingRateMlMin).toBeGreaterThanOrEqual(
      controlHemorrhage.clinicalState.bleedingRateMlMin,
    );
    expect(treated.getNorepinephrineState()[0].currentSystolicIncreaseMmHg).toBeLessThanOrEqual(50);
  });
});
