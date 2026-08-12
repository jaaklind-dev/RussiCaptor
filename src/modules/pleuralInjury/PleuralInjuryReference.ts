import type { HemorrhageConfiguration } from "@/models/HemorrhagePatientProcess";
import { createTraumaticInjuryDescriptor } from "@/models/trauma/TraumaticInjury";
import { defaultPleuralInjuryConfiguration } from "@/services/runtime/PleuralInjuryPatientProcess";
import { PLEURAL_INJURY_MODULE_ID, PLEURAL_INJURY_MODULE_VERSION } from "./PleuralInjuryManifest";

export const MASSIVE_HEMOPNEUMOTHORAX = createTraumaticInjuryDescriptor({ injuryId: "MASSIVE_HEMOPNEUMOTHORAX", injuryType: "MASSIVE_HEMOPNEUMOTHORAX",
  mechanism: "MOTOR_VEHICLE_COLLISION", anatomicRegion: "THORAX", woundClassification: "CLOSED",
  provenance: Object.freeze({ moduleId: PLEURAL_INJURY_MODULE_ID, version: PLEURAL_INJURY_MODULE_VERSION }) });

const thoracicHemorrhage: HemorrhageConfiguration = Object.freeze({ baselineBleedingRateMlMin: 120, tourniquetEfficiency: 0, binderEfficiency: 0,
  infusionOffsetMlMin: 0, bloodProductOffsetMlMin: 0, severityThresholdsMl: Object.freeze([300, 700, 1200, 1800] as const),
  perfusionThresholdsMl: Object.freeze([600, 1100, 1700] as const), compensationThresholdsMl: Object.freeze([900, 1600] as const),
  trendThresholdsMlMin: Object.freeze({ worsening: 80, improving: 30 }), vitalResponsePer1000Ml: Object.freeze({ heartRateDelta: 35, systolicBpDelta: -35, diastolicBpDelta: -20, crtDelta: 2 }) });

export const PLEURAL_INJURY_REFERENCE = Object.freeze({
  patientId: "PT-PLEURAL-001",
  pleuralInjury: Object.freeze({ processId: "PT-PLEURAL:PLEURAL:1", instanceKey: "PT-PLEURAL:pleural:1", templateId: "MASSIVE_HEMOPNEUMOTHORAX_V1", configuration: defaultPleuralInjuryConfiguration }),
  respiratoryFailure: Object.freeze({ processId: "PT-PLEURAL:RESPIRATORY_FAILURE:1", instanceKey: "PT-PLEURAL:respiratory:1", templateId: "PLEURAL_RESPIRATORY_FAILURE_V1", phenotype: "HYPERCAPNIC", respiratoryRate: 28, etco2: 45, workOfBreathing: 40, fatigue: 15, configuration: Object.freeze({ spo2ContributorEnabled: false }) }),
  hypoxia: Object.freeze({ processId: "PT-PLEURAL:HYPOXIA:1", instanceKey: "PT-PLEURAL:hypoxia:1", templateId: "PLEURAL_HYPOXIA_V1", oxygenationReserve: 55, spo2: 88 }),
  hemorrhageSources: Object.freeze([{ processId: "PT-PLEURAL:HEMORRHAGE:THORACIC_1", instanceKey: "PT-PLEURAL:hemorrhage:thoracic", sourceId: "THORACIC_1", sourceType: "THORACIC", templateId: "THORACIC_HEMORRHAGE_REFERENCE_V1", configuration: thoracicHemorrhage }]),
});
