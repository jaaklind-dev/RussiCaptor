import { NARVA_LAB_ANALYTES, NARVA_LAB_PACKAGE_ANALYTE_IDS,
  NARVA_LAB_RESULT_TIMING_SECONDS_FROM_SAMPLE, narvaLabPackageForExercisePackage,
  resultGroupsForNarvaLabPackage } from "../NarvaLaboratoryCatalog";

describe("Narva laboratory catalog", () => {
  test("freezes the EMO POLÜTRAUMA scope and excludes non-Narva tests", () => {
    const names = NARVA_LAB_ANALYTES.map(item => item.name);
    expect(names).toEqual(expect.arrayContaining(["Na", "K", "CRP", "Glucose", "Urea", "Creatinine",
      "CBC / hemogram", "Hb", "Hct", "Platelets", "pH", "pCO2", "pO2", "HCO3", "BE/ABE", "Lactate", "sO2/O2Hb",
      "Ionized calcium", "Troponin T", "CK", "ALAT", "ASAT", "GGT", "ALP", "Bilirubin", "Lipase",
      "INR", "APTT", "Fibrinogen", "Ethanol", "hCG", "AB0", "RhD", "Antibody screen"]));
    expect(names.join(" ")).not.toMatch(/SARS|influenza|urine|U-Narco/i);
    expect(NARVA_LAB_PACKAGE_ANALYTE_IDS.NARVA_POLYTRAUMA).toHaveLength(NARVA_LAB_ANALYTES.length);
  });

  test("exposes only Astrup in IRO and preserves explicit minute-to-second timing", () => {
    const iroNames = NARVA_LAB_PACKAGE_ANALYTE_IDS.NARVA_IRO_ASTRUP.map(id =>
      NARVA_LAB_ANALYTES.find(item => item.id === id)!.name);
    expect(iroNames).toEqual(["pH", "pCO2", "pO2", "HCO3", "BE/ABE", "Lactate", "sO2/O2Hb", "Ionized calcium",
      "Astrup glucose", "Astrup Hb fractions"]);
    expect(resultGroupsForNarvaLabPackage("NARVA_IRO_ASTRUP")).toEqual(["ASTRUP"]);
    expect(NARVA_LAB_RESULT_TIMING_SECONDS_FROM_SAMPLE).toEqual({ ASTRUP: 1500, HEMATOLOGY: 1800,
      AB0: 1800, CLINICAL_CHEMISTRY: 2400, COAGULATION: 2400 });
    expect(narvaLabPackageForExercisePackage("russicaptor.narva-trauma")).toBe("NARVA_POLYTRAUMA");
    expect(narvaLabPackageForExercisePackage("russicaptor.narva-iro-evacuation")).toBe("NARVA_IRO_ASTRUP");
  });

  test("marks dynamic analytes without coupling laboratory iCa to the MTP protocol", () => {
    for (const name of ["pH", "pCO2", "pO2", "HCO3", "BE/ABE", "Lactate", "sO2/O2Hb",
      "Ionized calcium", "Glucose", "Hb", "Hct", "Platelets", "INR", "APTT", "Fibrinogen", "Na", "K"]) {
      expect(NARVA_LAB_ANALYTES.find(item => item.name === name)?.behavior).toBe("PHYSIOLOGY_V1");
    }
    expect(NARVA_LAB_ANALYTES.find(item => item.id === "LAB_ASTRUP_HB_FR"))
      .toMatchObject({ behavior: "SOURCE_AMBIGUOUS", implementationClass: "SOURCE_AMBIGUOUS" });
    expect(JSON.stringify(NARVA_LAB_ANALYTES)).not.toMatch(/MTP|fourth qualifying|recommendation/i);
  });

  test("LAB-G30 preserves verified source codes without resolving unsupported result semantics", () => {
    const hbFractions = NARVA_LAB_ANALYTES.find(item => item.id === "LAB_ASTRUP_HB_FR")!;
    expect(hbFractions).toMatchObject({ sourceAnalysisId: "LAB_035", sourceCode: "aB-Hb-Fr",
      resultGroup: "ASTRUP", behavior: "SOURCE_AMBIGUOUS", implementationClass: "SOURCE_AMBIGUOUS" });
    expect(hbFractions).not.toHaveProperty("unit");
    expect(hbFractions).not.toHaveProperty("referenceRange");
    expect(hbFractions).not.toHaveProperty("children");
    expect(hbFractions.sourceMetadata).toMatch(/reportable result shape.*remain unresolved/i);

    const antibodyScreen = NARVA_LAB_ANALYTES.find(item => item.id === "LAB_ANTIBODY_SCREEN")!;
    expect(antibodyScreen).toMatchObject({ sourceAnalysisId: "LAB_034",
      sourceCode: "B1-RBC Ab screen I, II, III", resultGroup: "AB0" });
    expect(NARVA_LAB_ANALYTES.filter(item => item.id === "LAB_ANTIBODY_SCREEN")).toHaveLength(1);
    expect(NARVA_LAB_ANALYTES.filter(item => /^LAB_ANTIBODY_SCREEN_[I]{1,3}$/.test(item.id))).toEqual([]);
    expect(NARVA_LAB_ANALYTES.find(item => item.id === "LAB_AB0")?.sourceCode)
      .toBe("B1-AB0-RhD conf panel");
    expect(NARVA_LAB_ANALYTES.find(item => item.id === "LAB_RHD")?.sourceCode)
      .toBe("B1-AB0-RhD conf panel");
    expect(antibodyScreen.sourceMetadata).toMatch(/implementation behavior rather than source-backed/i);
  });
});
