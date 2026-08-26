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
import { TRAUMA_CORE_MODULE_ID, TRAUMA_CORE_MODULE_VERSION } from "@/modules/traumaCore/TraumaCoreManifest";
import { PELVIC_INJURY_MODULE_ID, PELVIC_INJURY_MODULE_VERSION } from "@/modules/pelvicInjury/PelvicInjuryManifest";
import { PLEURAL_INJURY_MODULE_ID, PLEURAL_INJURY_MODULE_VERSION } from "@/modules/pleuralInjury/PleuralInjuryManifest";
import { MASSIVE_TRANSFUSION_MODULE_ID, MASSIVE_TRANSFUSION_MODULE_VERSION } from "@/modules/massiveTransfusion/MassiveTransfusionManifest";

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
const template = (profile: ExerciseProfile, author = "RussiCaptor") => { const definition = definitions(profile); const botulism = profile === "BOTULISM"; return createExercisePackage({
  packageId: botulism ? "russicaptor.botulism-johvi" : `russicaptor.${profile.toLowerCase()}`,
  packageVersion: botulism ? "2.0.0" : "1.0.0",
  definition,
  patientDatasetId: botulism ? "patients.botulism-johvi.v2" : `patients.${profile.toLowerCase()}.v1`,
  enabledPatientProcesses: definition.enabledPatientProcesses, enabledAnalyticsProviders: definition.enabledAnalyticsProviders, enabledMetricProviders: definition.enabledMetricProviders,
  metadata: { name: botulism ? "Jõhvi restorani botulismiõppuse mallpakett" : `${profile.replaceAll("_", " ")} Template Package`, description: botulism ? "Jõhvi restorani botulismiõppuse canonical konfiguratsioonipakett" : `Canonical ${profile.replaceAll("_", " ").toLowerCase()} exercise configuration package`, author, organization: "RussiCaptor", createdVersion: "0.7.0", exerciseType: profile, tags: ["canonical", "template", profile.toLowerCase(), ...(botulism ? ["johvi", "v2"] : [])] },
}); };

/** Historical v1 identity retained for compatibility tests; it is not loaded into the production catalog. */
export const HISTORICAL_BOTULISM_EXERCISE_PACKAGE_V1 = createExercisePackage({
  packageId: "russicaptor.botulism", packageVersion: "1.0.0", definition: DEFAULT_EXERCISE_DEFINITION, patientDatasetId: "patients.botulism.v1",
  enabledPatientProcesses: DEFAULT_EXERCISE_DEFINITION.enabledPatientProcesses, enabledAnalyticsProviders: DEFAULT_EXERCISE_DEFINITION.enabledAnalyticsProviders, enabledMetricProviders: DEFAULT_EXERCISE_DEFINITION.enabledMetricProviders,
  metadata: { name: "BOTULISM Template Package", description: "Canonical botulism exercise configuration package", author: "RussiCaptor", organization: "RussiCaptor", createdVersion: "0.7.0", exerciseType: "BOTULISM", tags: ["canonical", "template", "botulism"] },
});

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

export const ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE = createExercisePackage({
  packageId: "russicaptor.als-protocol-reference",
  packageVersion: "1.0.0",
  definition: Object.freeze({ ...structuredClone(alsDefinition), exerciseTypeId: "RUSSICAPTOR_ALS_PROTOCOL_REFERENCE",
    name: "ALS Generic Protocol Reference Exercise", description: "Reference package binding canonical ALS capabilities to ALS_GENERIC_V1 configuration." }),
  patientDatasetId: "patients.als-protocol-reference.v1",
  enabledPatientProcesses: alsDefinition.enabledPatientProcesses,
  enabledAnalyticsProviders: alsDefinition.enabledAnalyticsProviders,
  enabledMetricProviders: alsDefinition.enabledMetricProviders,
  requiredClinicalModules: Object.freeze([{ moduleId: ALS_MODULE_ID, version: ALS_MODULE_VERSION }]),
  protocolConfiguration: Object.freeze({ protocolId: "ALS_GENERIC_V1", version: "1.0.0" }),
  evaluationProfile: Object.freeze({ profileId: "ALS_GENERIC_EVALUATION_V1", version: "1.0.0" }),
  metadata: {
    name: "ALS Generic Protocol Reference Package", description: "Deterministic protocol configuration reference; not ERC or AHA guidance.",
    author: "RussiCaptor", organization: "RussiCaptor", createdVersion: "0.7.0", exerciseType: "CUSTOM",
    tags: ["als", "canonical", "protocol", "reference"],
  },
});

