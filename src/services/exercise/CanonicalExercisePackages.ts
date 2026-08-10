import type { ExerciseCapability } from "@/models/exercise/ExerciseCapability";
import type { ExerciseDefinition } from "@/models/exercise/ExerciseDefinition";
import type { ExerciseProfile } from "@/models/exercise/ExerciseProfile";
import { createExercisePackage } from "./ExercisePackageHash";
import { DEFAULT_EXERCISE_DEFINITION, EXERCISE_DEFINITION_CATALOG } from "./ExerciseDefinitionService";
import { AIRWAY_MODULE_ID, AIRWAY_MODULE_VERSION } from "@/modules/airway/AirwayManifest";
import { RESPIRATORY_FAILURE_MODULE_ID, RESPIRATORY_FAILURE_MODULE_VERSION } from "@/modules/respiratoryFailure/RespiratoryFailureManifest";
import { MEDICATION_CORE_MODULE_ID, MEDICATION_CORE_MODULE_VERSION } from "@/modules/medicationCore/MedicationCoreManifest";
import { ALS_MODULE_ID, ALS_MODULE_VERSION } from "@/modules/als/AlsManifest";
import { CARDIAC_ARREST_MODULE_ID, CARDIAC_ARREST_MODULE_VERSION } from "@/modules/cardiacArrest/CardiacArrestManifest";

const capabilities: readonly ExerciseCapability[] = ["EXERCISE_CONTROLS", "TIMELINE", "DEBRIEF", "ANALYTICS", "METRICS", "RESOURCES", "PATIENT_PLAYBACK"];
const processes: Record<ExerciseProfile, readonly string[]> = {
  ALS: ["HEMORRHAGE", "HYPOVENTILATION_HYPERCAPNIA", "HYPOXIA", "MEDICATION", "RESPIRATORY_FAILURE"],
  TRAUMA: ["HEMORRHAGE", "HYPOXIA", "MEDICATION", "RESPIRATORY_FAILURE"],
  MASCAL: ["HEMORRHAGE", "HYPOVENTILATION_HYPERCAPNIA", "HYPOXIA", "MEDICATION", "RESPIRATORY_FAILURE"],
  BOTULISM: EXERCISE_DEFINITION_CATALOG.patientProcesses,
  EMERGENCY_DEPARTMENT: ["HEMORRHAGE", "HYPOVENTILATION_HYPERCAPNIA", "HYPOXIA", "MEDICATION", "RESPIRATORY_FAILURE"],
  CUSTOM: EXERCISE_DEFINITION_CATALOG.patientProcesses,
};
const definitions = (profile: ExerciseProfile): ExerciseDefinition => profile === "BOTULISM" ? DEFAULT_EXERCISE_DEFINITION : Object.freeze({
  definitionVersion: 1, exerciseTypeId: `RUSSICAPTOR_${profile}`, name: `${profile.replaceAll("_", " ")} Exercise`, description: `Canonical ${profile.replaceAll("_", " ").toLowerCase()} exercise definition`, profile,
  enabledPatientProcesses: Object.freeze([...processes[profile]]), enabledAnalyticsProviders: Object.freeze([...EXERCISE_DEFINITION_CATALOG.analyticsProviders]), enabledMetricProviders: Object.freeze([...EXERCISE_DEFINITION_CATALOG.metricProviders]),
  objectives: Object.freeze([Object.freeze({ objectiveId: "exercise-objective", name: "Complete exercise objectives", description: "Complete the configured clinical and operational exercise objectives" })]), capabilities: Object.freeze([...capabilities]),
});
const template = (profile: ExerciseProfile, author = "RussiCaptor") => { const definition = definitions(profile); return createExercisePackage({ packageId: `russicaptor.${profile.toLowerCase()}`, packageVersion: "1.0.0", definition, patientDatasetId: `patients.${profile.toLowerCase()}.v1`, enabledPatientProcesses: definition.enabledPatientProcesses, enabledAnalyticsProviders: definition.enabledAnalyticsProviders, enabledMetricProviders: definition.enabledMetricProviders, metadata: { name: `${profile.replaceAll("_", " ")} Template Package`, description: `Canonical ${profile.replaceAll("_", " ").toLowerCase()} exercise configuration package`, author, organization: "RussiCaptor", createdVersion: "0.7.0", exerciseType: profile, tags: ["canonical", "template", profile.toLowerCase()] } }); };

export const CANONICAL_EXERCISE_PACKAGES = Object.freeze((["ALS", "TRAUMA", "MASCAL", "BOTULISM", "EMERGENCY_DEPARTMENT", "CUSTOM"] as const).map(profile => template(profile)));
export const DEFAULT_EXERCISE_PACKAGE = CANONICAL_EXERCISE_PACKAGES.find(pkg => pkg.definition.profile === "BOTULISM")!;

