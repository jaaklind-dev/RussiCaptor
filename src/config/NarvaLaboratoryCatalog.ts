import type { LabResultGroupType, NarvaLabPackageId } from "@/models/LaboratoryWorkflow";
import { deepFreeze } from "@/utils/immutable";

export type NarvaLabAnalyte = Readonly<{
  id: string;
  name: string;
  resultGroup: LabResultGroupType;
  behavior: "PHYSIOLOGY_V1" | "FUTURE_DYNAMIC" | "SCENARIO_STATIC";
  sourceCode?: string;
  unit?: string;
  referenceRange?: string;
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
  analyte("LAB_NA", "Na", "CLINICAL_CHEMISTRY", "PHYSIOLOGY_V1",
    { sourceCode: "P4-Na", unit: "mmol/L", referenceRange: "136–145" }),
  analyte("LAB_K", "K", "CLINICAL_CHEMISTRY", "PHYSIOLOGY_V1",
    { sourceCode: "P4-K", unit: "mmol/L", referenceRange: "3.5–5.1" }),
  analyte("LAB_CRP", "CRP", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_GLUCOSE", "Glucose", "CLINICAL_CHEMISTRY", "PHYSIOLOGY_V1",
    { sourceCode: "fP4-Gluc", unit: "mmol/L", referenceRange: "adult 4.11–6.05 (source age band 0.083–60 a)" }),
  analyte("LAB_UREA", "Urea", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_CREATININE", "Creatinine", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_CBC_PANEL", "CBC / hemogram", "HEMATOLOGY", "SCENARIO_STATIC",
    { sourceMetadata: "IVKH hemogram panel; individual future-dynamic components are catalogued separately" }),
  analyte("LAB_HB", "Hb", "HEMATOLOGY", "PHYSIOLOGY_V1",
    { unit: "g/L", referenceRange: "female 121–150; male 134–170" }),
  analyte("LAB_HCT", "Hct", "HEMATOLOGY", "PHYSIOLOGY_V1",
    { unit: "%", referenceRange: "female 37–45; male 40–49" }),
  analyte("LAB_PLATELETS", "Platelets", "HEMATOLOGY", "PHYSIOLOGY_V1",
    { unit: "E9/L", referenceRange: "157–372" }),
  analyte("LAB_PH", "pH", "ASTRUP", "PHYSIOLOGY_V1", { sourceCode: "aB-ABB panel",
    referenceRange: "female 7.35–7.45; male 7.34–7.44",
    sourceMetadata: "IVKH Astrup panel; exact aggregate aB-Hb-Fr remains source-ambiguous" }),
  analyte("LAB_PCO2", "pCO2", "ASTRUP", "PHYSIOLOGY_V1",
    { sourceCode: "aB-ABB panel", unit: "mmHg", referenceRange: "female 32.3–42; male 35.3–45" }),
  analyte("LAB_PO2", "pO2", "ASTRUP", "PHYSIOLOGY_V1",
    { sourceCode: "aB-ABB panel", unit: "mmHg", referenceRange: "adult 69–116" }),
  analyte("LAB_HCO3", "HCO3", "ASTRUP", "PHYSIOLOGY_V1",
    { sourceCode: "aB-ABB panel", unit: "mmol/L", referenceRange: "female 20–24; male 22–26" }),
  analyte("LAB_BE", "BE/ABE", "ASTRUP", "PHYSIOLOGY_V1", { sourceCode: "aB-ABB panel", unit: "mmol/L" }),
  analyte("LAB_LACTATE", "Lactate", "ASTRUP", "PHYSIOLOGY_V1",
    { sourceCode: "aP-Lac", unit: "mmol/L", referenceRange: "0.5–1.6" }),
  analyte("LAB_SO2", "sO2/O2Hb", "ASTRUP", "PHYSIOLOGY_V1",
    { sourceCode: "aB-ABB panel", unit: "%", referenceRange: "94–98" }),
  analyte("LAB_ICA", "Ionized calcium", "ASTRUP", "PHYSIOLOGY_V1",
    { sourceCode: "aB-iCa", unit: "mmol/L", referenceRange: "1.15–1.35" }),
  analyte("LAB_ASTRUP_GLUCOSE", "Astrup glucose", "ASTRUP", "PHYSIOLOGY_V1",
    { sourceCode: "aB-Gluc", unit: "mmol/L", referenceRange: "3.9–5.8" }),
  analyte("LAB_ASTRUP_HB_FR", "Astrup Hb fractions", "ASTRUP", "SCENARIO_STATIC",
    { sourceMetadata: "IVKH aB-Hb-Fr aggregate; exact component mapping remains source-ambiguous" }),
  analyte("LAB_TROPONIN_T", "Troponin T", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_CK", "CK", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_ALAT", "ALAT", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_ASAT", "ASAT", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_GGT", "GGT", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_ALP", "ALP", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_BILIRUBIN", "Bilirubin", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_LIPASE", "Lipase", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC"),
  analyte("LAB_INR", "INR", "COAGULATION", "PHYSIOLOGY_V1", { referenceRange: "0.85–1.15" }),
  analyte("LAB_APTT", "APTT", "COAGULATION", "PHYSIOLOGY_V1", { unit: "s", referenceRange: "29–40.2" }),
  analyte("LAB_FIBRINOGEN", "Fibrinogen", "COAGULATION", "PHYSIOLOGY_V1",
    { unit: "g/L", referenceRange: "1.8–3.5" }),
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