const traumaCoreDefinition: ExerciseDefinition = Object.freeze({
  ...structuredClone(DEFAULT_EXERCISE_DEFINITION),
  exerciseTypeId: "RUSSICAPTOR_TRAUMA_CORE_REFERENCE",
  name: "Trauma Core Reference Exercise",
  description: "Neutral composition reference for trauma context infrastructure; no pelvic or pleural injury physiology.",
  profile: "TRAUMA",
});

export const TRAUMA_CORE_EXERCISE_PACKAGE = createExercisePackage({
  packageId: "russicaptor.trauma-core-reference",
  packageVersion: "1.0.0",
  definition: traumaCoreDefinition,
  patientDatasetId: "patients.custom.v1",
  enabledPatientProcesses: traumaCoreDefinition.enabledPatientProcesses,
  enabledAnalyticsProviders: traumaCoreDefinition.enabledAnalyticsProviders,
  enabledMetricProviders: traumaCoreDefinition.enabledMetricProviders,
  requiredClinicalModules: Object.freeze([{ moduleId: TRAUMA_CORE_MODULE_ID, version: TRAUMA_CORE_MODULE_VERSION }]),
  metadata: {
    name: "Trauma Core Reference Package",
    description: "Foundation-only reference proving deterministic TRAUMA_CORE_V1 composition; not a clinical trauma scenario.",
    author: "RussiCaptor", organization: "RussiCaptor", createdVersion: "0.7.0", exerciseType: "TRAUMA",
    tags: ["canonical", "clinical-module", "foundation", "reference", "trauma"],
  },
});

const pelvicInjuryDefinition: ExerciseDefinition = Object.freeze({
  ...structuredClone(DEFAULT_EXERCISE_DEFINITION),
  exerciseTypeId: "RUSSICAPTOR_PELVIC_INJURY_REFERENCE",
  name: "Pelvic Injury Reference Exercise",
  description: "Single-patient deterministic open-book pelvic injury and hemorrhage validation reference.",
  profile: "TRAUMA",
});

export const PELVIC_INJURY_EXERCISE_PACKAGE = createExercisePackage({
  packageId: "russicaptor.pelvic-injury-reference",
  packageVersion: "1.0.0",
  definition: pelvicInjuryDefinition,
  patientDatasetId: "patients.pelvic-injury-reference.v1",
  enabledPatientProcesses: pelvicInjuryDefinition.enabledPatientProcesses,
  enabledAnalyticsProviders: pelvicInjuryDefinition.enabledAnalyticsProviders,
  enabledMetricProviders: pelvicInjuryDefinition.enabledMetricProviders,
  requiredClinicalModules: Object.freeze([{ moduleId: PELVIC_INJURY_MODULE_ID, version: PELVIC_INJURY_MODULE_VERSION }]),
  metadata: {
    name: "Pelvic Injury Reference Package",
    description: "Reference scenario configuration for open-book pelvic injury and canonical hemorrhage response; not a guideline.",
    author: "RussiCaptor", organization: "RussiCaptor", createdVersion: "0.7.0", exerciseType: "TRAUMA",
    tags: ["canonical", "clinical-module", "open-book", "pelvic-injury", "reference", "trauma"],
  },
});

const pleuralInjuryDefinition: ExerciseDefinition = Object.freeze({ ...structuredClone(DEFAULT_EXERCISE_DEFINITION),
  exerciseTypeId: "RUSSICAPTOR_PLEURAL_INJURY_REFERENCE", name: "Massive Hemopneumothorax Reference Exercise",
  description: "Single-patient deterministic pleural air, pleural blood, respiratory impairment and thoracic hemorrhage validation reference.", profile: "TRAUMA" });
