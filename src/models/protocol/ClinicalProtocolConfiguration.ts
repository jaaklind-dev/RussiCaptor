import type { CardiacRhythm, CardiacRhythmClassification, CardiacState } from "@/models/PatientProcessRuntime";

export type ProtocolStatus = "DRAFT" | "ACTIVE" | "DEPRECATED";
export type ProtocolReference = Readonly<{ protocolId: string; version: string }>;
export type ProtocolActionReference = "START_CPR" | "STOP_CPR" | "DEFIBRILLATION" | "MEDICATION_ADMINISTRATION" | "AIRWAY_INTERVENTION";
export type ProtocolTemporalRelation = "AFTER" | "BEFORE" | "WITHIN" | "REPEATING";

export type ProtocolCondition = Readonly<{
  cardiacState?: CardiacState;
  rhythm?: CardiacRhythm;
  rhythmClassification?: CardiacRhythmClassification;
}>;

export type ProtocolTemporalConstraint = Readonly<{
  relation: ProtocolTemporalRelation;
  referenceAction?: ProtocolActionReference;
  durationSec?: number;
}>;

export type ProtocolRule = Readonly<{
  ruleId: string;
  condition: ProtocolCondition;
  action: ProtocolActionReference;
  temporalConstraint?: ProtocolTemporalConstraint;
}>;

export type ProtocolAssessmentExpectation = Readonly<{
  expectationId: string;
  condition: ProtocolCondition;
  expectedAction: ProtocolActionReference;
  temporalConstraint?: ProtocolTemporalConstraint;
  severity: "INFO" | "WARNING" | "CRITICAL";
  evidenceRequirements: readonly ("TIMELINE" | "INTERVENTION" | "PATIENT_PROCESS_TRANSITION" | "SIMULATION_TIME")[];
}>;

export type ProtocolMedicationReference = Readonly<{
  medicationRef: string;
  dose?: string;
  route?: string;
  context: string;
}>;

export type ClinicalProtocolConfiguration = Readonly<{
  protocolId: string;
  version: string;
  protocolHash: string;
  name: string;
  description: string;
  authority: string;
  publicationReference?: string;
  tags: readonly string[];
  status: ProtocolStatus;
  requiredCapabilities: readonly string[];
  rhythmCategories: Readonly<Record<CardiacRhythmClassification, readonly CardiacRhythm[]>>;
  rules: readonly ProtocolRule[];
  assessmentExpectations: readonly ProtocolAssessmentExpectation[];
  medicationReferences: readonly ProtocolMedicationReference[];
}>;

export type ProtocolProvenance = Readonly<{
  protocolId: string;
  version: string;
  protocolHash: string;
  name: string;
  status: ProtocolStatus;
  authority: string;
  publicationReference?: string;
  packageId: string;
  requiredCapabilities: readonly string[];
  resolvedCapabilities: readonly string[];
}>;
