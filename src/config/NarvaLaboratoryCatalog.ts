import type { LabResultGroupType, NarvaLabPackageId } from "@/models/LaboratoryWorkflow";
import { deepFreeze } from "@/utils/immutable";

export type NarvaLabImplementationClass = "DYNAMIC_EXISTING" | "STATIC_BASELINE" |
  "SCENARIO_DERIVED" | "DEMOGRAPHIC_CONDITIONAL" | "BLOOD_BANK_IDENTITY" |
  "SOURCE_AMBIGUOUS" | "PANEL_CONTAINER";

export type NarvaLabAnalyte = Readonly<{
  id: string;
  name: string;
  sourceName: string;
  sourceAnalysisId: string;
  resultGroup: LabResultGroupType;
  behavior: "PHYSIOLOGY_V1" | "SCENARIO_STATIC" | "SOURCE_AMBIGUOUS" | "PANEL_CONTAINER";
  implementationClass: NarvaLabImplementationClass;
  sourceCode?: string;
  unit?: string;
  referenceRange?: string;
  conditional?: "APPLICABLE_PATIENT";
  sourceMetadata?: string;
  reportable?: false;
}>;

export const NARVA_LAB_RESULT_TIMING_SECONDS_FROM_SAMPLE: Readonly<Record<LabResultGroupType, number>> =
  Object.freeze({ ASTRUP: 25 * 60, HEMATOLOGY: 30 * 60, AB0: 30 * 60,
    CLINICAL_CHEMISTRY: 40 * 60, COAGULATION: 40 * 60 });

const analyte = (id: string, name: string, sourceName: string, sourceAnalysisId: string,
  resultGroup: LabResultGroupType, behavior: NarvaLabAnalyte["behavior"],
  implementationClass: NarvaLabImplementationClass,
  extra: Partial<NarvaLabAnalyte> = {}): NarvaLabAnalyte =>
  Object.freeze({ id, name, sourceName, sourceAnalysisId, resultGroup, behavior, implementationClass, ...extra });

const dynamic = (id: string, name: string, sourceName: string, sourceAnalysisId: string,
  resultGroup: LabResultGroupType, extra: Partial<NarvaLabAnalyte> = {}) =>
  analyte(id, name, sourceName, sourceAnalysisId, resultGroup, "PHYSIOLOGY_V1", "DYNAMIC_EXISTING", extra);
const baseline = (id: string, name: string, sourceName: string, sourceAnalysisId: string,
  resultGroup: LabResultGroupType, extra: Partial<NarvaLabAnalyte> = {}) =>
  analyte(id, name, sourceName, sourceAnalysisId, resultGroup, "SCENARIO_STATIC", "STATIC_BASELINE", extra);

const CBC_SOURCE = Object.freeze({ sourceAnalysisId: "LAB_007", sourceCode: "B1-CBC-5Diff-NRBC",
  sourceMetadata: "EMO PDF names the panel; component membership is derived from the IVKH reference export." });
const cbc = (id: string, name: string, unit: string, referenceRange?: string) =>
  baseline(id, name, name, CBC_SOURCE.sourceAnalysisId, "HEMATOLOGY", {
    sourceCode: CBC_SOURCE.sourceCode, unit, ...(referenceRange ? { referenceRange } : {}),
    sourceMetadata: CBC_SOURCE.sourceMetadata,
  });

