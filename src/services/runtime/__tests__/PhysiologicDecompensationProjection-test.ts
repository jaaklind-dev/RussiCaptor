import type { OwnershipRule } from "@/models/ModuleImport";
import type { ProcessOutput, RuntimeState } from "@/models/RuntimeAggregation";
import { aggregateResolvedRuntimeState } from "../RuntimeAggregationCore";
import { RuntimeOwnershipResolver } from "../OwnershipResolver";
import { DEFAULT_PHYSIOLOGIC_DECOMPENSATION_CONFIG as config, resolvePhysiologicDecompensation } from "../PhysiologicDecompensationEngine";
import { defaultVitalSignConfiguration, VitalSignEngine } from "../vitals/VitalSignEngine";
import { projectVitalSignState } from "../vitals/VitalSignProjection";

const resolver = new RuntimeOwnershipResolver(["mentalStatusCode", "globalStatus"].map(field => ({
  objectType: "RuntimeField", objectOrField: field, canonicalOwner: "CORE_ENGINE",
  contributionAllowedFrom: "All active processes", aggregationOrWriteRule: "MOST_SEVERE",
  conflictAction: "REJECT_UNATTRIBUTED_CHANGE",
})) as OwnershipRule[]);

function monitor(sbp = 120, dbp = 75, hr = 80, spo2 = 98) {
  const values = { systolicBp: sbp, diastolicBp: dbp, heartRate: hr, spo2 } as const;
  return new VitalSignEngine().resolve({ timestamp: 0, configuration: defaultVitalSignConfiguration,
    contributors: Object.entries(values).map(([vital, value]) => ({ contributorId: vital,
      sourceType: "PATIENT_PROCESS" as const, sourceId: "LOCAL", layer: "PROCESS" as const,
      vital: vital as keyof typeof values, operation: "TARGET" as const, value })),
  }).state;
}

function initial(enabled = true): RuntimeState {
  const vitalSignState = monitor();
  return { encounterId: "LOCAL", stateVersion: 0, exerciseTimeSec: 0, globalStatus: "Stable",
    ...projectVitalSignState(vitalSignState), vitalSignState, mentalStatusCode: "Alert",
    symptomTags: [], visibleFindings: [], activeAlerts: [], runtimeFields: {}, vitalAttribution: {},
    statusAttribution: { supportingProcessIds: [] }, manualOverrideActive: false, overrideMap: {},
    aggregationConfigVersion: "LOCAL", randomSeed: 1,
    ...(enabled ? { physiologicDecompensationConfig: config,
      physiologicDecompensation: { clinicalState: "ALIVE" as const, gcsCause: "NONE" as const } } : {}),
  };
}

function aggregate(vitals = monitor(), previous = initial(), at = 0, processOutputs: ProcessOutput[] = []) {
  return aggregateResolvedRuntimeState({ previous, expectedStateVersion: previous.stateVersion,
    exerciseTimeSec: at, processOutputs, aggregationConfigVersion: "LOCAL" }, resolver,
  { state: vitals, configuration: defaultVitalSignConfiguration, attribution: {}, events: [], acceptedOverrideFields: [] });
}
const output = (value: Partial<ProcessOutput>): ProcessOutput => ({ processId: "LOCAL-PROCESS", encounterId: "LOCAL",
  moduleId: "BOTULISM_V1", status: "Active", globalSeverityScore: 1, ...value });

test("recorded isolated hypoperfusion cannot be Stable or Alert at GCS11", () => {
  const result = aggregate(monitor(56.41, 39.44, 171.5, 97));
  expect(result.state).toMatchObject({ globalStatus: "Critical", mentalStatusCode: "Obtunded",
    physiologicDecompensation: { clinicalState: "CRITICAL", gcsCause: "HYPOPERFUSION" },
    vitalSignState: { avpu: "PAIN", readings: { gcs: { current: 11 } } } });
});

