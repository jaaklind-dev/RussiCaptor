import type { ClinicalIntegrationInput } from "@/models/ClinicalIntegration";
import type { ResourceAllocationConfiguration } from "@/models/ResourceAllocation";
import type { ResourceAwareInterventionDefinition } from "@/models/ResourceAwareIntervention";
import type { RuntimeState } from "@/models/RuntimeAggregation";
import { RuntimeOwnershipResolver } from "@/services/runtime/OwnershipResolver";
import { aggregateRuntimeState } from "@/services/runtime/AlignedRuntimePipeline";
import { bootstrapRespiratoryFailurePatientProcess, tickRespiratoryFailurePatientProcess } from "@/services/runtime/RespiratoryFailurePatientProcess";
import { airwayInterventionDefinitions } from "@/services/runtime/clinical/AirwayInterventionDefinitions";
import { ClinicalIntegrationFramework } from "@/services/runtime/clinical/ClinicalIntegrationFramework";
import { ClinicalProcessRegistry } from "@/services/runtime/clinical/ClinicalProcessRegistry";
import { InterventionDefinitionRegistry } from "@/services/runtime/clinical/InterventionDefinitionRegistry";
import { ResourceAwareInterventionRuntime } from "@/services/runtime/clinical/ResourceAwareInterventionRuntime";
import { respiratoryFailureClinicalProcessHandler } from "@/services/runtime/clinical/handlers/RespiratoryFailureClinicalProcessHandler";
import { defaultVitalSignConfiguration, VitalSignEngine } from "@/services/runtime/vitals/VitalSignEngine";
import { projectVitalSignState } from "@/services/runtime/vitals/VitalSignProjection";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";

const configuration: ResourceAllocationConfiguration = {
  version: "WP-18/GOLDEN-001", fairness: { ageingIntervalTicks: 10, ageingPriorityStep: 1 },
  resources: [
    { resourceType: "MECHANICAL_VENTILATOR", capacity: 1, allocationMode: "EXCLUSIVE", releaseMode: "ON_INTERVENTION_END" },
    { resourceType: "BVM", capacity: 1, allocationMode: "EXCLUSIVE", releaseMode: "ON_INTERVENTION_END" },
    { resourceType: "OXYGEN_SOURCE", capacity: 1, allocationMode: "EXCLUSIVE", releaseMode: "ON_INTERVENTION_END" },
    { resourceType: "CLINICIAN", capacity: 1, allocationMode: "EXCLUSIVE", releaseMode: "ON_INTERVENTION_END" },
  ],
};

const req = (resourceType: "MECHANICAL_VENTILATOR" | "BVM" | "OXYGEN_SOURCE" | "CLINICIAN") =>
  ({ resourceType, quantity: 1, requiredFor: "DURATION" as const });

const definitions: ResourceAwareInterventionDefinition[] = [
  { definitionId: "MECHANICAL_VENTILATION", resourceRequirements: [req("MECHANICAL_VENTILATOR"), req("OXYGEN_SOURCE"), req("CLINICIAN")] },
  { definitionId: "BAG_VALVE_MASK_VENTILATION", resourceRequirements: [req("BVM"), req("OXYGEN_SOURCE"), req("CLINICIAN")] },
];

function canonicalState(): RuntimeState {
  const vitalSignState = new VitalSignEngine().resolve({ timestamp: 0, configuration: defaultVitalSignConfiguration, contributors: [] }).state;
  return {
    encounterId: "P02", stateVersion: 0, exerciseTimeSec: 0, globalStatus: "Stable",
    ...projectVitalSignState(vitalSignState), vitalSignState, vitalSignConfiguration: defaultVitalSignConfiguration,
    mentalStatusCode: "Alert", symptomTags: [], visibleFindings: [], activeAlerts: [], runtimeFields: {},
    vitalAttribution: {}, statusAttribution: { supportingProcessIds: [] }, manualOverrideActive: false,
    overrideMap: {}, aggregationConfigVersion: "WP-18/GOLDEN-001", randomSeed: 18,
  };
}

