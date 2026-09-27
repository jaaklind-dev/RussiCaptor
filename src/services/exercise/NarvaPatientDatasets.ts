import type { GoldenFixture } from "@/models/GoldenTest";
import { MTP_REFERENCE_CONFIGURATION, WP47C_DEFAULT_DELIVERY_CONFIGURATION,
  UNLIMITED_BLOOD_PRODUCT_INVENTORY, type MassiveTransfusionConfiguration } from "@/models/MassiveTransfusion";
import type { PackagePatientDataset } from "@/models/exercise/PackagePatientDataset";
import { PELVIC_INJURY_REFERENCE_PATIENT } from "@/modules/pelvicInjury/PelvicInjuryReference";
import { PLEURAL_INJURY_REFERENCE } from "@/modules/pleuralInjury/PleuralInjuryReference";

export const NARVA_TRAUMA_DATASET_ID = "patients.narva-trauma.v1";
export const NARVA_TRAUMA_OXYGEN_DATASET_ID = "patients.narva-trauma.v2";
export const NARVA_TRAUMA_OUTDOOR_DATASET_ID = "patients.narva-trauma.v3";
export const NARVA_IRO_HISTORICAL_DATASET_ID = "patients.narva-iro-evacuation.v1";
export const NARVA_IRO_DATASET_ID = "patients.narva-iro-evacuation.v2";

export const NARVA_PELVIC_INJURY_TIME_SEC = -5 * 60;
export const NARVA_CHEST_INJURY_TIME_SEC = -30 * 60;
export const NARVA_CHEST_BLEEDING_RATE_ML_MIN = 200 / 60;

const resource = (resourceId: string, type: string, metadata: Record<string, unknown> = {}) =>
  Object.freeze({ resourceId, type, status: "AVAILABLE", metadata: Object.freeze(metadata) });

const traumaResources = (patientSuffix: string, includeOxygen = false) => Object.freeze({ resources: Object.freeze([
  ...(includeOxygen ? [resource(`O2-MASK-${patientSuffix}-1`, "oxygenMask")] : []),
  resource(`PB-${patientSuffix}-1`, "pelvicBinder"),
  resource(`PIV-${patientSuffix}-1`, "peripheralIV"),
  resource(`PIV-${patientSuffix}-2`, "peripheralIV"),
  resource(`CVC-${patientSuffix}-1`, "centralVenousCatheter"),
  resource(`IO-${patientSuffix}-1`, "intraosseousAccess"),
  resource(`PUMP-${patientSuffix}-1`, "infusionPump"),
  resource(`PUMP-${patientSuffix}-2`, "infusionPump"),
  resource(`ETT-${patientSuffix}-1`, "endotrachealTube"),
  resource(`DL-${patientSuffix}-1`, "directLaryngoscope"),
  resource(`VL-${patientSuffix}-1`, "videoLaryngoscope"),
  resource(`VENT-${patientSuffix}-1`, "ventilator"),
  resource(`DRAIN-${patientSuffix}-1`, "chestDrain"),
  resource(`BLOOD-SET-${patientSuffix}-1`, "bloodAdministrationSet"),
  resource(`PRESSURE-${patientSuffix}-1`, "pressureBag"),
  resource(`RAPID-${patientSuffix}-1`, "rapidInfuser"),
  resource(`MONITOR-${patientSuffix}-1`, "monitor"),
]) });

export const NARVA_TRAUMA_MTP_CONFIGURATION: MassiveTransfusionConfiguration = Object.freeze({
  ...structuredClone(MTP_REFERENCE_CONFIGURATION),
  initialInventory: Object.freeze({ RBC: UNLIMITED_BLOOD_PRODUCT_INVENTORY,
    PLASMA: UNLIMITED_BLOOD_PRODUCT_INVENTORY, PLATELETS: 0 }),
  bloodProductDelivery: WP47C_DEFAULT_DELIVERY_CONFIGURATION,
  vitalResponsePer1000Ml: Object.freeze({ heartRateDelta: -35, systolicBpDelta: 35,
    diastolicBpDelta: 20, crtDelta: -2 }),
});

