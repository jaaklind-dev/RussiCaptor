import type { ClinicalEffect, ClinicalIntegrationInput } from "@/models/ClinicalIntegration";
import type { RuntimeState } from "@/models/RuntimeAggregation";
import { aggregateRuntimeState } from "@/services/runtime/AlignedRuntimePipeline";
import { RuntimeOwnershipResolver } from "@/services/runtime/OwnershipResolver";
import {
  bootstrapRespiratoryFailurePatientProcess,
  defaultRespiratoryFailureConfiguration,
  tickRespiratoryFailurePatientProcess,
} from "@/services/runtime/RespiratoryFailurePatientProcess";
import { ClinicalIntegrationFramework } from "@/services/runtime/clinical/ClinicalIntegrationFramework";
import { ClinicalProcessRegistry } from "@/services/runtime/clinical/ClinicalProcessRegistry";
import { respiratoryFailureClinicalProcessHandler } from "@/services/runtime/clinical/handlers/RespiratoryFailureClinicalProcessHandler";
import { defaultVitalSignConfiguration, VitalSignEngine } from "@/services/runtime/vitals/VitalSignEngine";
import { projectVitalSignState } from "@/services/runtime/vitals/VitalSignProjection";

const fixture = { fixtureId: "FX-RF-1", patientId: "PT-RF-1" };

function process(phenotype: "HYPOXAEMIC" | "HYPERCAPNIC" | "MIXED" = "MIXED") {
  return bootstrapRespiratoryFailurePatientProcess(fixture, {
    processId: "RF-1", phenotype, spo2: 90, respiratoryRate: 24,
    etco2: 48, gcs: 15, workOfBreathing: 30, fatigue: 20,
  });
}

function canonicalState(): RuntimeState {
  const vitalSignState = new VitalSignEngine().resolve({
    timestamp: 0, configuration: defaultVitalSignConfiguration, contributors: [],
  }).state;
  return {
    encounterId: "PT-RF-1", stateVersion: 0, exerciseTimeSec: 0, globalStatus: "Stable",
    ...projectVitalSignState(vitalSignState), vitalSignState,
    vitalSignConfiguration: defaultVitalSignConfiguration, mentalStatusCode: "Alert",
    symptomTags: [], visibleFindings: [], activeAlerts: [], runtimeFields: {},
    vitalAttribution: {}, statusAttribution: { supportingProcessIds: [] },
    manualOverrideActive: false, overrideMap: {}, aggregationConfigVersion: "WP-17", randomSeed: 17,
  };
}

function effect(effectId: string, effectType: ClinicalEffect["effectType"], parameters: ClinicalEffect["parameters"] = {}): ClinicalEffect {
  return {
    effectId, effectType, encounterId: "PT-RF-1", patientId: "PT-RF-1", timestamp: 60,
    sourceInterventionInstanceId: `INTERVENTION:${effectId}`, parameters,
  };
}

function clinicalInput(payload: ClinicalEffect): ClinicalIntegrationInput {
  return {
    inputId: `INPUT:${payload.effectId}`, encounterId: payload.encounterId,
    patientId: payload.patientId, timestamp: payload.timestamp, inputType: "CLINICAL_EFFECT",
    source: { kind: "INTERVENTION", sourceId: payload.sourceInterventionInstanceId }, payload,
  };
}

