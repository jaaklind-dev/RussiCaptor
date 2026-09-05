import type { ClinicalFeatureContract } from "@/models/ClinicalFeatureContract";
import type {
  AlsMedicationAdministrationState,
  AlsMedicationCommand,
  AlsMedicationProductConfiguration,
  Erc2025AdultAlsProfile,
} from "@/models/AlsMedication";
import { ERC_2025_ADULT_ALS_PROFILE_ID } from "@/models/AlsMedication";

const product = (value: AlsMedicationProductConfiguration): AlsMedicationProductConfiguration => Object.freeze({
  ...value, aliases: Object.freeze([...value.aliases]), routes: Object.freeze([...value.routes]),
  referenceDoses: Object.freeze([...value.referenceDoses]),
});

export const ERC_2025_ADULT_ALS_PRODUCTS: readonly AlsMedicationProductConfiguration[] = Object.freeze([
  product({ schemaVersion: 1, drugId: "ADRENALINE", displayName: "Adrenaline", aliases: ["EPINEPHRINE"],
    context: "CARDIAC_ARREST", routes: ["IV", "IO"], doseUnit: "MG", referenceDoses: [1],
    modeledEffect: "ARREST_VASOACTIVE", effectDurationSec: 180 }),
  product({ schemaVersion: 1, drugId: "AMIODARONE", displayName: "Amiodarone", aliases: [],
    context: "CARDIAC_ARREST", routes: ["IV", "IO"], doseUnit: "MG", referenceDoses: [300, 150],
    modeledEffect: "ANTIARRHYTHMIC", effectDurationSec: 600 }),
  product({ schemaVersion: 1, drugId: "LIDOCAINE", displayName: "Lidocaine", aliases: [],
    context: "CARDIAC_ARREST", routes: ["IV", "IO"], doseUnit: "MG", referenceDoses: [100, 50],
    modeledEffect: "ANTIARRHYTHMIC", effectDurationSec: 600 }),
  product({ schemaVersion: 1, drugId: "ATROPINE", displayName: "Atropine", aliases: [],
    context: "PERI_ARREST", routes: ["IV"], doseUnit: "MCG", referenceDoses: [500],
    modeledEffect: "BRADYCARDIA_RATE", effectDurationSec: 300 }),
  product({ schemaVersion: 1, drugId: "ADENOSINE", displayName: "Adenosine", aliases: [],
    context: "PERI_ARREST", routes: ["IV"], doseUnit: "MG", referenceDoses: [6, 12, 18],
    modeledEffect: "TRANSIENT_AV_NODAL", effectDurationSec: 10 }),
  product({ schemaVersion: 1, drugId: "MAGNESIUM_SULFATE", displayName: "Magnesium sulfate", aliases: [],
    context: "PERI_ARREST", routes: ["IV", "IO"], doseUnit: "MG", referenceDoses: [2000],
    modeledEffect: "TORSADES_SUSCEPTIBILITY", effectDurationSec: 600 }),
  product({ schemaVersion: 1, drugId: "CALCIUM_CHLORIDE", displayName: "Calcium chloride 10%", aliases: [],
    context: "REVERSIBLE_CAUSE", routes: ["IV"], doseUnit: "ML", referenceDoses: [10],
    concentrationId: "CALCIUM_CHLORIDE_10_PERCENT", modeledEffect: "DEFERRED_SUBSTRATE", effectDurationSec: 0 }),
  product({ schemaVersion: 1, drugId: "SODIUM_BICARBONATE", displayName: "Sodium bicarbonate", aliases: [],
    context: "REVERSIBLE_CAUSE", routes: ["IV", "IO"], doseUnit: "MMOL", referenceDoses: [50],
    modeledEffect: "DEFERRED_SUBSTRATE", effectDurationSec: 0 }),
]);

export const erc2025AdultAlsProductById = new Map(ERC_2025_ADULT_ALS_PRODUCTS.map(item => [item.drugId, item]));

export const ERC_2025_ADULT_ALS_PROFILE: Erc2025AdultAlsProfile = Object.freeze({
  profileId: ERC_2025_ADULT_ALS_PROFILE_ID,
  version: "2025.1",
  adrenaline: Object.freeze({ doseMg: 1, repeatMinSec: 180, repeatMaxSec: 300,
    firstShockableDoseAfterShock: 3 }),
  amiodarone: Object.freeze({ doseSequenceMg: Object.freeze([300, 150] as const),
    shockSequence: Object.freeze([3, 5] as const) }),
  lidocaine: Object.freeze({ doseSequenceMg: Object.freeze([100, 50] as const),
    shockSequence: Object.freeze([3, 5] as const) }),
  atropine: Object.freeze({ doseMcg: 500, repeatMinSec: 180, repeatMaxSec: 300,
    maximumCumulativeMcg: 3000 }),
  adenosine: Object.freeze({ doseSequenceMg: Object.freeze([6, 12, 18] as const), rapidIvOnly: true }),
  magnesium: Object.freeze({ doseMg: 2000, equivalentMmol: 8 }),
  calciumChloride: Object.freeze({ doseMl: 10, concentrationId: "CALCIUM_CHLORIDE_10_PERCENT" }),
  sodiumBicarbonate: Object.freeze({ doseMmol: 50 }),
  products: ERC_2025_ADULT_ALS_PRODUCTS,
});

export const alsMedicationClinicalFeatureContracts: readonly ClinicalFeatureContract<
  string, AlsMedicationCommand, AlsMedicationAdministrationState, AlsMedicationProductConfiguration
>[] = Object.freeze(ERC_2025_ADULT_ALS_PRODUCTS.map(configuration => Object.freeze({
  featureId: configuration.drugId,
  category: "MEDICATION" as const,
  schemaVersion: 1,
  configuration,
  input: Object.freeze({ unit: configuration.doseUnit, actions: Object.freeze(["ADMINISTER"]),
    validate: () => Object.freeze([]) }),
  authoritativeState: Object.freeze({ lifecycle: Object.freeze(["COMPLETED"] as const),
    persistedFields: Object.freeze(["administrationId", "commandId", "patientId", "drugId", "route",
      "vascularAccessId", "dose", "doseUnit", "simulationTimeSec", "rhythmAtAdministration",
      "shockCountAtAdministration", "protocolClassification", "modeledEffect", "physiologyStatus"]) }),
  determinism: Object.freeze({ clock: "SIMULATION_TIME" as const, wallClockAllowed: false as const }),
  physiology: Object.freeze({ order: Object.freeze(["AUTHORITATIVE_RHYTHM", "GUIDELINE_CLASSIFICATION",
    "MEDICATION_EFFECT", "RHYTHM_ENGINE"]), combine: "VITAL_SIGN_MEDICATION_LAYER" as const,
    contributors: () => Object.freeze([]) }),
  persistence: Object.freeze({ boundary: "RUNTIME_CHECKPOINT" as const, detached: true as const }),
  idempotency: Object.freeze({ key: "COMMAND_ID" as const, duplicateEffectAllowed: false as const }),
  visibility: Object.freeze({ assessment: true as const, debug: true as const }),
  regressionIsolation: Object.freeze({ absentFeatureChangesBaseline: false as const }),
})));