const pelvicReferenceSource = PELVIC_INJURY_REFERENCE_PATIENT.hemorrhageSources[0];
const pelvicSource = Object.freeze({ ...structuredClone(pelvicReferenceSource),
  configuration: Object.freeze({ ...structuredClone(pelvicReferenceSource.configuration),
    baselineBleedingRateMlMin: 140, binderEfficiency: 0.6,
    coagulation: Object.freeze({ ...structuredClone(pelvicReferenceSource.configuration.coagulation ?? {}),
      fibrinogenDeficiencyFactor: 1.25, fibrinogenCorrectionPerGram: 0.05 }) }) });

export const NARVA_PELVIC_FIXTURE: GoldenFixture = Object.freeze({
  fixtureId: "FX-NARVA-PELVIC-1.0.0", fixtureType: "PROCESS", patientId: "PT-PELVIC-001",
  seed: 4501, clockState: "RUNNING", ownershipVersion: 1,
  loadedModules: Object.freeze(["PELVIC_INJURY_V1", "HYPOXIA_V1", "MASSIVE_TRANSFUSION_V1"]),
  activeResources: traumaResources("PELVIC"),
  initialState: Object.freeze({
    baselineVitals: Object.freeze({ hr: 118, sbp: 110, dbp: 70, rr: 24, spo2: 97, gcs: 15 }),
    injuryTimeSec: NARVA_PELVIC_INJURY_TIME_SEC,
    injuryTimeAuthority: "EXERCISE_SIMULATION_TIME",
    processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV-NARVA-PELVIC",
    ventilationReserve: 85, reserveLossPerMin: 0, co2Burden: 30, co2GainPerMin: 0,
    hemorrhageSources: Object.freeze([Object.freeze(pelvicSource)]),
    massiveTransfusion: Object.freeze({ configuration: NARVA_TRAUMA_MTP_CONFIGURATION }),
  }),
});

const chestPleural = Object.freeze({ ...structuredClone(PLEURAL_INJURY_REFERENCE.pleuralInjury),
  processId: "PT-CHEST-001:PLEURAL:1", instanceKey: "PT-CHEST-001:pleural:1",
  configuration: Object.freeze({
  ...structuredClone(PLEURAL_INJURY_REFERENCE.pleuralInjury.configuration),
  initialBloodBurdenMl: 1450,
  initialDrainageVolumeMl: 1450,
  ongoingDrainOutputRateMlMin: NARVA_CHEST_BLEEDING_RATE_ML_MIN,
}) });
const chestRespiratory = Object.freeze({ ...structuredClone(PLEURAL_INJURY_REFERENCE.respiratoryFailure),
  processId: "PT-CHEST-001:RESPIRATORY_FAILURE:1", instanceKey: "PT-CHEST-001:respiratory:1",
  respiratoryRate: 34 });
const chestHypoxia = Object.freeze({ ...structuredClone(PLEURAL_INJURY_REFERENCE.hypoxia),
  processId: "PT-CHEST-001:HYPOXIA:1", instanceKey: "PT-CHEST-001:hypoxia:1", spo2: 85 });
const chestHemorrhage = structuredClone(PLEURAL_INJURY_REFERENCE.hemorrhageSources[0]);
chestHemorrhage.processId = "PT-CHEST-001:HEMORRHAGE:THORACIC_1";
chestHemorrhage.instanceKey = "PT-CHEST-001:hemorrhage:thoracic";
chestHemorrhage.configuration = Object.freeze({ ...chestHemorrhage.configuration,
  baselineBleedingRateMlMin: NARVA_CHEST_BLEEDING_RATE_ML_MIN,
  bleedingRateAfterPleuralDrainageMlMin: NARVA_CHEST_BLEEDING_RATE_ML_MIN });