export const PLEURAL_INJURY_EXERCISE_PACKAGE = createExercisePackage({
  packageId: "russicaptor.pleural-injury-reference", packageVersion: "1.0.0", definition: pleuralInjuryDefinition,
  patientDatasetId: "patients.pleural-injury-reference.v1", enabledPatientProcesses: pleuralInjuryDefinition.enabledPatientProcesses,
  enabledAnalyticsProviders: pleuralInjuryDefinition.enabledAnalyticsProviders, enabledMetricProviders: pleuralInjuryDefinition.enabledMetricProviders,
  requiredClinicalModules: Object.freeze([{ moduleId: PLEURAL_INJURY_MODULE_ID, version: PLEURAL_INJURY_MODULE_VERSION }]),
  metadata: { name: "Massive Hemopneumothorax Reference Package", description: "Deterministic pleural injury and chest drain capability reference; not a treatment protocol.",
    author: "RussiCaptor", organization: "RussiCaptor", createdVersion: "0.7.0", exerciseType: "TRAUMA",
    tags: ["canonical", "clinical-module", "hemopneumothorax", "pleural-injury", "reference", "trauma"] },
});

export const PLEURAL_INJURY_WP45B_EXERCISE_PACKAGE = createExercisePackage({
  packageId: "russicaptor.pleural-injury-reference", packageVersion: "1.1.0", definition: pleuralInjuryDefinition,
  patientDatasetId: "patients.pleural-injury-reference.v2", enabledPatientProcesses: pleuralInjuryDefinition.enabledPatientProcesses,
  enabledAnalyticsProviders: pleuralInjuryDefinition.enabledAnalyticsProviders, enabledMetricProviders: pleuralInjuryDefinition.enabledMetricProviders,
  requiredClinicalModules: Object.freeze([{ moduleId: PLEURAL_INJURY_MODULE_ID, version: PLEURAL_INJURY_MODULE_VERSION }]),
  metadata: { name: "WP-45B Pleural Physical Acceptance Package", description: "Versioned technical fixture for 1450 ml initial pleural drainage and persistent 400 ml/h thoracic bleeding.",
    author: "RussiCaptor", organization: "RussiCaptor", createdVersion: "0.7.0", exerciseType: "TRAUMA",
    tags: ["canonical", "clinical-module", "physical-acceptance", "pleural-injury", "technical", "wp-45b"] },
});

const runtimeContinuityDefinition: ExerciseDefinition = Object.freeze({ ...structuredClone(DEFAULT_EXERCISE_DEFINITION),
  exerciseTypeId: "RUSSICAPTOR_RUNTIME_CONTINUITY_REFERENCE", name: "Runtime Continuity Reference Exercise",
  description: "Technical two-patient reference for canonical persistence and rehydration acceptance only.", profile: "TRAUMA" });
export const RUNTIME_CONTINUITY_EXERCISE_PACKAGE = createExercisePackage({
  packageId: "russicaptor.runtime-continuity-reference", packageVersion: "1.0.0", definition: runtimeContinuityDefinition,
  patientDatasetId: "patients.runtime-continuity-reference.v1", enabledPatientProcesses: runtimeContinuityDefinition.enabledPatientProcesses,
  enabledAnalyticsProviders: runtimeContinuityDefinition.enabledAnalyticsProviders, enabledMetricProviders: runtimeContinuityDefinition.enabledMetricProviders,
  requiredClinicalModules: Object.freeze([
    { moduleId: PELVIC_INJURY_MODULE_ID, version: PELVIC_INJURY_MODULE_VERSION },
    { moduleId: PLEURAL_INJURY_MODULE_ID, version: PLEURAL_INJURY_MODULE_VERSION },
  ]),
  metadata: { name: "Runtime Continuity Reference Package", description: "Technical reference package for two-patient process-kill persistence acceptance; not a clinical scenario or protocol.",
    author: "RussiCaptor", organization: "RussiCaptor", createdVersion: "0.7.0", exerciseType: "TRAUMA",
    tags: ["canonical", "persistence", "reference", "runtime-continuity", "technical", "trauma"] },
});

