import type { ClinicalTreatmentId } from "@/models/ClinicalTreatment";
import type { ExerciseDefinition } from "@/models/exercise/ExerciseDefinition";
import { ALS_MODULE_ID, ALS_MODULE_VERSION } from "@/modules/als/AlsManifest";
import { MASSIVE_TRANSFUSION_MODULE_ID, MASSIVE_TRANSFUSION_MODULE_VERSION } from "@/modules/massiveTransfusion/MassiveTransfusionManifest";
import { PELVIC_INJURY_MODULE_ID, PELVIC_INJURY_MODULE_VERSION } from "@/modules/pelvicInjury/PelvicInjuryManifest";
import { PLEURAL_INJURY_MODULE_ID, PLEURAL_INJURY_MODULE_VERSION } from "@/modules/pleuralInjury/PleuralInjuryManifest";
import { RESPIRATORY_FAILURE_MODULE_ID, RESPIRATORY_FAILURE_MODULE_VERSION } from "@/modules/respiratoryFailure/RespiratoryFailureManifest";
import { createExercisePackage } from "./ExercisePackageHash";
import { DEFAULT_EXERCISE_DEFINITION } from "./ExerciseDefinitionService";
import { NARVA_TRAUMA_IMAGING_CONFIGURATION } from "./NarvaTraumaImagingDefinitions";
import { NARVA_IRO_DATASET_ID, NARVA_IRO_HISTORICAL_DATASET_ID,
  NARVA_TRAUMA_DATASET_ID, NARVA_TRAUMA_OXYGEN_DATASET_ID } from "./NarvaPatientDatasets";

const definition = (exerciseTypeId: string, name: string, description: string): ExerciseDefinition =>
  Object.freeze({ ...structuredClone(DEFAULT_EXERCISE_DEFINITION), exerciseTypeId, name, description,
    profile: "TRAUMA",
    enabledPatientProcesses: Object.freeze(DEFAULT_EXERCISE_DEFINITION.enabledPatientProcesses
      .filter(id => id !== "MEDICATION" && id !== "RESPIRATORY_FAILURE")),
    enabledAnalyticsProviders: Object.freeze(DEFAULT_EXERCISE_DEFINITION.enabledAnalyticsProviders
      .filter(id => id !== "core.interventions")),
    enabledMetricProviders: Object.freeze(DEFAULT_EXERCISE_DEFINITION.enabledMetricProviders
      .filter(id => id !== "core.interventions")),
  });

export const NARVA_TRAUMA_TREATMENT_PALETTE: readonly ClinicalTreatmentId[] = Object.freeze([
  "RINGER", "SODIUM_CHLORIDE_0_9", "GELOFUSIN", "TRANEXAMIC_ACID", "FENTANYL",
  "REMIFENTANIL", "KETAMINE", "ESKETAMINE", "MORPHINE", "OXYCODONE", "PARACETAMOL",
  "KETOPROFEN", "DEXKETOPROFEN", "FIBRINOGEN_CONCENTRATE", "PROPOFOL", "MIDAZOLAM", "ROCURONIUM",
  "NOREPINEPHRINE", "MECHANICAL_VENTILATION",
  "ADRENALINE", "AMIODARONE", "LIDOCAINE", "ATROPINE", "ADENOSINE", "MAGNESIUM_SULFATE",
  "CALCIUM_CHLORIDE", "SODIUM_BICARBONATE",
]);

const NARVA_TRAUMA_INTERVENTION_AVAILABILITY_V101 = Object.freeze({
  schemaVersion: 1 as const,
  packageWideResourceInterventionDefinitionIds: Object.freeze([
    "PERIPHERAL_IV_ACCESS", "INTRAOSSEOUS_ACCESS", "CENTRAL_VENOUS_ACCESS",
    "CRYSTALLOID_INFUSION", "BLOOD_PRODUCT_ADMINISTRATION", "PRESSURE_INFUSION",
    "ENDOTRACHEAL_INTUBATION", "MECHANICAL_VENTILATION",
  ]),
  packageWideSpecializedActions: Object.freeze(["CLINICAL_TREATMENT", "MTP", "TRANSPORT_START"]),
  patients: Object.freeze([
    Object.freeze({ patientId: "PT-PELVIC-001",
      allowedResourceInterventionDefinitionIds: Object.freeze(["PELVIC_BINDER_APPLICATION"]) }),
    Object.freeze({ patientId: "PT-CHEST-001",
      allowedResourceInterventionDefinitionIds: Object.freeze(["CHEST_DRAIN_INSERTION"]) }),
  ]),
});