export const NARVA_CHEST_FIXTURE: GoldenFixture = Object.freeze({
  fixtureId: "FX-NARVA-CHEST-1.0.0", fixtureType: "PROCESS", patientId: "PT-CHEST-001",
  seed: 4502, clockState: "RUNNING", ownershipVersion: 1,
  loadedModules: Object.freeze(["PLEURAL_INJURY_V1", "RESPIRATORY_FAILURE_V1", "HYPOXIA_V1", "MASSIVE_TRANSFUSION_V1"]),
  activeResources: traumaResources("CHEST"),
  initialState: Object.freeze({
    baselineVitals: Object.freeze({ hr: 125, sbp: 103, dbp: 65, rr: 34, spo2: 85, gcs: 15 }),
    injuryTimeSec: NARVA_CHEST_INJURY_TIME_SEC,
    injuryTimeAuthority: "EXERCISE_SIMULATION_TIME",
    processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV-NARVA-CHEST",
    ventilationReserve: 45, reserveLossPerMin: 0, co2Burden: 45, co2GainPerMin: 0,
    pleuralInjury: Object.freeze(chestPleural), respiratoryFailure: chestRespiratory,
    hypoxia: chestHypoxia, hemorrhageSources: Object.freeze([Object.freeze(chestHemorrhage)]),
    massiveTransfusion: Object.freeze({ configuration: NARVA_TRAUMA_MTP_CONFIGURATION }),
  }),
});

export const NARVA_TRAUMA_PATIENT_DATASET: PackagePatientDataset = Object.freeze({
  datasetId: NARVA_TRAUMA_DATASET_ID, version: "1",
  patients: Object.freeze([
    Object.freeze({ patient: Object.freeze({ id: "PT-PELVIC-001", isikukood: "NARVA-TRAUMA-PELVIC-001",
      name: "Narva vaagnatrauma patsient", triage: "P1" as const, status: "Active" as const,
      location: "NARVA_ED", lastSeen: "T+0", mist: Object.freeze({ mechanism: "Trauma",
        injuries: "Open-book vaagnavigastus", signs: "Raske vaagnavalu ja sisemine verejooks",
        treatment: "Ravimata" }) }), initialLocationId: "NARVA_ED", runtimeFixture: NARVA_PELVIC_FIXTURE }),
    Object.freeze({ patient: Object.freeze({ id: "PT-CHEST-001", isikukood: "NARVA-TRAUMA-CHEST-001",
      name: "Narva rindkeretrauma patsient", triage: "P1" as const, status: "Active" as const,
      location: "NARVA_ED", lastSeen: "T+0", mist: Object.freeze({ mechanism: "Trauma",
        injuries: "Massiivne hemopneumotooraks", signs: "Hüpoksia, hingamispuudulikkus ja rindkeresisene verejooks",
        treatment: "Ravimata" }) }), initialLocationId: "NARVA_ED", runtimeFixture: NARVA_CHEST_FIXTURE }),
  ]),
});

const narvaChestOxygenFixture: GoldenFixture = Object.freeze({
  ...structuredClone(NARVA_CHEST_FIXTURE),
  fixtureId: "FX-NARVA-CHEST-1.0.2",
  activeResources: traumaResources("CHEST", true),
});

/** Narva trauma v2 adds only the source-backed P02 oxygen-mask resource. */
export const NARVA_TRAUMA_OXYGEN_PATIENT_DATASET: PackagePatientDataset = Object.freeze({
  datasetId: NARVA_TRAUMA_OXYGEN_DATASET_ID,
  version: "2",
  patients: Object.freeze(NARVA_TRAUMA_PATIENT_DATASET.patients.map(record => Object.freeze({
    patient: record.patient,
    ...(record.patient.id === "PT-CHEST-001"
      ? { runtimeFixture: narvaChestOxygenFixture }
      : record.runtimeFixture ? { runtimeFixture: record.runtimeFixture } : {}),
  }))),
});

/** Narva trauma v3 restores P01's authoritative hospital-outdoor starting location. */
export const NARVA_TRAUMA_OUTDOOR_PATIENT_DATASET: PackagePatientDataset = Object.freeze({
  datasetId: NARVA_TRAUMA_OUTDOOR_DATASET_ID,
  version: "3",
  patients: Object.freeze(NARVA_TRAUMA_OXYGEN_PATIENT_DATASET.patients.map(record => Object.freeze({
    patient: Object.freeze({ ...record.patient,
      location: record.patient.id === "PT-PELVIC-001" ? "NARVA_HOSPITAL_OUTDOOR" : record.patient.location }),
    initialLocationId: record.patient.id === "PT-PELVIC-001" ? "NARVA_HOSPITAL_OUTDOOR" : record.patient.location,
    ...(record.runtimeFixture ? { runtimeFixture: record.runtimeFixture } : {}),
  }))),
});