const airwayDefinition: ExerciseDefinition = Object.freeze({
  ...structuredClone(DEFAULT_EXERCISE_DEFINITION),
  exerciseTypeId: "RUSSICAPTOR_AIRWAY_REFERENCE",
  name: "Airway Clinical Module Reference Exercise",
  description: "Reference exercise composed from AIRWAY_V1 without changing Runtime behaviour",
  profile: "CUSTOM",
  enabledAnalyticsProviders: Object.freeze(EXERCISE_DEFINITION_CATALOG.analyticsProviders.filter(id => id !== "core.interventions")),
  enabledMetricProviders: Object.freeze(EXERCISE_DEFINITION_CATALOG.metricProviders.filter(id => id !== "core.interventions")),
});

export const AIRWAY_EXERCISE_PACKAGE = createExercisePackage({
  packageId: "russicaptor.airway-reference",
  packageVersion: "1.0.0",
  definition: airwayDefinition,
  patientDatasetId: "patients.custom.v1",
  enabledPatientProcesses: airwayDefinition.enabledPatientProcesses,
  enabledAnalyticsProviders: airwayDefinition.enabledAnalyticsProviders,
  enabledMetricProviders: airwayDefinition.enabledMetricProviders,
  requiredClinicalModules: Object.freeze([{ moduleId: AIRWAY_MODULE_ID, version: AIRWAY_MODULE_VERSION }]),
  metadata: {
    name: "Airway Clinical Module Reference Package",
    description: "Reference package proving deterministic AIRWAY_V1 composition",
    author: "RussiCaptor",
    organization: "RussiCaptor",
    createdVersion: "0.7.0",
    exerciseType: "CUSTOM",
    tags: ["airway", "canonical", "clinical-module", "reference"],
  },
});

const respiratoryFailureDefinition: ExerciseDefinition = Object.freeze({
  ...structuredClone(DEFAULT_EXERCISE_DEFINITION),
  exerciseTypeId: "RUSSICAPTOR_RESPIRATORY_FAILURE_REFERENCE",
  name: "Respiratory Failure Clinical Module Reference Exercise",
  description: "Reference exercise composed transitively from RESPIRATORY_FAILURE_V1 and AIRWAY_V1",
  profile: "CUSTOM",
  enabledPatientProcesses: Object.freeze(DEFAULT_EXERCISE_DEFINITION.enabledPatientProcesses.filter(id => id !== "RESPIRATORY_FAILURE")),
  enabledAnalyticsProviders: Object.freeze(EXERCISE_DEFINITION_CATALOG.analyticsProviders.filter(id => id !== "core.interventions")),
  enabledMetricProviders: Object.freeze(EXERCISE_DEFINITION_CATALOG.metricProviders.filter(id => id !== "core.interventions")),
});

export const RESPIRATORY_FAILURE_EXERCISE_PACKAGE = createExercisePackage({
  packageId: "russicaptor.respiratory-failure-reference",
  packageVersion: "1.0.0",
  definition: respiratoryFailureDefinition,
  patientDatasetId: "patients.custom.v1",
  enabledPatientProcesses: respiratoryFailureDefinition.enabledPatientProcesses,
  enabledAnalyticsProviders: respiratoryFailureDefinition.enabledAnalyticsProviders,
  enabledMetricProviders: respiratoryFailureDefinition.enabledMetricProviders,
  requiredClinicalModules: Object.freeze([{
    moduleId: RESPIRATORY_FAILURE_MODULE_ID,
    version: RESPIRATORY_FAILURE_MODULE_VERSION,
  }]),
  metadata: {
    name: "Respiratory Failure Clinical Module Reference Package",
    description: "Reference package proving deterministic transitive Respiratory Failure and Airway composition",
    author: "RussiCaptor",
    organization: "RussiCaptor",
    createdVersion: "0.7.0",
    exerciseType: "CUSTOM",
    tags: ["canonical", "clinical-module", "reference", "respiratory-failure"],
  },
});

const medicationCoreDefinition: ExerciseDefinition = Object.freeze({
  ...structuredClone(DEFAULT_EXERCISE_DEFINITION),
  exerciseTypeId: "RUSSICAPTOR_MEDICATION_CORE_REFERENCE",
  name: "Medication Core Clinical Module Reference Exercise",
  description: "Reference exercise composed from the configuration-driven MEDICATION_CORE_V1 framework",
  profile: "CUSTOM",
  enabledPatientProcesses: Object.freeze(DEFAULT_EXERCISE_DEFINITION.enabledPatientProcesses.filter(id => id !== "MEDICATION")),
});

