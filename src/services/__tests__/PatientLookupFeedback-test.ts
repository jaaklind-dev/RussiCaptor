import { getPatientNotFoundMessage } from "@/services/PatientLookupFeedback";

describe("patient lookup feedback", () => {
  test("shows the searched code and installed workbook", () => {
    expect(
      getPatientNotFoundMessage(
        " 37203140017 ",
        "Mimino_Botulism_12_Patients.xlsx"
      )
    ).toBe(
      [
        "Otsitud kood: 37203140017",
        "Aktiivne andmeallikas: Mimino_Botulism_12_Patients.xlsx",
        "",
        "Kui Exceli andmeid muudeti, impordi töövihik EXCON-vaates uuesti.",
      ].join("\n")
    );
  });

  test("names the built-in data when no workbook is installed", () => {
    expect(getPatientNotFoundMessage("P99")).toContain(
      "Aktiivne andmeallikas: Sisseehitatud demoandmed"
    );
  });
});