export const NARVA_IRO_HISTORICAL_REQUIRED_CAPABILITY_GAPS = Object.freeze([
  "PROPOFOL", "ROCURONIUM_NEUROMUSCULAR_BLOCKADE", "TOF_RASS_BIS",
  "PACKAGE_BOUND_VASOPRESSOR_FAULT_STATE_MACHINE", "PACKAGE_BOUND_VENTILATION_FAULT_STATE_MACHINE",
  "CAUSE_GATED_PEA_ROSC", "ACTIVE_TREATMENT_FIXTURE_BOOTSTRAP",
] as const);

/** Exact historical IRO fixture introduced by bf0d76e. */
export const NARVA_IRO_HISTORICAL_FIXTURE: GoldenFixture = Object.freeze({
  fixtureId: "FX-NARVA-IRO-EVACUATION-1.0.0", fixtureType: "PROCESS", patientId: "PT-IRO-001",
  seed: 4510, clockState: "RUNNING", ownershipVersion: 1,
  loadedModules: Object.freeze(["AIRWAY_V1", "RESPIRATORY_FAILURE_V1", "HYPOXIA_V1", "MEDICATION_CORE_V1", "ALS_V1", "CARDIAC_ARREST_V1"]),
  activeResources: Object.freeze({ resources: Object.freeze([
    resource("ETT-IRO-1", "endotrachealTube", { initiallyInUse: true }),
    resource("VENT-IRO-1", "ventilator", { initiallyInUse: true }),
    resource("PIV-IRO-1", "peripheralIV", { initiallyEstablished: true }),
    resource("CVC-IRO-1", "centralVenousCatheter", { initiallyEstablished: true }),
    resource("PUMP-IRO-1", "infusionPump"), resource("PUMP-IRO-2", "infusionPump"),
    resource("PUMP-IRO-3", "infusionPump"), resource("MONITOR-IRO-1", "monitor"),
    resource("CAPNO-IRO-1", "capnography"), resource("OXYGEN-IRO-1", "oxygen"),
  ]) }),
  initialState: Object.freeze({
    baselineVitals: Object.freeze({ hr: 92, sbp: 105, dbp: 62, rr: 14, spo2: 96, etco2: 4.8, gcs: 3 }),
    patientWeightKg: 70,
    requiredInitialSupport: Object.freeze({
      airway: "INTUBATED", ventilation: Object.freeze({ mode: "VOLUME_CONTROL", tidalVolumeMl: 420,
        respiratoryRate: 14, fio2: 0.4, peepCmH2O: 8 }),
      norepinephrineMicrogramsPerKgMin: 0.08, remifentanil: "CONTINUOUS_INFUSION",
      vascularAccessCount: 2, monitoring: Object.freeze(["ECG", "SPO2", "NIBP", "ETCO2"]),
      nonDigitalChecklist: Object.freeze(["URINARY_CATHETER", "NGT_OPTIONAL"]),
    }),
    scenarioReadiness: "INCOMPLETE_REQUIRED_CAPABILITIES",
    missingCapabilities: NARVA_IRO_HISTORICAL_REQUIRED_CAPABILITY_GAPS,
  }),
});

export const NARVA_IRO_HISTORICAL_PATIENT_DATASET: PackagePatientDataset = Object.freeze({
  datasetId: NARVA_IRO_HISTORICAL_DATASET_ID, version: "1",
  patients: Object.freeze([Object.freeze({ patient: Object.freeze({ id: "PT-IRO-001",
    isikukood: "NARVA-IRO-001", name: "Narva IRO evakuatsioonipatsient", triage: "P1" as const,
    status: "Active" as const, location: "IRO", lastSeen: "T+0", mist: Object.freeze({
      mechanism: "IRO evakuatsioon", injuries: "Kriitiliselt haige intubeeritud patsient",
      signs: "Ventilaator- ja vasopressorsõltuv", treatment: "Intubatsioon, ventilatsioon ja norepinefriin" }) }),
    initialLocationId: "IRO", runtimeFixture: NARVA_IRO_HISTORICAL_FIXTURE })]),
});