const NARVA_TRAUMA_INTERVENTION_AVAILABILITY = Object.freeze({
  ...structuredClone(NARVA_TRAUMA_INTERVENTION_AVAILABILITY_V101),
  patients: Object.freeze(NARVA_TRAUMA_INTERVENTION_AVAILABILITY_V101.patients.map(patient =>
    patient.patientId === "PT-CHEST-001"
      ? Object.freeze({ ...patient, allowedResourceInterventionDefinitionIds: Object.freeze([
        ...patient.allowedResourceInterventionDefinitionIds, "OXYGEN_THERAPY",
      ]) })
      : patient)),
});

const traumaDefinition = definition("RUSSICAPTOR_NARVA_TRAUMA", "Narva kahe patsiendi traumaõppus",
  "Kaks samaaegset P1 traumapatsienti, üks reanimobiil ja kaks kõrgema etapi ravisuunda.");

/** Exact package content accepted before the source-backed P02 oxygen addition. */
export const NARVA_TRAUMA_EXERCISE_PACKAGE_V101 = createExercisePackage({
  packageId: "russicaptor.narva-trauma", packageVersion: "1.0.1", definition: traumaDefinition,
  patientDatasetId: NARVA_TRAUMA_DATASET_ID,
  enabledPatientProcesses: traumaDefinition.enabledPatientProcesses,
  enabledAnalyticsProviders: traumaDefinition.enabledAnalyticsProviders,
  enabledMetricProviders: traumaDefinition.enabledMetricProviders,
  requiredClinicalModules: Object.freeze([
    { moduleId: PELVIC_INJURY_MODULE_ID, version: PELVIC_INJURY_MODULE_VERSION },
    { moduleId: PLEURAL_INJURY_MODULE_ID, version: PLEURAL_INJURY_MODULE_VERSION },
    { moduleId: MASSIVE_TRANSFUSION_MODULE_ID, version: MASSIVE_TRANSFUSION_MODULE_VERSION },
    { moduleId: ALS_MODULE_ID, version: ALS_MODULE_VERSION },
  ]),
  availableClinicalTreatments: NARVA_TRAUMA_TREATMENT_PALETTE,
  interventionAvailability: NARVA_TRAUMA_INTERVENTION_AVAILABILITY_V101,
  imagingConfiguration: NARVA_TRAUMA_IMAGING_CONFIGURATION,
  transportConfiguration: Object.freeze({ version: "1.0.0", vehicleLocationId: "REANIMOBILE",
    resources: Object.freeze([Object.freeze({ resourceId: "NARVA-REANIMOBILE-01",
      resourceType: "CRITICAL_CARE_AMBULANCE", displayName: "Reanimobiil 01", capacity: 1,
      homeLocationId: "NARVA_ED" })]),
    destinations: Object.freeze([
      Object.freeze({ destinationId: "IVKH", displayName: "IVKH torakaalkeskus",
        capabilities: Object.freeze(["THORACIC_SURGERY"]), travelDurationSec: 1800,
        handoverDurationSec: 600, returnDurationSec: 1800, turnaroundDurationSec: 300 }),
      Object.freeze({ destinationId: "PERH", displayName: "PERH vaagnatraumakeskus",
        capabilities: Object.freeze(["PELVIC_DEFINITIVE_CARE"]), travelDurationSec: 7200,
        handoverDurationSec: 600, returnDurationSec: 7200, turnaroundDurationSec: 0 }),
    ]) }),
  metadata: { name: "Narva traumaõppus", description: "Narva kahe P1 traumapatsiendi versioneeritud konfiguratsioonipakett.",
    author: "RussiCaptor", organization: "RussiCaptor", createdVersion: "1.0.0", exerciseType: "TRAUMA",
    tags: ["narva", "trauma", "two-patient", "transport", "blood-inventory-finalized"] },
});

export const NARVA_TRAUMA_EXERCISE_PACKAGE = createExercisePackage({
  packageId: "russicaptor.narva-trauma", packageVersion: "1.0.2", definition: traumaDefinition,
  patientDatasetId: NARVA_TRAUMA_OXYGEN_DATASET_ID,
  enabledPatientProcesses: traumaDefinition.enabledPatientProcesses,
  enabledAnalyticsProviders: traumaDefinition.enabledAnalyticsProviders,
  enabledMetricProviders: traumaDefinition.enabledMetricProviders,
  requiredClinicalModules: NARVA_TRAUMA_EXERCISE_PACKAGE_V101.requiredClinicalModules,
  availableClinicalTreatments: NARVA_TRAUMA_TREATMENT_PALETTE,
  interventionAvailability: NARVA_TRAUMA_INTERVENTION_AVAILABILITY,
  imagingConfiguration: NARVA_TRAUMA_IMAGING_CONFIGURATION,
  transportConfiguration: NARVA_TRAUMA_EXERCISE_PACKAGE_V101.transportConfiguration,
  metadata: { ...NARVA_TRAUMA_EXERCISE_PACKAGE_V101.metadata,
    description: "Narva kahe P1 traumapatsiendi versioneeritud konfiguratsioonipakett koos P02 hapnikraviga.",
    tags: [...NARVA_TRAUMA_EXERCISE_PACKAGE_V101.metadata.tags, "p02-oxygen-therapy"],
  },
});

