import type {
  ClinicalTreatmentCategory,
  ClinicalTreatmentDescriptor,
  ClinicalTreatmentFieldDescriptor,
  ClinicalTreatmentId,
} from "@/models/ClinicalTreatment";
import type { FluidTherapyConfiguration, SupportedFluidType } from "@/models/FluidTherapy";
import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import { ANALGESIC_PRODUCT_CONFIGURATIONS } from "@/services/runtime/medication/AnalgesicProducts";
import { ERC_2025_ADULT_ALS_PRODUCTS, ERC_2025_ADULT_ALS_PROFILE } from
  "@/services/runtime/medication/Erc2025AdultAlsProfile";
import { GELOFUSIN_FLUID_CONFIGURATION } from "@/services/runtime/medication/GelofusinFluidTherapy";
import { DEFAULT_NOREPINEPHRINE_CONFIGURATION } from "@/services/runtime/medication/NorepinephrineInfusion";
import { RINGER_FLUID_CONFIGURATION } from "@/services/runtime/medication/RingerFluidTherapy";
import { SODIUM_CHLORIDE_0_9_CONFIGURATION } from
  "@/services/runtime/medication/SodiumChlorideFluidTherapy";
import { DEFAULT_TRANEXAMIC_ACID_CONFIGURATION } from "@/services/runtime/medication/TranexamicAcid";
import { DEFAULT_MECHANICAL_VENTILATION_CONFIGURATION } from
  "@/services/runtime/respiratory/MechanicalVentilationRuntime";

export const CLINICAL_TREATMENT_CATEGORY_LABELS: Readonly<Record<ClinicalTreatmentCategory, string>> =
  Object.freeze({ FLUIDS: "Vedelikud", HEMOSTASIS: "Hemostaas", ANALGESIA: "Analgeesia",
    VASOACTIVE: "Vasoaktiivne ravi", RESPIRATORY_SUPPORT: "Hingamistugi", ALS_MEDICATIONS: "ALS ravimid" });

const access = (routes: readonly ("IV" | "IO")[]): ClinicalTreatmentFieldDescriptor => Object.freeze({
  fieldId: "vascularAccessId", label: "Veenitee", kind: "SELECT", required: true,
  options: Object.freeze([...routes]),
});
const route = (routes: readonly ("IV" | "IO")[]): ClinicalTreatmentFieldDescriptor => Object.freeze({
  fieldId: "route", label: "Manustamisviis", kind: "SELECT", required: true,
  options: Object.freeze([...routes]), initialValue: routes[0],
});
const numeric = (fieldId: ClinicalTreatmentFieldDescriptor["fieldId"], label: string, unit: string,
  minimum: number, maximum: number, initialValue?: number): ClinicalTreatmentFieldDescriptor => Object.freeze({
    fieldId, label, kind: "NUMBER", required: true, unit, minimum, maximum,
    ...(initialValue === undefined ? {} : { initialValue: String(initialValue) }),
  });

function fluidDescriptor(configuration: FluidTherapyConfiguration<SupportedFluidType>,
  displayName: string): ClinicalTreatmentDescriptor {
  return Object.freeze({ treatmentId: configuration.fluidType, displayName, aliases: Object.freeze([]),
    category: "FLUIDS", commandKind: "FLUID", routes: Object.freeze(["IV", "IO"] as const),
    requiresVascularAccess: true, administrationModes: Object.freeze(["BOLUS", "INFUSION"]),
    fields: Object.freeze([
      Object.freeze({ fieldId: "mode", label: "Režiim", kind: "SELECT", required: true,
        options: Object.freeze(["BOLUS", "INFUSION"]), initialValue: "BOLUS" }),
      numeric("volumeMl", "Maht", "ML", 1, configuration.maximumPrescribedVolumeMl),
      numeric("rateMlHour", "Kiirus", "ML_H", 1, configuration.maximumRateMlHour),
      access(["IV", "IO"]),
    ]), supportsStart: true, supportsChange: true, supportsStop: true, treatmentShape: "INFUSION",
    configurationVersion: configuration.version });
}

