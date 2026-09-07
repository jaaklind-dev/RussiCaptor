import type { ClinicalTreatmentId } from "@/models/ClinicalTreatment";
import type { ExerciseDefinition } from "@/models/exercise/ExerciseDefinition";
import { ALS_MODULE_ID, ALS_MODULE_VERSION } from "@/modules/als/AlsManifest";
import { MASSIVE_TRANSFUSION_MODULE_ID, MASSIVE_TRANSFUSION_MODULE_VERSION } from "@/modules/massiveTransfusion/MassiveTransfusionManifest";
import { PELVIC_INJURY_MODULE_ID, PELVIC_INJURY_MODULE_VERSION } from "@/modules/pelvicInjury/PelvicInjuryManifest";
import { PLEURAL_INJURY_MODULE_ID, PLEURAL_INJURY_MODULE_VERSION } from "@/modules/pleuralInjury/PleuralInjuryManifest";
import { RESPIRATORY_FAILURE_MODULE_ID, RESPIRATORY_FAILURE_MODULE_VERSION } from "@/modules/respiratoryFailure/RespiratoryFailureManifest";
import { createExercisePackage } from "./ExercisePackageHash";
import { DEFAULT_EXERCISE_DEFINITION } from "./ExerciseDefinitionService";
import { NARVA_IRO_DATASET_ID, NARVA_TRAUMA_DATASET_ID } from "./NarvaPatientDatasets";

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
  "KETOPROFEN", "DEXKETOPROFEN", "NOREPINEPHRINE", "MECHANICAL_VENTILATION",
  "ADRENALINE", "AMIODARONE", "LIDOCAINE", "ATROPINE", "ADENOSINE", "MAGNESIUM_SULFATE",
  "CALCIUM_CHLORIDE", "SODIUM_BICARBONATE",
]);

const traumaDefinition = definition("RUSSICAPTOR_NARVA_TRAUMA", "Narva kahe patsiendi traumaõppus",
  "Kaks samaaegset P1 traumapatsienti, üks reanimobiil ja kaks kõrgema etapi ravisuunda.");

export const NARVA_TRAUMA_EXERCISE_PACKAGE = createExercisePackage({
  packageId: "russicaptor.narva-trauma", packageVersion: "1.0.0", definition: traumaDefinition,
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
    tags: ["narva", "trauma", "two-patient", "transport", "configuration-assumption-pending-final-local-count"] },
});

const iroDefinition = definition("RUSSICAPTOR_NARVA_IRO_EVACUATION", "Narva IRO evakuatsiooniõppus",
  "Intubeeritud ja vasopressorsõltuva patsiendi evakuatsiooni konfiguratsioon; täisstsenaarium ootab päris Runtime võimekusi.");

export const NARVA_IRO_EXERCISE_PACKAGE = createExercisePackage({
  packageId: "russicaptor.narva-iro-evacuation", packageVersion: "1.0.0", definition: iroDefinition,
  patientDatasetId: NARVA_IRO_DATASET_ID,
  enabledPatientProcesses: iroDefinition.enabledPatientProcesses,
  enabledAnalyticsProviders: iroDefinition.enabledAnalyticsProviders,
  enabledMetricProviders: iroDefinition.enabledMetricProviders,
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
