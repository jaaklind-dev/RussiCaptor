import type { ClinicalEffect, ClinicalIntegrationInput } from "@/models/ClinicalIntegration";
import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import type { RuntimeResource } from "@/models/ResourceRuntime";
import type { HypoxiaPatientProcessRuntime } from "@/models/PatientProcessRuntime";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { bootstrapHvPatientProcess } from "@/services/runtime/HvPatientProcess";
import { bootstrapHypoxiaPatientProcess } from "@/services/runtime/HypoxiaPatientProcess";
import { ClinicalIntegrationFramework } from "@/services/runtime/clinical/ClinicalIntegrationFramework";
import { ClinicalProcessRegistry } from "@/services/runtime/clinical/ClinicalProcessRegistry";
import { InterventionDefinitionRegistry } from "@/services/runtime/clinical/InterventionDefinitionRegistry";
import { InterventionRuntime } from "@/services/runtime/clinical/InterventionRuntime";
import { oxygenTherapyDefinition } from "@/services/runtime/clinical/OxygenTherapyDefinition";
import { hvClinicalProcessHandler } from "@/services/runtime/clinical/handlers/HvClinicalProcessHandler";
import { hypoxiaClinicalProcessHandler } from "@/services/runtime/clinical/handlers/HypoxiaClinicalProcessHandler";

const fixture: GoldenFixture = {
  fixtureId: "FX-WP10", fixtureType: "PROCESS", patientId: "PT-WP10", seed: 10,
  clockState: "RUNNING", ownershipVersion: 1,
  loadedModules: ["HYPOVENTILATION_HYPERCAPNIA_V1", "HYPOXIA_V1"],
  activeResources: {},
  initialState: {
    processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV",
    ventilationReserve: 60, reserveLossPerMin: 0, co2Burden: 30, co2GainPerMin: 0,
  },
};

function oxygenEffect(id = "E-1"): ClinicalEffect {
  return {
    effectId: id, effectType: "INSPIRED_OXYGEN_INCREASED", encounterId: "PT-WP10",
    patientId: "PT-WP10", timestamp: 1, sourceInterventionInstanceId: "O2:INSTANCE",
    parameters: { flowRateLMin: 15, deliveryInterface: "oxygenMask" },
  };
}

function input(effect = oxygenEffect()): ClinicalIntegrationInput {
  return {
    inputId: `INPUT:${effect.effectId}`, encounterId: effect.encounterId, patientId: effect.patientId,
    timestamp: effect.timestamp, inputType: "CLINICAL_EFFECT",
    source: { kind: "INTERVENTION", sourceId: effect.sourceInterventionInstanceId }, payload: effect,
  };
}

describe("WP-10 Clinical Integration Framework", () => {
  test("handler registration order does not change process results", () => {
    const hv = bootstrapHvPatientProcess(fixture);
    const hypoxia = bootstrapHypoxiaPatientProcess(fixture, { spo2: 88 }, {
      processId: hv.processId, processType: hv.processType, instanceKey: hv.instanceKey,
    });
    const first = new ClinicalIntegrationFramework(
      new ClinicalProcessRegistry([hvClinicalProcessHandler, hypoxiaClinicalProcessHandler])
    ).apply(input(), [hypoxia, hv]);
    const second = new ClinicalIntegrationFramework(
      new ClinicalProcessRegistry([hypoxiaClinicalProcessHandler, hvClinicalProcessHandler])
    ).apply(input(), [hv, hypoxia]);
    expect(first.status).toBe("APPLIED");
    expect(second.processes).toEqual(first.processes);
    expect(second.events).toEqual(first.events);
    expect(first.processes.every(process => process.clinicalState.oxygenTherapyActive)).toBe(true);
  });

  test("duplicate input is a no-op and rejection does not mutate processes", () => {
    const hv = bootstrapHvPatientProcess(fixture);
    const framework = new ClinicalIntegrationFramework(new ClinicalProcessRegistry([hvClinicalProcessHandler]));
    const applied = framework.apply(input(), [hv]);
    expect(framework.apply(input(), applied.processes)).toMatchObject({ status: "NO_OP", events: [] });
    const mismatched = input({ ...oxygenEffect("E-2"), encounterId: "OTHER" });
    const rejected = framework.apply(mismatched, applied.processes);
    expect(rejected).toMatchObject({ status: "REJECTED", rejection: { reasonCode: "ENCOUNTER_MISMATCH" } });
    expect(rejected.processes).toEqual(applied.processes);
  });
});