const fluidDescriptors = [
  fluidDescriptor(RINGER_FLUID_CONFIGURATION, "Ringer"),
  fluidDescriptor(SODIUM_CHLORIDE_0_9_CONFIGURATION, "NaCl 0.9%"),
  fluidDescriptor(GELOFUSIN_FLUID_CONFIGURATION, "Gelofusin"),
];

const analgesicDescriptors = ANALGESIC_PRODUCT_CONFIGURATIONS.map((configuration): ClinicalTreatmentDescriptor => {
  const bolusMaximum = configuration.maximumBolusDose ?? Number.MAX_SAFE_INTEGER;
  const rateMaximum = configuration.maximumInfusionRate ?? Number.MAX_SAFE_INTEGER;
  return Object.freeze({ treatmentId: configuration.drugId, displayName: configuration.displayName,
    aliases: Object.freeze([...configuration.aliases]), category: "ANALGESIA", commandKind: "ANALGESIC",
    routes: Object.freeze([...configuration.routes]), requiresVascularAccess: true,
    administrationModes: Object.freeze([...configuration.modes]),
    fields: Object.freeze([
      Object.freeze({ fieldId: "mode", label: "Režiim", kind: "SELECT", required: true,
        options: Object.freeze([...configuration.modes]), initialValue: configuration.modes[0] }),
      route(configuration.routes),
      ...(configuration.bolusDoseUnit ? [numeric("dose", "Annus", configuration.bolusDoseUnit, 0.000001,
        bolusMaximum)] : []),
      ...(configuration.infusionRateUnit ? [numeric("doseRate", "Infusioonikiirus",
        configuration.infusionRateUnit, 0.000001, rateMaximum)] : []),
      access(configuration.routes),
    ]), supportsStart: true, supportsChange: configuration.modes.includes("INFUSION"), supportsStop: true,
    treatmentShape: configuration.modes.includes("INFUSION") ? "INFUSION" : "ONE_SHOT",
    configurationVersion: configuration.version });
});

const alsDescriptors = ERC_2025_ADULT_ALS_PRODUCTS.map((configuration): ClinicalTreatmentDescriptor => Object.freeze({
  treatmentId: configuration.drugId, displayName: configuration.displayName,
  aliases: Object.freeze([...configuration.aliases]), category: "ALS_MEDICATIONS", commandKind: "ALS",
  routes: Object.freeze([...configuration.routes]), requiresVascularAccess: true,
  administrationModes: Object.freeze(["ONE_SHOT"]),
  fields: Object.freeze([numeric("dose", "Annus", configuration.doseUnit, 0.000001,
    Number.MAX_SAFE_INTEGER, configuration.referenceDoses[0]), route(configuration.routes), access(configuration.routes)]),
  supportsStart: true, supportsChange: false, supportsStop: false, treatmentShape: "ONE_SHOT",
  configurationVersion: ERC_2025_ADULT_ALS_PROFILE.version,
}));