export const NARVA_LAB_ANALYTES = deepFreeze([
  dynamic("LAB_NA", "Na", "Naatrium", "LAB_001", "CLINICAL_CHEMISTRY",
    { sourceCode: "P4-Na", unit: "mmol/L", referenceRange: "136–145" }),
  dynamic("LAB_K", "K", "Kaalium", "LAB_002", "CLINICAL_CHEMISTRY",
    { sourceCode: "P4-K", unit: "mmol/L", referenceRange: "3.5–5.1" }),
  baseline("LAB_CRP", "CRP", "CRP", "LAB_003", "CLINICAL_CHEMISTRY",
    { sourceCode: "P4-CRP", unit: "mg/L", referenceRange: "≤5" }),
  dynamic("LAB_GLUCOSE", "Glucose", "Glükoos", "LAB_004", "CLINICAL_CHEMISTRY",
    { sourceCode: "fP4-Gluc", unit: "mmol/L", referenceRange: "adult 4.11–6.05 (source age band 0.083–60 a)" }),
  baseline("LAB_UREA", "Urea", "Uurea", "LAB_005", "CLINICAL_CHEMISTRY",
    { sourceCode: "fP4-Urea", unit: "mmol/L", referenceRange: "2.76–8.07" }),
  baseline("LAB_CREATININE", "Creatinine", "Kreatiniin", "LAB_006", "CLINICAL_CHEMISTRY",
    { sourceCode: "P4-Crea", unit: "µmol/L", referenceRange: "male 62–106; female 44–80" }),

  analyte("LAB_CBC_PANEL", "CBC / hemogram", "Hemogramm 5-osalise leukogrammi ja normoblastidega",
    "LAB_007", "HEMATOLOGY", "PANEL_CONTAINER", "PANEL_CONTAINER", {
      sourceCode: CBC_SOURCE.sourceCode, reportable: false, sourceMetadata: CBC_SOURCE.sourceMetadata }),
  cbc("LAB_WBC", "WBC", "E9/L", "adult 4.1–9.7"),
  cbc("LAB_RBC", "RBC", "E12/L", "adult male 4.5–5.7; adult female 4.1–5.2"),
  dynamic("LAB_HB", "Hb", "HGB", "LAB_007", "HEMATOLOGY",
    { sourceCode: CBC_SOURCE.sourceCode, unit: "g/L", referenceRange: "female 121–150; male 134–170",
      sourceMetadata: CBC_SOURCE.sourceMetadata }),
  dynamic("LAB_HCT", "Hct", "HCT", "LAB_007", "HEMATOLOGY",
    { sourceCode: CBC_SOURCE.sourceCode, unit: "%", referenceRange: "female 37–45; male 40–49",
      sourceMetadata: CBC_SOURCE.sourceMetadata }),
  cbc("LAB_MCV", "MCV", "fL", "adult 82–95"),
  cbc("LAB_MCH", "MCH", "pg", "adult 28–33"),
  cbc("LAB_MCHC", "MCHC", "g/L", "adult 322–356"),
  cbc("LAB_RDW_CV", "RDW-CV", "%", "adult 12–15"),
  dynamic("LAB_PLATELETS", "Platelets", "PLT", "LAB_007", "HEMATOLOGY",
    { sourceCode: CBC_SOURCE.sourceCode, unit: "E9/L", referenceRange: "157–372",
      sourceMetadata: CBC_SOURCE.sourceMetadata }),
  cbc("LAB_MPV", "MPV", "fL", "adult 9.2–12.3"),
  cbc("LAB_PDW", "PDW", "fL", "adult 10.1–16.2"),
  cbc("LAB_PCT", "Pct", "%", "adult 0.18–0.38"),
  cbc("LAB_LCR", "LCR", "%", "adult 17.8–45.1"),
  cbc("LAB_NEUT_ABS", "NEUT#", "E9/L", "adult 1.9–6.7"),
  cbc("LAB_NEUT_PCT", "NEUT%", "%"),
  cbc("LAB_LYMPH_ABS", "LYMPH#", "E9/L", "adult 1.3–3.1"),
  cbc("LAB_LYMPH_PCT", "LYMPH%", "%"),
  cbc("LAB_MONO_ABS", "MONO#", "E9/L", "adult 0.24–0.8"),
  cbc("LAB_MONO_PCT", "MONO%", "%"),
  cbc("LAB_EO_ABS", "EO#", "E9/L", "adult 0.02–0.4"),
  cbc("LAB_EO_PCT", "EO%", "%"),
  cbc("LAB_BASO_ABS", "BASO#", "E9/L", "adult 0.01–0.08"),
  cbc("LAB_BASO_PCT", "BASO%", "%"),
  cbc("LAB_IG_ABS", "IG#", "E9/L", "adult ≤0.03"),
  cbc("LAB_IG_PCT", "IG%", "%"),
  cbc("LAB_NRBC_ABS", "NRBC#", "E9/L"),
  cbc("LAB_NRBC_PCT", "NRBC%", "/100WBC"),

  dynamic("LAB_PH", "pH", "pH", "LAB_035", "ASTRUP", { sourceCode: "aB-ABB panel",
    referenceRange: "female 7.35–7.45; male 7.34–7.44" }),
  dynamic("LAB_PCO2", "pCO2", "pCO2", "LAB_035", "ASTRUP",
    { sourceCode: "aB-ABB panel", unit: "mmHg", referenceRange: "female 32.3–42; male 35.3–45" }),
  dynamic("LAB_PO2", "pO2", "pO2", "LAB_035", "ASTRUP",
    { sourceCode: "aB-ABB panel", unit: "mmHg", referenceRange: "adult 69–116" }),
  dynamic("LAB_HCO3", "HCO3", "HCO3", "LAB_035", "ASTRUP",
    { sourceCode: "aB-ABB panel", unit: "mmol/L", referenceRange: "female 20–24; male 22–26" }),
  dynamic("LAB_BE", "BE/ABE", "BE/ABE", "LAB_035", "ASTRUP",
    { sourceCode: "aB-ABB panel", unit: "mmol/L" }),
  dynamic("LAB_LACTATE", "Lactate", "Laktaat", "LAB_035", "ASTRUP",
    { sourceCode: "aP-Lac", unit: "mmol/L", referenceRange: "0.5–1.6" }),
  dynamic("LAB_SO2", "sO2/O2Hb", "sO2/O2Hb", "LAB_035", "ASTRUP",
    { sourceCode: "aB-ABB panel", unit: "%", referenceRange: "94–98" }),
  dynamic("LAB_ICA", "Ionized calcium", "Ioniseeritud kaltsium", "LAB_035", "ASTRUP",
    { sourceCode: "aB-iCa", unit: "mmol/L", referenceRange: "1.15–1.35" }),
  dynamic("LAB_ASTRUP_GLUCOSE", "Astrup glucose", "Glükoos", "LAB_035", "ASTRUP",
    { sourceCode: "aB-Gluc", unit: "mmol/L", referenceRange: "3.9–5.8" }),
  analyte("LAB_ASTRUP_HB_FR", "Astrup Hb fractions", "aB-Hb-Fr", "LAB_035", "ASTRUP",
    "SOURCE_AMBIGUOUS", "SOURCE_AMBIGUOUS", {
      sourceCode: "aB-Hb-Fr",
      sourceMetadata: "IVKH source contains the aB-Hb-Fr token; its reportable result shape and authoritative " +
        "relationship to individual Hb-fraction parameters remain unresolved." }),

  baseline("LAB_TROPONIN_T", "Troponin T", "Troponiin T", "LAB_012", "CLINICAL_CHEMISTRY",
    { sourceCode: "P4-cTnT-hs", unit: "ng/L", referenceRange: "≤14" }),
  baseline("LAB_CK", "CK", "Kreatiinkinaas", "LAB_036", "CLINICAL_CHEMISTRY",
    { sourceCode: "P4-CK", unit: "U/L", referenceRange: "male ≤308; female ≤192" }),
  baseline("LAB_ALAT", "ALAT", "ALAT", "LAB_016", "CLINICAL_CHEMISTRY",
    { sourceCode: "P4-ALAT", unit: "U/L", referenceRange: "male ≤50; female ≤35" }),
  baseline("LAB_ASAT", "ASAT", "ASAT", "LAB_017", "CLINICAL_CHEMISTRY",
    { sourceCode: "P4-ASAT", unit: "U/L", referenceRange: "male ≤50; female ≤35" }),
  baseline("LAB_GGT", "GGT", "GGT", "LAB_019", "CLINICAL_CHEMISTRY",
    { sourceCode: "P4-GGT", unit: "U/L", referenceRange: "male ≤60; female ≤40" }),
  baseline("LAB_ALP", "ALP", "ALP", "LAB_018", "CLINICAL_CHEMISTRY",
    { sourceCode: "P4-ALP", unit: "U/L", referenceRange: "adult male 40–130; adult female 35–105" }),
  baseline("LAB_BILIRUBIN", "Bilirubin", "Bilirubiin", "LAB_020", "CLINICAL_CHEMISTRY",
    { sourceCode: "P4-Bil", unit: "µmol/L", referenceRange: "adult ≤21" }),
  baseline("LAB_LIPASE", "Lipase", "Lipaas", "LAB_022", "CLINICAL_CHEMISTRY",
    { sourceCode: "P4-Lip", unit: "U/L", referenceRange: "13–60" }),
  dynamic("LAB_INR", "INR", "INR", "LAB_023", "COAGULATION",
    { sourceCode: "P1-INR", referenceRange: "0.85–1.15" }),
  dynamic("LAB_APTT", "APTT", "APTT", "LAB_033", "COAGULATION",
    { sourceCode: "P1-APTT", unit: "s", referenceRange: "29–40.2" }),
  dynamic("LAB_FIBRINOGEN", "Fibrinogen", "Fibrinogeen", "LAB_037", "COAGULATION",
    { sourceCode: "P1-Fibr", unit: "g/L", referenceRange: "1.8–3.5" }),
  baseline("LAB_ETHANOL", "Ethanol", "Etanool", "LAB_038", "CLINICAL_CHEMISTRY",
    { sourceCode: "P4-EtOH", unit: "g/L", referenceRange: "≤0.2" }),
  analyte("LAB_HCG", "hCG", "hCG", "LAB_028", "CLINICAL_CHEMISTRY", "SCENARIO_STATIC",
    "DEMOGRAPHIC_CONDITIONAL", { sourceCode: "P4-hCG", unit: "IU/l",
      referenceRange: "non-pregnant ≤4.9; pregnancy ranges vary by gestational week",
      conditional: "APPLICABLE_PATIENT" }),
  analyte("LAB_AB0", "AB0", "AB0-veregrupp", "LAB_034", "AB0", "SCENARIO_STATIC",
    "BLOOD_BANK_IDENTITY", { sourceCode: "B1-AB0-RhD conf panel", unit: "-",
      sourceMetadata: "Patient identity; IVKH source provides no reference range." }),
  analyte("LAB_RHD", "RhD", "RhD antigeen", "LAB_034", "AB0", "SCENARIO_STATIC",
    "BLOOD_BANK_IDENTITY", { sourceCode: "B1-AB0-RhD conf panel", unit: "-",
      sourceMetadata: "Patient identity; IVKH source provides no reference range." }),
  analyte("LAB_ANTIBODY_SCREEN", "Antibody screen",
    "Erütrotsütaarsete antikehade sõeluuring I, II, III", "LAB_034", "AB0", "SCENARIO_STATIC",
    "BLOOD_BANK_IDENTITY", { sourceCode: "B1-RBC Ab screen I, II, III", unit: "-",
      sourceMetadata: "IVKH source identifies one combined antibody-screen operation distinct from the " +
        "B1-AB0-RhD conf panel; result vocabulary, default value and patient-stable identity semantics remain " +
        "implementation behavior rather than source-backed by these artifacts." }),
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