function runGolden() {
  const runtime = new ResourceAwareInterventionRuntime(
    configuration, new InterventionDefinitionRegistry(airwayInterventionDefinitions), definitions
  );
  const p01 = runtime.request({
    interventionId: "P01-VENT", definitionId: "MECHANICAL_VENTILATION",
    encounterId: "P01", patientId: "P01", requestedAtTick: 0,
  });
  const p02 = runtime.request({
    interventionId: "P02-BVM", definitionId: "BAG_VALVE_MASK_VENTILATION",
    encounterId: "P02", patientId: "P02", requestedAtTick: 1,
  });
  let process = bootstrapRespiratoryFailurePatientProcess(
    { fixtureId: "FX-WP18-P02", patientId: "P02" },
    { processId: "P02-RF", phenotype: "MIXED", spo2: 90, respiratoryRate: 24, etco2: 48, gcs: 15, workOfBreathing: 30, fatigue: 20 }
  );
  process = tickRespiratoryFailurePatientProcess(process, 60);
  const waitingState = structuredClone(process.clinicalState);
  const release = runtime.release("P01-VENT", 60);
  const effect = runtime.effectsAt(60).find(item => item.patientId === "P02");
  if (!effect) throw new Error("WP-18 Golden P02 Clinical Effect puudub.");
  const integration = new ClinicalIntegrationFramework(new ClinicalProcessRegistry([respiratoryFailureClinicalProcessHandler]));
  const input: ClinicalIntegrationInput = {
    inputId: `INPUT:${effect.effectId}`, encounterId: effect.encounterId, patientId: effect.patientId,
    timestamp: effect.timestamp, inputType: "CLINICAL_EFFECT",
    source: { kind: "INTERVENTION", sourceId: effect.sourceInterventionInstanceId }, payload: effect,
  };
  const applied = integration.apply(input, [process]);
  process = tickRespiratoryFailurePatientProcess(applied.processes[0] as typeof process, 60);
  const canonical = aggregateRuntimeState({
    previous: canonicalState(), expectedStateVersion: 0, exerciseTimeSec: 120,
    processOutputs: [process.outputs], aggregationConfigVersion: "WP-18/GOLDEN-001",
  }, new RuntimeOwnershipResolver([])).state;
  const snapshot = runtime.snapshot();
  const output = {
    initial: { p01: p01.lifecycle.status, p02: p02.lifecycle.status },
    waitingState,
    queueAtRelease: release.allocationsStarted.map(item => ({ interventionId: item.interventionId, effectiveAtTick: item.effectiveAtTick })),
    finalLifecycle: snapshot.lifecycle.map(item => ({ interventionId: item.interventionId, status: item.status, startedAtTick: item.startedAtTick, endedAtTick: item.endedAtTick })),
    finalAvailability: runtime.availability(),
    effect: { type: effect.effectType, patientId: effect.patientId, timestamp: effect.timestamp },
    finalClinicalState: process.clinicalState,
    canonicalVitals: Object.fromEntries(["spo2", "respiratoryRate", "etco2", "gcs"].map(key =>
      [key, canonical.vitalSignState!.readings[key as "spo2"].target]
    )),
    eventSequence: snapshot.allocationState.events.map(item => item.eventType),
  };
  return { output, replayHash: sha256Text(stableJson(output)) };
}

describe("WP-18 focused multi-patient Golden scenario", () => {
  test("scarcity delays P02 treatment until deterministic release and replay is identical", () => {
    const first = runGolden();
    const second = runGolden();
    expect(first).toEqual(second);
    expect(first.output).toMatchObject({
      initial: { p01: "RUNNING", p02: "WAITING_FOR_RESOURCES" },
      waitingState: { spo2: 88.5, respiratoryRate: 25, etco2: 50, fatigue: 23, trend: "WORSENING" },
      queueAtRelease: [{ interventionId: "P02-BVM", effectiveAtTick: 60 }],
      effect: { type: "EFFECTIVE_VENTILATION", patientId: "P02", timestamp: 60 },
      finalClinicalState: { spo2: 91, respiratoryRate: 24, etco2: 47, gcs: 15, fatigue: 22, trend: "IMPROVING" },
      canonicalVitals: { spo2: 91, respiratoryRate: 24, etco2: 47, gcs: 15 },
    });
    expect(first.output.eventSequence).toEqual([
      "ResourceAllocationRequested", "ResourceAllocationSucceeded", "InterventionStartedAfterResourceAllocation",
      "ResourceAllocationRequested", "ResourceAllocationDeferred", "InterventionWaitingForResources",
      "ResourceAllocationReleased", "ResourceQueuePriorityChanged", "ResourceAllocationSucceeded",
      "InterventionStartedAfterResourceAllocation",
    ]);
    expect(first.replayHash).toBe("635339691f5f8e200f214b72a4db52649631c7a6b7431358ec35ec7f731f1a96");
  });
});
