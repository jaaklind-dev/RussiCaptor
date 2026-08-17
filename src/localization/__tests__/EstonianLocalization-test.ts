import fs from "node:fs";
import path from "node:path";
import {
  assessmentStatusLabel, authorityStateLabel, compatibilityLabel, exerciseLifecycleLabel,
  et, exercisePackageNameLabel, exercisePackageTagLabel, exerciseProfileLabel, instructorFilterOptionLabel,
  judgementLabel, patientStatusLabel,
} from "@/localization/et";

describe("WP-46 Estonian presentation foundation", () => {
  test("maps canonical values without changing their identity", () => {
    expect(exerciseLifecycleLabel("RUNNING")).toBe("Käimas");
    expect(patientStatusLabel("Life threatening")).toBe("Eluohtlik");
    expect(authorityStateLabel("WRITER")).toBe("Aktiivne juht");
    expect(assessmentStatusLabel("MET")).toBe("Täidetud");
    expect(assessmentStatusLabel("UNAVAILABLE")).toBe("Pole hinnatav");
    expect(compatibilityLabel("SUPPORTED")).toBe("Toetatud");
    expect(judgementLabel("NOT_ASSESSED")).toBe("Hindamata");
    expect(["RUNNING", "MET", "SUPPORTED", "WRITER"]).toEqual(["RUNNING", "MET", "SUPPORTED", "WRITER"]);
  });

  test("unknown future values fail visibly and safely", () => {
    expect(exerciseLifecycleLabel("FUTURE_STATE")).toBe("Tundmatu olek: FUTURE_STATE");
  });

  test("uses the user-approved general terminology without changing dictionary keys", () => {
    expect(et.debrief).toBe("debriif");
    expect(et.canonicalSource).toBe("andmete lähteallikas");
    expect(et.evidence).toBe("tõendusallikad");
    expect(Object.keys(et)).toEqual(expect.arrayContaining(["debrief", "canonicalSource", "evidence"]));
  });

  test("localizes repository package presentation without rewriting authored metadata", () => {
    expect(exercisePackageNameLabel("Pelvic Injury Reference Package")).toBe("Vaagnavigastuse näidispakett");
    expect(exercisePackageTagLabel("clinical-module")).toBe("kliiniline moodul");
    expect(exerciseProfileLabel("EMERGENCY_DEPARTMENT")).toBe("Erakorraline meditsiin");
    expect(exercisePackageNameLabel("Hospital authored package")).toBe("Hospital authored package");
    expect(exercisePackageTagLabel("hospital-authored-tag")).toBe("hospital-authored-tag");
  });

  test("localizes instructor filters without changing their canonical values", () => {
    const canonical = ["All", "Expectant", "Completed", "Critical", "Stable"];
    expect(instructorFilterOptionLabel("location", canonical[0])).toBe("Kõik");
    expect(instructorFilterOptionLabel("triage", canonical[1])).toBe("Perspektiivitu");
    expect(instructorFilterOptionLabel("status", canonical[2])).toBe("Lõpetatud");
    expect(instructorFilterOptionLabel("status", canonical[3])).toBe("Kriitiline");
    expect(instructorFilterOptionLabel("status", canonical[4])).toBe("Stabiilne");
    expect(canonical).toEqual(["All", "Expectant", "Completed", "Critical", "Stable"]);
  });

  test("preserves authored and unknown filter values", () => {
    expect(instructorFilterOptionLabel("location", "EMO")).toBe("EMO");
    expect(instructorFilterOptionLabel("caseManager", "Jaak")).toBe("Jaak");
  });

  test("key production navigation no longer exposes common English labels", () => {
    const root = process.cwd();
    const files = ["src/app/index.tsx", "src/app/dashboard.tsx", "src/app/excon/index.tsx", "src/app/excon/dashboard.tsx", "src/app/scan.tsx", "src/app/location.tsx"];
    const source = files.map(file => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
    expect(source).not.toMatch(/>\s*(Login|Scan Patient|Scan Location|Back|History|Exercise Dashboard|Open Exercise Dashboard)\s*</u);
    expect(source).toMatch(/Logi sisse|Skaneeri patsient|Õppuse töölaud/u);
  });
});
