import type { GoldenFixture } from "@/models/GoldenTest";
import type { Patient } from "@/models/Patient";
import type { PackagePatientDataset } from "@/models/exercise/PackagePatientDataset";
import { patients as demoPatients } from "@/data/patients";
import { BOTULISM_JOHVI_PATIENTS } from "@/data/botulismJohviPatients";
import { PELVIC_HEMORRHAGE_REFERENCE_CONFIGURATION, PELVIC_INJURY_REFERENCE_PATIENT } from "@/modules/pelvicInjury/PelvicInjuryReference";
import { PLEURAL_INJURY_REFERENCE } from "@/modules/pleuralInjury/PleuralInjuryReference";
import { CARDIAC_ARREST_REFERENCE_FIXTURE } from "@/services/golden/CardiacArrestReferenceFixture";
import { PackagePatientDatasetRegistry } from "./PackagePatientMaterializationService";
import { MTP_REFERENCE_CONFIGURATION, WP47C_DEFAULT_DELIVERY_CONFIGURATION } from "@/models/MassiveTransfusion";

const clone = (patient: Patient): Patient => ({ ...patient, mist: { ...patient.mist } });
const dataset = (datasetId: string, records: PackagePatientDataset["patients"]): PackagePatientDataset => Object.freeze({ datasetId, version: datasetId.split(".v").at(-1)!, patients: Object.freeze(records) });
const normal = (datasetId: string) => dataset(datasetId, demoPatients.map(patient => Object.freeze({ patient: Object.freeze(clone(patient)) })));
const botulismJohvi = dataset("patients.botulism-johvi.v2", BOTULISM_JOHVI_PATIENTS.map(patient => Object.freeze({ patient })));
const cardiacFixture = (patientId: string): GoldenFixture => Object.freeze({ ...structuredClone(CARDIAC_ARREST_REFERENCE_FIXTURE), patientId });