export const NARVA_IRO_REQUIRED_CAPABILITY_GAPS = Object.freeze([] as const);

export const NARVA_IRO_FIXTURE: GoldenFixture = Object.freeze({
  fixtureId: "FX-NARVA-IRO-EVACUATION-1.0.1", fixtureType: "PROCESS", patientId: "PT-IRO-001",
  seed: 4510, clockState: "RUNNING", ownershipVersion: 1,
  loadedModules: Object.freeze(["AIRWAY_V1", "RESPIRATORY_FAILURE_V1", "HYPOXIA_V1", "MEDICATION_CORE_V1", "ALS_V1", "CARDIAC_ARREST_V1"]),
  activeResources: Object.freeze({ resources: Object.freeze([
    resource("ETT-IRO-1", "endotrachealTube", { initiallyInUse: true }),
    resource("VENT-IRO-1", "ventilator", { initiallyInUse: true }),
    resource("PIV-IRO-1", "peripheralIV", { initiallyEstablished: true }),
    resource("CVC-IRO-1", "centralVenousCatheter", { initiallyEstablished: true }),
    resource("PUMP-IRO-1", "infusionPump"), resource("PUMP-IRO-2", "infusionPump"),
    resource("PUMP-IRO-3", "infusionPump"), resource("MONITOR-IRO-1", "monitor"),
    resource("CAPNO-IRO-1", "capnography"), resource("OXYGEN-IRO-1", "oxygen"),
  ]) }),
  initialState: Object.freeze({
    baselineVitals: Object.freeze({ hr: 92, sbp: 105, dbp: 62, rr: 14, spo2: 96, etco2: 4.8, gcs: 3 }),
    processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV-NARVA-IRO",
    ventilationReserve: 85, reserveLossPerMin: 0, co2Burden: 30, co2GainPerMin: 0,
    patientWeightKg: 70,
    narvaIroScenario: true,
    narvaIroInitialTreatments: true,
    requiredInitialSupport: Object.freeze({
      airway: "INTUBATED", ventilation: Object.freeze({ mode: "VOLUME_CONTROL", tidalVolumeMl: 420,
        respiratoryRate: 14, fio2: 0.4, peepCmH2O: 8 }),
      norepinephrineMicrogramsPerKgMin: 0.08, remifentanil: "CONTINUOUS_INFUSION",
      vascularAccessCount: 2, monitoring: Object.freeze(["ECG", "SPO2", "NIBP", "ETCO2"]),
      nonDigitalChecklist: Object.freeze(["URINARY_CATHETER", "NGT_OPTIONAL"]),
    }),
    scenarioReadiness: "READY_FOR_PHYSICAL_REHEARSAL",
    missingCapabilities: NARVA_IRO_REQUIRED_CAPABILITY_GAPS,
  }),
});

export const NARVA_IRO_PATIENT_DATASET: PackagePatientDataset = Object.freeze({
  datasetId: NARVA_IRO_DATASET_ID, version: "2",
  patients: Object.freeze([Object.freeze({ patient: Object.freeze({ id: "PT-IRO-001",
    isikukood: "NARVA-IRO-001", name: "Narva IRO evakuatsioonipatsient", triage: "P1" as const,
    status: "Active" as const, location: "IRO", lastSeen: "T+0", mist: Object.freeze({
      mechanism: "IRO evakuatsioon", injuries: "Kriitiliselt haige intubeeritud patsient",
      signs: "Ventilaator- ja vasopressorsõltuv", treatment: "Intubatsioon, ventilatsioon ja norepinefriin" }) }),
    initialLocationId: "IRO", runtimeFixture: NARVA_IRO_FIXTURE })]),
});