export const MEDICATION_CORE_EXERCISE_PACKAGE = createExercisePackage({
  packageId: "russicaptor.medication-core-reference",
  packageVersion: "1.0.0",
  definition: medicationCoreDefinition,
  patientDatasetId: "patients.custom.v1",
  enabledPatientProcesses: medicationCoreDefinition.enabledPatientProcesses,
  enabledAnalyticsProviders: medicationCoreDefinition.enabledAnalyticsProviders,
  enabledMetricProviders: medicationCoreDefinition.enabledMetricProviders,
  requiredClinicalModules: Object.freeze([{
    moduleId: MEDICATION_CORE_MODULE_ID,
    version: MEDICATION_CORE_MODULE_VERSION,
  }]),
  metadata: {
    name: "Medication Core Clinical Module Reference Package",
    description: "Reference package proving deterministic Medication Core composition",
    author: "RussiCaptor",
    organization: "RussiCaptor",
    createdVersion: "0.7.0",
    exerciseType: "CUSTOM",
    tags: ["canonical", "clinical-module", "medication-core", "reference"],
  },
});

const cardiacArrestDefinition: ExerciseDefinition = Object.freeze({
  ...structuredClone(DEFAULT_EXERCISE_DEFINITION),
  exerciseTypeId: "RUSSICAPTOR_CARDIAC_ARREST_REFERENCE",
  name: "Cardiac Arrest Reference Exercise",
  description: "Protocol-independent deterministic cardiac arrest, CPR, defibrillation, rhythm and ROSC reference",
  profile: "CUSTOM",
});

export const CARDIAC_ARREST_EXERCISE_PACKAGE = createExercisePackage({
  packageId: "russicaptor.cardiac-arrest-reference",
  packageVersion: "1.0.0",
  definition: cardiacArrestDefinition,
  patientDatasetId: "patients.cardiac-arrest-reference.v1",
  enabledPatientProcesses: cardiacArrestDefinition.enabledPatientProcesses,
  enabledAnalyticsProviders: cardiacArrestDefinition.enabledAnalyticsProviders,
  enabledMetricProviders: cardiacArrestDefinition.enabledMetricProviders,
  requiredClinicalModules: Object.freeze([{ moduleId: CARDIAC_ARREST_MODULE_ID, version: CARDIAC_ARREST_MODULE_VERSION }]),
  metadata: {
    name: "Cardiac Arrest Reference Package",
    description: "Deterministic capability and replay reference; not a treatment protocol",
    author: "RussiCaptor", organization: "RussiCaptor", createdVersion: "0.7.0", exerciseType: "CUSTOM",
    tags: ["canonical", "cardiac-arrest", "clinical-module", "reference"],
  },
});

const alsDefinition: ExerciseDefinition = Object.freeze({
  ...structuredClone(DEFAULT_EXERCISE_DEFINITION),
  exerciseTypeId: "RUSSICAPTOR_ALS_REFERENCE",
  name: "ALS Clinical Module Reference Exercise",
  description: "ALS reference composed from Airway, Cardiac Arrest and Medication Core clinical modules.",
  profile: "ALS",
  enabledPatientProcesses: Object.freeze(DEFAULT_EXERCISE_DEFINITION.enabledPatientProcesses.filter(id => id !== "MEDICATION")),
  enabledAnalyticsProviders: Object.freeze(EXERCISE_DEFINITION_CATALOG.analyticsProviders.filter(id => id !== "core.interventions")),
  enabledMetricProviders: Object.freeze(EXERCISE_DEFINITION_CATALOG.metricProviders.filter(id => id !== "core.interventions")),
});

export const ALS_EXERCISE_PACKAGE = createExercisePackage({
  packageId: "russicaptor.als-reference",
  packageVersion: "1.0.0",
  definition: alsDefinition,
  patientDatasetId: "patients.als.v1",
  enabledPatientProcesses: alsDefinition.enabledPatientProcesses,
  enabledAnalyticsProviders: alsDefinition.enabledAnalyticsProviders,
  enabledMetricProviders: alsDefinition.enabledMetricProviders,
  requiredClinicalModules: Object.freeze([{ moduleId: ALS_MODULE_ID, version: ALS_MODULE_VERSION }]),
  metadata: {
    name: "ALS Clinical Module Reference Package",
    description: "Canonical ALS composition with Airway, Cardiac Arrest and Medication Core foundations.",
    author: "RussiCaptor",
    organization: "RussiCaptor",
    createdVersion: "0.7.0",
    exerciseType: "ALS",
    tags: ["als", "canonical", "clinical-module", "reference"],
  },
});