describe("WP-10 InterventionDefinition and InterventionInstance", () => {
  const mask: RuntimeResource = {
    resourceId: "MASK-1", type: "oxygenMask", status: "RESERVED",
    assignedPatientId: "PT-WP10", metadata: {},
  };

  test("oxygen definition validates parameters and running lifecycle emits mechanism effects", () => {
    const definitions = new InterventionDefinitionRegistry([oxygenTherapyDefinition]);
    expect(definitions.normalizeParameters(oxygenTherapyDefinition, {})).toEqual({
      flowRateLMin: 15, deliveryInterface: "oxygenMask",
    });
    expect(() => definitions.normalizeParameters(oxygenTherapyDefinition, { flowRateLMin: 20 }))
      .toThrow("lubatud vahemikust väljas");

    const runtime = new InterventionRuntime(definitions);
    const started = runtime.consumeResourceEvent({
      eventType: "InterventionApplied", timestamp: 1, resourceId: "MASK-1",
      patientId: "PT-WP10", interventionId: "O2-APPLY", definitionId: "OXYGEN_THERAPY",
      parameters: { flowRateLMin: 15, deliveryInterface: "oxygenMask" },
    }, "PT-WP10", [mask]);
    expect(started).toMatchObject({ status: "RUNNING", definitionId: "OXYGEN_THERAPY" });
    expect(runtime.effectsAt(1)).toEqual([expect.objectContaining({
      effectType: "INSPIRED_OXYGEN_INCREASED", parameters: { flowRateLMin: 15, deliveryInterface: "oxygenMask" },
    })]);
    const cancelled = runtime.consumeResourceEvent({
      eventType: "InterventionRemoved", timestamp: 2, resourceId: "MASK-1",
      patientId: "PT-WP10", interventionId: "O2-REMOVE",
    }, "PT-WP10", [{ ...mask, status: "AVAILABLE", assignedPatientId: undefined }]);
    expect(cancelled).toMatchObject({ status: "CANCELLED", endedAt: 2 });
    expect(runtime.effectsAt(2)).toEqual([]);
  });
});

function tick(id: string, time: number): GoldenInputEvent {
  return {
    sequenceId: "SEQ-WP10", step: time, offsetSec: time, eventType: "ENGINE_TICK",
    actor: "ENGINE", target: "PT-WP10", eventId: id, result: "SUCCESS", payload: { tickMin: 1 },
  };
}

function scenarioReplay(): ClinicalScenarioEngine {
  const engine = new ClinicalScenarioEngine();
  engine.reset({
    ...fixture,
    activeResources: { resources: [{ resourceId: "MASK-1", type: "oxygenMask", status: "AVAILABLE", metadata: {} }] },
    initialState: { ...fixture.initialState as object, hypoxia: { spo2: 88, oxygenationReserve: 55 } },
  });
  engine.scheduleIntervention({
    interventionId: "O2-APPLY", patientId: "PT-WP10", resourceId: "MASK-1",
    action: "APPLY", timestamp: 1, definitionId: "OXYGEN_THERAPY", parameters: { flowRateLMin: 15 },
  });
  engine.scheduleIntervention({
    interventionId: "O2-REMOVE", patientId: "PT-WP10", resourceId: "MASK-1",
    action: "REMOVE", timestamp: 2,
  });
  engine.advanceTo(1);
  engine.dispatch(tick("TICK-1", 1));
  engine.advanceTo(2);
  engine.dispatch(tick("TICK-2", 2));
  return engine;
}

describe("WP-10 ScenarioEngine clinical integration", () => {
  test("oxygen therapy drives Hypoxia through effects and replay stays deterministic", () => {
    const first = scenarioReplay();
    const second = scenarioReplay();
    const hypoxia = first.getPatientProcesses().find(
      process => process.processType === "HYPOXIA"
    ) as HypoxiaPatientProcessRuntime | undefined;
    expect(hypoxia?.clinicalState.oxygenTherapyActive).toBe(false);
    expect(hypoxia?.clinicalState.spo2).toBe(89);
    expect(first.getInterventionInstances()).toContainEqual(expect.objectContaining({
      definitionId: "OXYGEN_THERAPY", status: "CANCELLED", parameters: expect.objectContaining({ flowRateLMin: 15 }),
    }));
    expect(first.getEventLog()).toEqual(second.getEventLog());
    expect(first.getPatientProcesses()).toEqual(second.getPatientProcesses());
    expect(first.getRuntimeState()).toEqual(second.getRuntimeState());
    expect(first.getHashes()).toEqual(second.getHashes());
  });
});