describe("WP-17 Respiratory Failure PatientProcess", () => {
  test.each([
    ["HYPOXAEMIC", 88.5, 48],
    ["HYPERCAPNIC", 90, 50],
    ["MIXED", 88.5, 50],
  ] as const)("models deterministic %s deterioration through configured progression", (phenotype, spo2, etco2) => {
    const result = tickRespiratoryFailurePatientProcess(process(phenotype), 60);
    expect(result.clinicalState).toMatchObject({ spo2, etco2, respiratoryRate: 25, trend: "WORSENING" });
    expect(result.outputs.vitalContributions).toEqual([
      { vital: "spo2", operation: "TARGET", value: spo2 },
      { vital: "respiratoryRate", operation: "TARGET", value: 25 },
      { vital: "etco2", operation: "TARGET", value: etco2 },
      { vital: "gcs", operation: "TARGET", value: 14.75 },
    ]);
    expect(result.outputs).not.toHaveProperty("hrTargetRange");
    expect(result.outputs).not.toHaveProperty("sbpTargetRange");
  });

  test("canonical pipeline resolves contributors, derived AVPU and read-only projections", () => {
    const deteriorated = tickRespiratoryFailurePatientProcess(process(), 240);
    const result = aggregateRuntimeState({
      previous: canonicalState(), expectedStateVersion: 0, exerciseTimeSec: 240,
      processOutputs: [deteriorated.outputs], aggregationConfigVersion: "WP-17",
    }, new RuntimeOwnershipResolver([]));
    expect(result.state.vitalSignState?.readings).toMatchObject({
      spo2: { target: 84 }, respiratoryRate: { target: 28 }, etco2: { target: 56 }, gcs: { target: 14 },
    });
    expect(result.state.vitalSignState?.avpu).toBe("VOICE");
    expect(result.state.displayedVitals.spo2).toBe(result.state.vitalSignState?.readings.spo2.current);
    expect(result.state.vitalSignState?.activeContributors.every(item => item.sourceType === "PATIENT_PROCESS")).toBe(true);
  });

  test("oxygen and ventilation effects reach the process through ClinicalIntegrationFramework", () => {
    const framework = new ClinicalIntegrationFramework(
      new ClinicalProcessRegistry([respiratoryFailureClinicalProcessHandler])
    );
    const oxygen = framework.apply(clinicalInput(effect("O2", "INSPIRED_OXYGEN_INCREASED")), [process()]);
    const ventilated = framework.apply(
      clinicalInput(effect("VENT", "EFFECTIVE_VENTILATION", { mode: "MECHANICAL" })), oxygen.processes
    );
    expect(ventilated.status).toBe("APPLIED");
    const supported = ventilated.processes[0];
    expect(supported.processType).toBe("RESPIRATORY_FAILURE");
    if (supported.processType !== "RESPIRATORY_FAILURE") throw new Error("Vale process type");
    const after = tickRespiratoryFailurePatientProcess(
      supported as import("@/models/PatientProcessRuntime").RespiratoryFailurePatientProcessRuntime,
      60
    );
    expect(after.clinicalState).toMatchObject({
      oxygenSupport: true, airwayProtected: false, ventilationMode: "MECHANICAL",
      spo2: 96.5, etco2: 44, fatigue: 17, trend: "IMPROVING",
    });
  });

  test("configuration controls progression without disease-specific runtime branches", () => {
    const configured = bootstrapRespiratoryFailurePatientProcess(fixture, {
      processId: "RF-CONFIG", phenotype: "HYPOXAEMIC", spo2: 90, respiratoryRate: 20,
      etco2: 40, gcs: 15, workOfBreathing: 10, fatigue: 0,
    }, {
      version: "TEST",
      progression: {
        ...defaultRespiratoryFailureConfiguration.progression,
        spo2DeclinePerMin: 4, respiratoryRateChangePerMin: 2,
      },
    });
    const result = tickRespiratoryFailurePatientProcess(configured, 60);
    expect(result.clinicalState).toMatchObject({ spo2: 86, respiratoryRate: 22 });
    expect(result.configuration.version).toBe("TEST");
  });

  test("repeated long replay has identical process, output and canonical runtime state", () => {
    const replay = () => {
      let current = process();
      let state = canonicalState();
      for (let tick = 1; tick <= 120; tick += 1) {
        current = tickRespiratoryFailurePatientProcess(current, 5);
        state = aggregateRuntimeState({
          previous: state, expectedStateVersion: state.stateVersion, exerciseTimeSec: tick * 5,
          processOutputs: [current.outputs], aggregationConfigVersion: "WP-17",
        }, new RuntimeOwnershipResolver([])).state;
      }
      return { current, state, serialized: JSON.stringify({ current, state }) };
    };
    const first = replay();
    const second = replay();
    expect(second).toEqual(first);
    expect(second.serialized).toBe(first.serialized);
  });
});
