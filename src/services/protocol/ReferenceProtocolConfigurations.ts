import { createProtocolConfiguration } from "./ProtocolConfigurationHash";

export const ALS_GENERIC_V1 = createProtocolConfiguration({
  protocolId: "ALS_GENERIC_V1", version: "1.0.0", name: "ALS Generic Foundation",
  description: "Protocol-neutral ALS configuration proving deterministic capability and assessment references.",
  authority: "RussiCaptor internal reference", publicationReference: "WP-37", tags: ["als", "generic", "reference"], status: "ACTIVE",
  requiredCapabilities: ["CARDIAC_ARREST", "RHYTHM_STATE", "CPR_PHYSIOLOGY", "DEFIBRILLATION", "ROSC"],
  rhythmCategories: { SHOCKABLE: ["VF", "PULSELESS_VT"], NON_SHOCKABLE: ["ASYSTOLE", "PEA"], PERFUSING: ["PERFUSING"] },
  rules: [
    { ruleId: "ARREST-CPR", condition: { cardiacState: "ARREST" }, action: "START_CPR" },
    { ruleId: "SHOCKABLE-DEFIB", condition: { rhythmClassification: "SHOCKABLE" }, action: "DEFIBRILLATION" },
  ],
  assessmentExpectations: [
    { expectationId: "EXPECT-CPR", condition: { cardiacState: "ARREST" }, expectedAction: "START_CPR", severity: "CRITICAL", evidenceRequirements: ["INTERVENTION", "TIMELINE"] },
    { expectationId: "EXPECT-SHOCK", condition: { rhythmClassification: "SHOCKABLE" }, expectedAction: "DEFIBRILLATION", severity: "CRITICAL", evidenceRequirements: ["INTERVENTION", "PATIENT_PROCESS_TRANSITION", "TIMELINE"] },
  ],
  medicationReferences: [],
});

export const protocolConfigurationRegistrySeed = [ALS_GENERIC_V1] as const;