const catalog: readonly ClinicalTreatmentDescriptor[] = Object.freeze([
  ...fluidDescriptors,
  Object.freeze({ treatmentId: "TRANEXAMIC_ACID", displayName: "TXA", aliases: Object.freeze([]),
    category: "HEMOSTASIS", commandKind: "TXA", routes: Object.freeze(["IV", "IO"] as const),
    requiresVascularAccess: true, administrationModes: Object.freeze(["COURSE"]),
    fields: Object.freeze([access(["IV", "IO"])]), supportsStart: true, supportsChange: false,
    supportsStop: true, treatmentShape: "COURSE", configurationVersion:
      DEFAULT_TRANEXAMIC_ACID_CONFIGURATION.regimenVersion }),
  ...analgesicDescriptors,
  Object.freeze({ treatmentId: "NOREPINEPHRINE", displayName: "Norepinefriin", aliases: Object.freeze([]),
    category: "VASOACTIVE", commandKind: "NOREPINEPHRINE", routes: Object.freeze(["IV"] as const),
    requiresVascularAccess: true, administrationModes: Object.freeze(["INFUSION"]),
    fields: Object.freeze([numeric("doseRate", "Annus", "MCG_KG_MIN",
      DEFAULT_NOREPINEPHRINE_CONFIGURATION.minimumNonZeroDoseMicrogramsPerKgMin,
      DEFAULT_NOREPINEPHRINE_CONFIGURATION.maximumDoseMicrogramsPerKgMin), access(["IV"])]),
    supportsStart: true, supportsChange: true, supportsStop: true, treatmentShape: "INFUSION",
    configurationVersion: DEFAULT_NOREPINEPHRINE_CONFIGURATION.version }),
  Object.freeze({ treatmentId: "MECHANICAL_VENTILATION", displayName: "Ventilaator", aliases: Object.freeze([]),
    category: "RESPIRATORY_SUPPORT", commandKind: "VENTILATION", routes: Object.freeze([]),
    requiresVascularAccess: false, administrationModes: Object.freeze(["VOLUME_CONTROL"]),
    fields: Object.freeze([
      Object.freeze({ fieldId: "securedAirwayId", label: "Kindlustatud hingamistee", kind: "SELECT",
        required: true, options: Object.freeze([]) }),
      numeric("respiratoryRate", "Hingamissagedus", "BREATHS_MIN",
        DEFAULT_MECHANICAL_VENTILATION_CONFIGURATION.minimumRespiratoryRate,
        DEFAULT_MECHANICAL_VENTILATION_CONFIGURATION.maximumRespiratoryRate),
      numeric("tidalVolumeMl", "Hingamismaht", "ML",
        DEFAULT_MECHANICAL_VENTILATION_CONFIGURATION.minimumTidalVolumeMl,
        DEFAULT_MECHANICAL_VENTILATION_CONFIGURATION.maximumTidalVolumeMl),
      numeric("fio2", "FiO₂", "FRACTION", DEFAULT_MECHANICAL_VENTILATION_CONFIGURATION.minimumFio2,
        DEFAULT_MECHANICAL_VENTILATION_CONFIGURATION.maximumFio2),
      numeric("peepCmH2O", "PEEP", "CM_H2O", DEFAULT_MECHANICAL_VENTILATION_CONFIGURATION.minimumPeepCmH2O,
        DEFAULT_MECHANICAL_VENTILATION_CONFIGURATION.maximumPeepCmH2O),
    ]), supportsStart: true, supportsChange: true, supportsStop: true, treatmentShape: "DEVICE",
    configurationVersion: DEFAULT_MECHANICAL_VENTILATION_CONFIGURATION.version }),
  ...alsDescriptors,
]);

const byId = new Map(catalog.map(item => [item.treatmentId, item]));

export function getClinicalTreatmentCatalog(): readonly ClinicalTreatmentDescriptor[] {
  return catalog.map(item => structuredClone(item));
}

export function requireClinicalTreatmentDescriptor(treatmentId: ClinicalTreatmentId): ClinicalTreatmentDescriptor {
  const descriptor = byId.get(treatmentId);
  if (!descriptor) throw new Error(`UNKNOWN_CLINICAL_TREATMENT:${treatmentId}`);
  return structuredClone(descriptor);
}

export function isClinicalTreatmentId(value: string): value is ClinicalTreatmentId {
  return byId.has(value as ClinicalTreatmentId);
}

export function availableClinicalTreatmentDescriptors(pkg?: Pick<ExercisePackage, "availableClinicalTreatments">):
readonly ClinicalTreatmentDescriptor[] {
  const allowed = pkg?.availableClinicalTreatments;
  if (!allowed) return getClinicalTreatmentCatalog();
  const allowedSet = new Set(allowed);
  return catalog.filter(item => allowedSet.has(item.treatmentId)).map(item => structuredClone(item));
}

export function groupClinicalTreatments(descriptors: readonly ClinicalTreatmentDescriptor[]):
ReadonlyMap<ClinicalTreatmentCategory, readonly ClinicalTreatmentDescriptor[]> {
  const result = new Map<ClinicalTreatmentCategory, ClinicalTreatmentDescriptor[]>();
  for (const descriptor of descriptors) {
    const values = result.get(descriptor.category) ?? [];
    values.push(structuredClone(descriptor)); result.set(descriptor.category, values);
  }
  for (const [category, values] of result) result.set(category,
    values.sort((left, right) => left.displayName.localeCompare(right.displayName)));
  return result;
}