test("numeric circulation and oxygenation are not altered to obtain a status", () => {
  const input = monitor(56.41, 39.44, 171.5, 97); const result = aggregate(input);
  for (const vital of ["systolicBp", "diastolicBp", "heartRate", "spo2", "respiratoryRate"] as const) {
    expect(result.state.vitalSignState!.readings[vital]).toEqual(input.readings[vital]);
  }
  expect(result.state.vitalSignState!.derived).toEqual(input.derived);
});

test("VOICE projects to a non-alert mental state using the existing response band", () => {
  const result = aggregate(monitor(65, 35, 120, 88));
  expect(result.state.vitalSignState!.avpu).toBe("VOICE");
  expect(result.state.mentalStatusCode).toBe("Drowsy");
});

test("healthy recovery clears mental impairment and retains the existing120s critical hysteresis", () => {
  const impaired = aggregate(monitor(56.41, 39.44, 171.5, 97)).state;
  const recovering = aggregate(monitor(), impaired, 60).state;
  expect(recovering).toMatchObject({ globalStatus: "Critical", mentalStatusCode: "Alert", criticalClearSinceSec: 60,
    physiologicDecompensation: { clinicalState: "ALIVE" }, vitalSignState: { readings: { gcs: { current: 15 } } } });
  expect(aggregate(monitor(), recovering, 179).state.globalStatus).toBe("Critical");
  expect(aggregate(monitor(), recovering, 180).state.globalStatus).toBe("Stable");
});

test("physiologic recovery cannot weaken a more severe process mental ceiling", () => {
  expect(aggregate(monitor(), initial(), 0, [output({ mentalStatusCeiling: "Unresponsive" })]).state.mentalStatusCode)
    .toBe("Unresponsive");
});

test("a process-proposed Arrest is not downgraded to Critical by impaired perfusion", () => {
  const result = aggregate(monitor(56.41, 39.44, 171.5, 97), initial(), 0, [output({ statusProposal: "Arrest" })]);
  expect(result.state).toMatchObject({ globalStatus: "Arrest", mentalStatusCode: "Arrest" });
});

test("DEAD projects Unresponsive and cannot be resurrected by a healthy later monitor", () => {
  const began = aggregate(monitor(30, 15, 160, 55)).state;
  const dead = aggregate(monitor(30, 15, 160, 55), began, 600).state;
  expect(dead).toMatchObject({ globalStatus: "Dead", mentalStatusCode: "Unresponsive",
    vitalSignState: { avpu: "UNRESPONSIVE", readings: { gcs: { current: 3 }, heartRate: { current: 0 } } } });
  const later = aggregate(monitor(), dead, 900).state;
  expect(later).toMatchObject({ globalStatus: "Dead", mentalStatusCode: "Unresponsive",
    physiologicDecompensation: { clinicalState: "DEAD" } });
});

test("model-disabled legacy patients keep their prior projection behavior", () => {
  const previous = initial(false); const result = aggregate(monitor(56.41, 39.44, 171.5, 97), previous);
  expect(result.state).toMatchObject({ globalStatus: "Stable", mentalStatusCode: "Alert" });
  expect(result.state.physiologicDecompensation).toBeUndefined();
});

test("terminal and death deadlines remain300 and600s, not the new response classification", () => {
  const vitals = monitor(30, 15, 160, 55);
  const resolve = (at: number) => resolvePhysiologicDecompensation({ monitor: vitals, config,
    simulationTimeSec: at, previousStatus: "Stable", previous: { clinicalState: "CRITICAL", gcsCause: "COMBINED", profoundFailureSinceSec: 0 } });
  expect(resolve(299).state.clinicalState).toBe("CRITICAL");
  expect(resolve(300).state.clinicalState).toBe("TERMINAL");
  expect(resolve(599).state.clinicalState).toBe("TERMINAL");
  expect(resolve(600).state.clinicalState).toBe("DEAD");
});

test("impaired response alone does not invent a profound-failure clock or automatic death", () => {
  const vitals = monitor(56.41, 39.44, 171.5, 97);
  const resolved = resolvePhysiologicDecompensation({ monitor: vitals, config, simulationTimeSec: 7200, previousStatus: "Stable" });
  expect(resolved.state).toMatchObject({ clinicalState: "CRITICAL", profoundFailureSinceSec: undefined });
});