const mtpReferenceDefinition: ExerciseDefinition = Object.freeze({ ...structuredClone(DEFAULT_EXERCISE_DEFINITION),
  exerciseTypeId: "RUSSICAPTOR_MTP_REFERENCE", name: "MTP tehniline referentsõppus",
  description: "Ühe patsiendi tehniline referents massiivse transfusiooni ja vaagnaverejooksu kompositsiooni kontrolliks.", profile: "TRAUMA" });
export const MASSIVE_TRANSFUSION_EXERCISE_PACKAGE = createExercisePackage({
  packageId: "russicaptor.massive-transfusion-reference", packageVersion: "1.0.0", definition: mtpReferenceDefinition,
  patientDatasetId: "patients.massive-transfusion-reference.v1", enabledPatientProcesses: mtpReferenceDefinition.enabledPatientProcesses,
  enabledAnalyticsProviders: mtpReferenceDefinition.enabledAnalyticsProviders, enabledMetricProviders: mtpReferenceDefinition.enabledMetricProviders,
  requiredClinicalModules: Object.freeze([
    { moduleId: PELVIC_INJURY_MODULE_ID, version: PELVIC_INJURY_MODULE_VERSION },
    { moduleId: MASSIVE_TRANSFUSION_MODULE_ID, version: MASSIVE_TRANSFUSION_MODULE_VERSION },
  ]),
  metadata: { name: "MTP tehniline referentspakett", description: "Tehniline kontrollpakett verekomponentide, jätkuva vaagnaverejooksu ja vaagnalahase kompositsioonile; ei ole ravijuhend.",
    author: "RussiCaptor", organization: "RussiCaptor", createdVersion: "0.7.0", exerciseType: "TRAUMA",
    tags: ["canonical", "massive-transfusion", "reference", "technical", "trauma"] },
});

const transportReferenceDefinition: ExerciseDefinition = Object.freeze({ ...structuredClone(DEFAULT_EXERCISE_DEFINITION),
  exerciseTypeId: "RUSSICAPTOR_TRANSPORT_REFERENCE", name: "Transpordi tehniline referentsõppus",
  description: "Kahe patsiendi ja ühe jagatud reanimobiili deterministlik tehniline referents.", profile: "TRAUMA" });
export const TRANSPORT_REFERENCE_EXERCISE_PACKAGE = createExercisePackage({
  packageId: "russicaptor.transport-reference", packageVersion: "1.0.0", definition: transportReferenceDefinition,
  patientDatasetId: "patients.transport-reference.v1", enabledPatientProcesses: transportReferenceDefinition.enabledPatientProcesses,
  enabledAnalyticsProviders: transportReferenceDefinition.enabledAnalyticsProviders, enabledMetricProviders: transportReferenceDefinition.enabledMetricProviders,
  transportConfiguration: Object.freeze({ version: "1.0.0", vehicleLocationId: "REANIMOBILE", resources: Object.freeze([
    Object.freeze({ resourceId: "REANIMOBILE-01", resourceType: "CRITICAL_CARE_AMBULANCE", displayName: "Reanimobiil 01", capacity: 1, homeLocationId: "ED" }),
  ]), destinations: Object.freeze([
    Object.freeze({ destinationId: "THORACIC_CENTER", displayName: "Torakaalkeskus", capabilities: Object.freeze(["THORACOTOMY"]), travelDurationSec: 1800, handoverDurationSec: 600, returnDurationSec: 1800, turnaroundDurationSec: 300 }),
    Object.freeze({ destinationId: "PELVIC_CENTER", displayName: "Vaagnatraumakeskus", capabilities: Object.freeze(["PELVIC_SURGERY"]), travelDurationSec: 7200, handoverDurationSec: 600, returnDurationSec: 7200, turnaroundDurationSec: 0 }),
  ]) }),
  metadata: { name: "Transpordi tehniline referentspakett", description: "Üldise transpordi ressursi-, teekonna- ja tagastustsükli kontrollpakett; ei kodeeri kliinilist ravijärjekorda.",
    author: "RussiCaptor", organization: "RussiCaptor", createdVersion: "0.7.0", exerciseType: "TRAUMA", tags: ["canonical", "reference", "technical", "transport"] },
});