export const pelvicReferencePatient: Patient = Object.freeze({ id: PELVIC_INJURY_REFERENCE_PATIENT.patientId, isikukood: "39011230056", name: "Pelvic Injury Reference", triage: "P1", status: "Active", location: "Resus", lastSeen: "T+0", mist: Object.freeze({ mechanism: "Fall from height", injuries: "Open-book pelvic injury", signs: "Progressive hemorrhagic deterioration", treatment: "No treatment yet" }) });
export const pelvicReferenceFixture: GoldenFixture = Object.freeze({ fixtureId: "FX-PELVIC-REFERENCE", fixtureType: "PROCESS", patientId: pelvicReferencePatient.id, seed: 43, clockState: "RUNNING", ownershipVersion: 1, loadedModules: Object.freeze(["PELVIC_INJURY_V1", "HYPOXIA_V1"]), activeResources: Object.freeze({ resources: Object.freeze([{ resourceId: "PB-1", type: "pelvicBinder", status: "AVAILABLE", metadata: Object.freeze({}) }]) }), initialState: Object.freeze({ processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV-NEUTRAL", ventilationReserve: 70, reserveLossPerMin: 0, co2Burden: 30, co2GainPerMin: 0, hypoxia: Object.freeze({ templateId: "HYP-CONTROL", oxygenationReserve: 75, spo2: 94, reserveLossPerMin: 0 }), hemorrhageSources: PELVIC_INJURY_REFERENCE_PATIENT.hemorrhageSources }) });
/**
 * Technical composition fixture: replacement volume reverses the same
 * per-mL circulation contribution used by this fixture's pelvic hemorrhage.
 * Product volumes/rates and canonical MTP physiology remain unchanged.
 */
export const MTP_PELVIC_REFERENCE_CONFIGURATION = Object.freeze({
  ...MTP_REFERENCE_CONFIGURATION,
  bloodProductDelivery: WP47C_DEFAULT_DELIVERY_CONFIGURATION,
  vitalResponsePer1000Ml: Object.freeze({
    heartRateDelta: -PELVIC_HEMORRHAGE_REFERENCE_CONFIGURATION.vitalResponsePer1000Ml!.heartRateDelta!,
    systolicBpDelta: -PELVIC_HEMORRHAGE_REFERENCE_CONFIGURATION.vitalResponsePer1000Ml!.systolicBpDelta!,
    diastolicBpDelta: -PELVIC_HEMORRHAGE_REFERENCE_CONFIGURATION.vitalResponsePer1000Ml!.diastolicBpDelta!,
    crtDelta: -PELVIC_HEMORRHAGE_REFERENCE_CONFIGURATION.vitalResponsePer1000Ml!.crtDelta!,
  }),
});
export const mtpReferenceFixture: GoldenFixture = Object.freeze({ ...structuredClone(pelvicReferenceFixture), fixtureId: "FX-MTP-REFERENCE",
  loadedModules: Object.freeze(["PELVIC_INJURY_V1", "HYPOXIA_V1", "MASSIVE_TRANSFUSION_V1"]),
  activeResources: Object.freeze({ resources: Object.freeze([
    { resourceId: "PB-1", type: "pelvicBinder", status: "AVAILABLE", metadata: Object.freeze({}) },
    { resourceId: "PIV-1", type: "peripheralIV", status: "AVAILABLE", metadata: Object.freeze({}) },
    { resourceId: "PIV-2", type: "peripheralIV", status: "AVAILABLE", metadata: Object.freeze({}) },
    { resourceId: "CVC-1", type: "centralVenousCatheter", status: "AVAILABLE", metadata: Object.freeze({}) },
  ]) }),
  initialState: Object.freeze({ ...(structuredClone(pelvicReferenceFixture.initialState) as Record<string, unknown>), massiveTransfusion: Object.freeze({ configuration: MTP_PELVIC_REFERENCE_CONFIGURATION }) }) });
export const pleuralReferencePatient: Patient = Object.freeze({ id: PLEURAL_INJURY_REFERENCE.patientId, isikukood: "39011230064", name: "Pleural Injury Reference", triage: "P1", status: "Active", location: "Resus", lastSeen: "T+0", mist: Object.freeze({ mechanism: "Blunt thoracic trauma", injuries: "Massive hemopneumothorax", signs: "Hypoxia, respiratory distress and progressive blood loss", treatment: "No treatment yet" }) });
export const pleuralReferenceFixture: GoldenFixture = Object.freeze({ fixtureId: "FX-PLEURAL-REFERENCE", fixtureType: "PROCESS", patientId: pleuralReferencePatient.id, seed: 44, clockState: "RUNNING", ownershipVersion: 1,
  loadedModules: Object.freeze(["PLEURAL_INJURY_V1", "RESPIRATORY_FAILURE_V1", "HYPOXIA_V1"]),
  activeResources: Object.freeze({ resources: Object.freeze([{ resourceId: "CD-1", type: "chestDrain", status: "AVAILABLE", metadata: Object.freeze({}) }]) }),
  initialState: Object.freeze({ processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV-NEUTRAL", ventilationReserve: 70, reserveLossPerMin: 0, co2Burden: 30, co2GainPerMin: 0,
    pleuralInjury: PLEURAL_INJURY_REFERENCE.pleuralInjury, respiratoryFailure: PLEURAL_INJURY_REFERENCE.respiratoryFailure,
    hypoxia: PLEURAL_INJURY_REFERENCE.hypoxia, hemorrhageSources: PLEURAL_INJURY_REFERENCE.hemorrhageSources }) });

const WP45B_THORACIC_BLEEDING_RATE_ML_MIN = 400 / 60;
export const pleuralWp45bPatient: Patient = Object.freeze({ id: "PT-PLEURAL-WP45B-001", isikukood: "50101010009", name: "WP-45B Pleural Acceptance", triage: "P1", status: "Active", location: "Resus", lastSeen: "T+0", mist: Object.freeze({ mechanism: "Blunt thoracic trauma", injuries: "Massive hemopneumothorax", signs: "Hypoxia, respiratory distress and ongoing thoracic blood loss", treatment: "No treatment yet" }) });
export const pleuralWp45bFixture: GoldenFixture = Object.freeze({ fixtureId: "FX-PLEURAL-WP45B-1.1", fixtureType: "PROCESS", patientId: pleuralWp45bPatient.id, seed: 45, clockState: "RUNNING", ownershipVersion: 1,
  loadedModules: Object.freeze(["PLEURAL_INJURY_V1", "RESPIRATORY_FAILURE_V1", "HYPOXIA_V1"]),
  activeResources: Object.freeze({ resources: Object.freeze([{ resourceId: "CD-WP45B-1", type: "chestDrain", status: "AVAILABLE", metadata: Object.freeze({}) }]) }),
  initialState: Object.freeze({ processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV-NEUTRAL", ventilationReserve: 70, reserveLossPerMin: 0, co2Burden: 30, co2GainPerMin: 0,
    pleuralInjury: Object.freeze({ ...structuredClone(PLEURAL_INJURY_REFERENCE.pleuralInjury), processId: "PT-PLEURAL-WP45B:PLEURAL:1", instanceKey: "PT-PLEURAL-WP45B:pleural:1",
      configuration: Object.freeze({ ...structuredClone(PLEURAL_INJURY_REFERENCE.pleuralInjury.configuration), initialBloodBurdenMl: 1450,
        initialDrainageVolumeMl: 1450, ongoingDrainOutputRateMlMin: WP45B_THORACIC_BLEEDING_RATE_ML_MIN,
        postDrainRespiratoryRecovery: Object.freeze({ spo2RecoveryPerMin: 10, spo2Ceiling: 94, respiratoryRateRecoveryPerMin: 8,
          respiratoryRateFloor: 30, workOfBreathingRecoveryPerMin: 10, workOfBreathingFloor: 25, fatigueRecoveryPerMin: 8, fatigueFloor: 20 }) }) }),
    respiratoryFailure: Object.freeze({ ...structuredClone(PLEURAL_INJURY_REFERENCE.respiratoryFailure), processId: "PT-PLEURAL-WP45B:RESPIRATORY_FAILURE:1", instanceKey: "PT-PLEURAL-WP45B:respiratory:1" }),
    hypoxia: Object.freeze({ ...structuredClone(PLEURAL_INJURY_REFERENCE.hypoxia), processId: "PT-PLEURAL-WP45B:HYPOXIA:1", instanceKey: "PT-PLEURAL-WP45B:hypoxia:1" }),
    hemorrhageSources: Object.freeze([{ ...structuredClone(PLEURAL_INJURY_REFERENCE.hemorrhageSources[0]), processId: "PT-PLEURAL-WP45B:HEMORRHAGE:THORACIC_1", instanceKey: "PT-PLEURAL-WP45B:hemorrhage:thoracic",
      configuration: Object.freeze({ ...structuredClone(PLEURAL_INJURY_REFERENCE.hemorrhageSources[0].configuration), baselineBleedingRateMlMin: WP45B_THORACIC_BLEEDING_RATE_ML_MIN,
        bleedingRateAfterPleuralDrainageMlMin: WP45B_THORACIC_BLEEDING_RATE_ML_MIN }), estimatedBloodLossMl: 1450 }]) }) });

export const packagePatientDatasetRegistry = new PackagePatientDatasetRegistry();
[
  normal("patients.als.v1"), normal("patients.trauma.v1"), normal("patients.mascal.v1"), normal("patients.botulism.v1"), botulismJohvi,
  normal("patients.emergency_department.v1"), normal("patients.custom.v1"),
  dataset("patients.cardiac-arrest-reference.v1", [{ patient: Object.freeze(clone(demoPatients[0])), runtimeFixture: cardiacFixture(demoPatients[0].id) }]),
  dataset("patients.als-protocol-reference.v1", [{ patient: Object.freeze(clone(demoPatients[0])), runtimeFixture: cardiacFixture(demoPatients[0].id) }]),
  dataset("patients.pelvic-injury-reference.v1", [{ patient: pelvicReferencePatient, runtimeFixture: pelvicReferenceFixture }]),
  dataset("patients.pleural-injury-reference.v1", [{ patient: pleuralReferencePatient, runtimeFixture: pleuralReferenceFixture }]),
  dataset("patients.pleural-injury-reference.v2", [{ patient: pleuralWp45bPatient, runtimeFixture: pleuralWp45bFixture }]),
  dataset("patients.runtime-continuity-reference.v1", [
    { patient: pelvicReferencePatient, runtimeFixture: pelvicReferenceFixture },
    { patient: pleuralReferencePatient, runtimeFixture: pleuralReferenceFixture },
  ]),
  dataset("patients.massive-transfusion-reference.v1", [{ patient: pelvicReferencePatient, runtimeFixture: mtpReferenceFixture }]),
].forEach(value => packagePatientDatasetRegistry.register(value));
