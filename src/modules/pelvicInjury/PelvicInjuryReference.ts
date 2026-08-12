import type { HemorrhageConfiguration } from "@/models/HemorrhagePatientProcess";
import { createTraumaticInjuryDescriptor } from "@/models/trauma/TraumaticInjury";
import { PELVIC_INJURY_MODULE_ID, PELVIC_INJURY_MODULE_VERSION } from "./PelvicInjuryManifest";

export const OPEN_BOOK_PELVIC_INJURY = createTraumaticInjuryDescriptor({
  injuryId: "OPEN_BOOK_PELVIC_INJURY",
  injuryType: "OPEN_BOOK_PELVIC_INJURY",
  mechanism: "FALL_FROM_HEIGHT",
  anatomicRegion: "PELVIS",
  woundClassification: "CLOSED",
  provenance: Object.freeze({ moduleId: PELVIC_INJURY_MODULE_ID, version: PELVIC_INJURY_MODULE_VERSION }),
});

/** Reference scenario configuration, not a universal clinical constant. */
export const PELVIC_HEMORRHAGE_REFERENCE_CONFIGURATION: HemorrhageConfiguration = Object.freeze({
  baselineBleedingRateMlMin: 140,
  tourniquetEfficiency: 0,
  binderEfficiency: 0.6,
  infusionOffsetMlMin: 0,
  bloodProductOffsetMlMin: 0,
  severityThresholdsMl: Object.freeze([300, 700, 1200, 1800] as const),
  perfusionThresholdsMl: Object.freeze([600, 1100, 1700] as const),
  compensationThresholdsMl: Object.freeze([900, 1600] as const),
  trendThresholdsMlMin: Object.freeze({ worsening: 80, improving: 30 }),
  vitalResponsePer1000Ml: Object.freeze({ heartRateDelta: 35, systolicBpDelta: -35, diastolicBpDelta: -20, crtDelta: 2 }),
});

export const PELVIC_HEMORRHAGE_REFERENCE_SOURCE = Object.freeze({
  processId: "PT-PELVIC:HEMORRHAGE:PELVIC_HEMORRHAGE_1",
  instanceKey: "PT-PELVIC:hemorrhage:pelvic",
  sourceId: "PELVIC_HEMORRHAGE_1",
  sourceType: "PELVIC",
  templateId: "PELVIC_HEMORRHAGE_REFERENCE_V1",
  configuration: PELVIC_HEMORRHAGE_REFERENCE_CONFIGURATION,
});

export const PELVIC_INJURY_REFERENCE_PATIENT = Object.freeze({
  patientId: "PT-PELVIC-001",
  mechanism: "FALL_FROM_HEIGHT" as const,
  injuries: Object.freeze([OPEN_BOOK_PELVIC_INJURY]),
  hemorrhageSources: Object.freeze([PELVIC_HEMORRHAGE_REFERENCE_SOURCE]),
});