const decompensationReferenceDefinition: ExerciseDefinition = Object.freeze({ ...structuredClone(DEFAULT_EXERCISE_DEFINITION),
  exerciseTypeId:"RUSSICAPTOR_PHYSIOLOGIC_DECOMPENSATION_REFERENCE", name:"Füsioloogilise dekompensatsiooni referentsõppus",
  description:"Üldise perfusiooniteadliku SpO₂, GCS ja terminalseisundi deterministlik referents.", profile:"TRAUMA" });
export const PHYSIOLOGIC_DECOMPENSATION_REFERENCE_EXERCISE_PACKAGE = createExercisePackage({
  packageId:"russicaptor.physiologic-decompensation-reference", packageVersion:"1.0.0", definition:decompensationReferenceDefinition,
  patientDatasetId:"patients.physiologic-decompensation-reference.v1", enabledPatientProcesses:decompensationReferenceDefinition.enabledPatientProcesses,
  enabledAnalyticsProviders:decompensationReferenceDefinition.enabledAnalyticsProviders, enabledMetricProviders:decompensationReferenceDefinition.enabledMetricProviders,
  requiredClinicalModules:Object.freeze([
    {moduleId:PELVIC_INJURY_MODULE_ID,version:PELVIC_INJURY_MODULE_VERSION},
    {moduleId:MASSIVE_TRANSFUSION_MODULE_ID,version:MASSIVE_TRANSFUSION_MODULE_VERSION},
  ]),
  metadata:{name:"Füsioloogilise dekompensatsiooni referentspakett",description:"WP-48 opt-in tehniline referents.",author:"RussiCaptor",organization:"RussiCaptor",createdVersion:"0.8.0",exerciseType:"TRAUMA",tags:["canonical","decompensation","reference","technical"]},
});
export const PRESSURE_DEPENDENT_HEMORRHAGE_REFERENCE_EXERCISE_PACKAGE = createExercisePackage({
  packageId:"russicaptor.pressure-dependent-hemorrhage-reference", packageVersion:"1.0.0", definition:Object.freeze({
    ...structuredClone(decompensationReferenceDefinition), exerciseTypeId:"RUSSICAPTOR_PRESSURE_DEPENDENT_HEMORRHAGE_REFERENCE",
    name:"Rõhust sõltuva verejooksu referentsõppus", description:"Üldise rõhust sõltuva verejooksu tehniline vastuvõtufixtuur." }),
  patientDatasetId:"patients.pressure-dependent-hemorrhage-reference.v1", enabledPatientProcesses:decompensationReferenceDefinition.enabledPatientProcesses,
  enabledAnalyticsProviders:decompensationReferenceDefinition.enabledAnalyticsProviders, enabledMetricProviders:decompensationReferenceDefinition.enabledMetricProviders,
  requiredClinicalModules:Object.freeze([
    {moduleId:PELVIC_INJURY_MODULE_ID,version:PELVIC_INJURY_MODULE_VERSION},
    {moduleId:MASSIVE_TRANSFUSION_MODULE_ID,version:MASSIVE_TRANSFUSION_MODULE_VERSION},
  ]),
  metadata:{name:"Rõhust sõltuva verejooksu referentspakett",description:"WP-48A opt-in tehniline referents; ei vali Narva paketi määra.",author:"RussiCaptor",organization:"RussiCaptor",createdVersion:"0.8.0",exerciseType:"TRAUMA",tags:["canonical","hemorrhage","pressure-dependent","reference","technical"]},
});
