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
});