const historicalIroDefinition = definition("RUSSICAPTOR_NARVA_IRO_EVACUATION", "Narva IRO evakuatsiooniõppus",
  "Intubeeritud ja vasopressorsõltuva patsiendi evakuatsiooni konfiguratsioon; täisstsenaarium ootab päris Runtime võimekusi.");

/** Exact immutable package content introduced by bf0d76e. */
export const NARVA_IRO_HISTORICAL_EXERCISE_PACKAGE_V1 = createExercisePackage({
  packageId: "russicaptor.narva-iro-evacuation", packageVersion: "1.0.0",
  definition: historicalIroDefinition,
  patientDatasetId: NARVA_IRO_HISTORICAL_DATASET_ID,
  enabledPatientProcesses: historicalIroDefinition.enabledPatientProcesses,
  enabledAnalyticsProviders: historicalIroDefinition.enabledAnalyticsProviders,
  enabledMetricProviders: historicalIroDefinition.enabledMetricProviders,
  requiredClinicalModules: Object.freeze([
    { moduleId: RESPIRATORY_FAILURE_MODULE_ID, version: RESPIRATORY_FAILURE_MODULE_VERSION },
    { moduleId: ALS_MODULE_ID, version: ALS_MODULE_VERSION },
  ]),
  availableClinicalTreatments: Object.freeze(["REMIFENTANIL", "NOREPINEPHRINE",
    "MECHANICAL_VENTILATION", "ADRENALINE", "AMIODARONE", "LIDOCAINE", "ATROPINE",
    "ADENOSINE", "MAGNESIUM_SULFATE", "CALCIUM_CHLORIDE", "SODIUM_BICARBONATE"]),
  metadata: { name: "Narva IRO evakuatsioon", description: "Toetatud IRO konfiguratsiooniosa; ei väida valmisolekut enne puuduva sedatsiooni, NMB ja fault-state-machine võimekuse lisamist.",
    author: "RussiCaptor", organization: "RussiCaptor", createdVersion: "1.0.0", exerciseType: "CUSTOM",
    tags: ["narva", "iro", "evacuation", "capability-gaps-explicit", "not-full-scenario-ready"] },
});

const iroDefinition = Object.freeze({
  ...definition("RUSSICAPTOR_NARVA_IRO_EVACUATION", "Narva IRO evakuatsiooniõppus",
    "Intubeeritud ja vasopressorsõltuva patsiendi evakuatsiooni täisstsenaarium."),
  definitionVersion: 2,
});

export const NARVA_IRO_EXERCISE_PACKAGE = createExercisePackage({
  packageId: "russicaptor.narva-iro-evacuation", packageVersion: "1.0.1", definition: iroDefinition,
  patientDatasetId: NARVA_IRO_DATASET_ID,
  enabledPatientProcesses: iroDefinition.enabledPatientProcesses,
  enabledAnalyticsProviders: iroDefinition.enabledAnalyticsProviders,
  enabledMetricProviders: iroDefinition.enabledMetricProviders,
  requiredClinicalModules: Object.freeze([
    { moduleId: RESPIRATORY_FAILURE_MODULE_ID, version: RESPIRATORY_FAILURE_MODULE_VERSION },
    { moduleId: ALS_MODULE_ID, version: ALS_MODULE_VERSION },
  ]),
  availableClinicalTreatments: Object.freeze(["RINGER", "SODIUM_CHLORIDE_0_9", "GELOFUSIN", "FIBRINOGEN_CONCENTRATE",
    "PROPOFOL", "MIDAZOLAM", "REMIFENTANIL", "FENTANYL", "KETAMINE", "ESKETAMINE", "ROCURONIUM",
    "NOREPINEPHRINE", "MECHANICAL_VENTILATION", "ADRENALINE", "AMIODARONE", "LIDOCAINE", "ATROPINE",
    "ADENOSINE", "MAGNESIUM_SULFATE", "CALCIUM_CHLORIDE", "SODIUM_BICARBONATE"]),
  metadata: { name: "Narva IRO evakuatsioon", description: "Narva IRO aktiivravi, tehniliste rikete ja põhjusest sõltuva elustamise täisstsenaarium.",
    author: "RussiCaptor", organization: "RussiCaptor", createdVersion: "1.0.0", exerciseType: "CUSTOM",
    tags: ["narva", "iro", "evacuation", "active-treatment", "fault-recovery", "full-scenario-ready"] },
});
