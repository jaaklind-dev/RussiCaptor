import type { LabResultGroupType, NarvaLabPackageId } from "@/models/LaboratoryWorkflow";
import { deepFreeze } from "@/utils/immutable";

export type NarvaLabAnalyte = Readonly<{
  id: string;
  name: string;
  resultGroup: LabResultGroupType;
  behavior: "FUTURE_DYNAMIC" | "SCENARIO_STATIC";
  conditional?: "APPLICABLE_PATIENT";
  sourceMetadata?: string;
}>;

export const NARVA_LAB_RESULT_TIMING_SECONDS_FROM_SAMPLE: Readonly<Record<LabResultGroupType, number>> =
  Object.freeze({ ASTRUP: 25 * 60, HEMATOLOGY: 30 * 60, AB0: 30 * 60,
    CLINICAL_CHEMISTRY: 40 * 60, COAGULATION: 40 * 60 });

const analyte = (id: string, name: string, resultGroup: LabResultGroupType,
  behavior: NarvaLabAnalyte["behavior"], extra: Partial<NarvaLabAnalyte> = {}): NarvaLabAnalyte =>
  Object.freeze({ id, name, resultGroup, behavior, ...extra });

export const NARVA_LAB_ANALYTES = deepFreeze([
  analyte("LAB_NA", "Na", "CLINICAL_CHEMISTRY", "FUTURE_DYNAMIC"),
  analyte("LAB_K", "K", "CLINICAL_CHEMISTRY", "FUTURE_DYNAMIC"),
  analyte("LAB_CRP", "CRP", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_GLUCOSE", "Glucose", "CLINICAL_CHEMISTRY", "FUTURE_DYNAMIC"),
  analyte("LAB_UREA", "Urea", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_CREATININE", "Creatinine", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_CBC_PANEL", "CBC / hemogram", "HEMATOLOGY", "SCENARIO_STATIC",
    { sourceMetadata: "IVKH hemogram panel; individual future-dynamic components are catalogued separately" }),
  analyte("LAB_HB", "Hb", "HEMATOLOGY", "FUTURE_DYNAMIC"),
  analyte("LAB_HCT", "Hct", "HEMATOLOGY", "FUTURE_DYNAMIC"),
  analyte("LAB_PLATELETS", "Platelets", "HEMATOLOGY", "FUTURE_DYNAMIC"),
  analyte("LAB_PH", "pH", "ASTRUP", "FUTURE_DYNAMIC", { sourceMetadata: "IVKH Astrup panel; exact aggregate aB-Hb-Fr remains source-ambiguous" }),
  analyte("LAB_PCO2", "pCO2", "ASTRUP", "FUTURE_DYNAMIC"),
  analyte("LAB_PO2", "pO2", "ASTRUP", "FUTURE_DYNAMIC"),
  analyte("LAB_HCO3", "HCO3", "ASTRUP", "FUTURE_DYNAMIC"),
  analyte("LAB_BE", "BE/ABE", "ASTRUP", "FUTURE_DYNAMIC"),
  analyte("LAB_LACTATE", "Lactate", "ASTRUP", "FUTURE_DYNAMIC"),
  analyte("LAB_SO2", "sO2/O2Hb", "ASTRUP", "FUTURE_DYNAMIC"),
  analyte("LAB_ICA", "Ionized calcium", "ASTRUP", "FUTURE_DYNAMIC"),
  analyte("LAB_ASTRUP_GLUCOSE", "Astrup glucose", "ASTRUP", "FUTURE_DYNAMIC"),
  analyte("LAB_ASTRUP_HB_FR", "Astrup Hb fractions", "ASTRUP", "FUTURE_DYNAMIC",
    { sourceMetadata: "IVKH aB-Hb-Fr aggregate; exact component mapping remains source-ambiguous" }),
  analyte("LAB_TROPONIN_T", "Troponin T", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_CK", "CK", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_ALAT", "ALAT", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_ASAT", "ASAT", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_GGT", "GGT", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_ALP", "ALP", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_BILIRUBIN", "Bilirubin", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_LIPASE", "Lipase", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_INR", "INR", "COAGULATION", "FUTURE_DYNAMIC"),
  analyte("LAB_APTT", "APTT", "COAGULATION", "FUTURE_DYNAMIC"),
  analyte("LAB_FIBRINOGEN", "Fibrinogen", "COAGULATION", "FUTURE_DYNAMIC"),
  analyte("LAB_ETHANOL", "Ethanol", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_HCG", "hCG", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC", { conditional: "APPLICABLE_PATIENT" }),
  analyte("LAB_AB0", "AB0", "AB0", "SCENARIO_STATIC", { sourceMetadata: "Patient identity; IVKH source does not provide a complete machine code mapping" }),
  analyte("LAB_RHD", "RhD", "AB0", "SCENARIO_STATIC"),
  analyte("LAB_ANTIBODY_SCREEN", "Antibody screen", "AB0", "SCENARIO_STATIC", { sourceMetadata: "Exact source parameter code remains ambiguous" }),
]);

const packages: Record<NarvaLabPackageId, readonly string[]> = {
  NARVA_POLYTRAUMA: NARVA_LAB_ANALYTES.map(item => item.id),
  NARVA_IRO_ASTRUP: NARVA_LAB_ANALYTES.filter(item => item.resultGroup === "ASTRUP").map(item => item.id),
};
export const NARVA_LAB_PACKAGE_ANALYTE_IDS = deepFreeze(packages);

export function narvaLabPackageForExercisePackage(packageId: string): NarvaLabPackageId | undefined {
  if (packageId === "russicaptor.narva-trauma") return "NARVA_POLYTRAUMA";
  if (packageId === "russicaptor.narva-iro-evacuation") return "NARVA_IRO_ASTRUP";
  return undefined;
}

export function resultGroupsForNarvaLabPackage(packageId: NarvaLabPackageId): readonly LabResultGroupType[] {
  return packageId === "NARVA_IRO_ASTRUP" ? Object.freeze(["ASTRUP"])
    : Object.freeze(["ASTRUP", "HEMATOLOGY", "AB0", "CLINICAL_CHEMISTRY", "COAGULATION"]);
}
