import {
  parseWorkbookSheets,
  workbookSheetNames,
  type WorkbookSheetInput,
} from "@/providers/excel/WorkbookFileParser";

function createWorkbookSheets(): WorkbookSheetInput[] {
  const sheets: WorkbookSheetInput[] = workbookSheetNames.map((sheet) => ({
    sheet,
    data: [[]],
  }));
  const replace = (sheet: string, data: unknown[][]) => {
    const target = sheets.find((item) => item.sheet === sheet)!;
    target.data = data;
  };

  replace("Patients", [[
    "ExerciseId", "PatientId", "NationalId", "Name", "Triage", "Status",
    "Location", "LastSeen", "MistMechanism", "MistInjuries", "MistSigns",
    "MistTreatment",
  ], [
    "demo", "PT-001", "38701032343", "Jüri Kask", "P2", "Active",
    "EMO", "09:22", "Haigestus", "Nõrkus", "GCS 15", "Ravi puudub",
  ]]);
  replace("Locations", [[
    "ExerciseId", "LocationId", "Code", "Name", "Building", "Floor", "Visibility",
  ], ["demo", "LOC-001", "LOC-EMO", "EMO", "Haigla", "1", "available"]]);
  replace("InterventionOptions", [[
    "ExerciseId", "PatientId", "OptionId", "Type", "Label", "Visibility",
  ]]);
  replace("Interventions", [[
    "ExerciseId", "PatientId", "InterventionId", "Type", "Label", "Status",
    "PerformedBy", "PerformedAt",
  ]]);
  replace("MedicationOptions", [[
    "ExerciseId", "PatientId", "OptionId", "Name", "Dose", "Route", "Visibility",
  ]]);
  replace("MedicationAdministrations", [[
    "ExerciseId", "PatientId", "AdministrationId", "MedicationOptionId", "Name",
    "Dose", "Route", "AdministeredBy", "AdministeredAt",
  ]]);
  replace("Questions", [[
    "ExerciseId", "PatientId", "QuestionId", "Category", "Order", "Prompt",
    "Answer", "Visibility",
  ]]);
  replace("Labs", [[
    "ExerciseId", "PatientId", "LabId", "Panel", "Name", "Value", "Unit",
    "ReferenceRange", "Status", "Visibility", "ReleasedAt",
  ]]);
  replace("Imaging", [[
    "ExerciseId", "PatientId", "ImagingId", "Modality", "Title", "Report",
    "Attachment", "Status", "ImageVisibility", "ReportVisibility",
  ]]);
  replace("Notes", [[
    "ExerciseId", "PatientId", "NoteId", "Author", "Text", "CreatedAt",
  ]]);
  replace("Orders", [[
    "ExerciseId", "PatientId", "OrderId", "Type", "Name", "Status",
    "ResultAction", "ResultTargetId", "DelayMinutes", "ResultTitle",
    "ResultDescription", "RequestedBy", "CreatedAt", "CompletedAt",
  ]]);
  return sheets;
}

describe("Excel workbook file parsing", () => {
  test("maps a workbook and ignores completely blank rows", () => {
    const sheets = createWorkbookSheets();
    sheets.find((sheet) => sheet.sheet === "Patients")!.data.push(
      new Array(12).fill(null)
    );

    const result = parseWorkbookSheets(sheets);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.patients).toHaveLength(1);
    expect(result.data.patients[0].isikukood).toBe("38701032343");
  });

  test("reports missing sheets and duplicate headers", () => {
    const sheets = createWorkbookSheets().filter(
      (sheet) => sheet.sheet !== "Locations"
    );
    sheets.find((sheet) => sheet.sheet === "Patients")!.data[0][1] = "ExerciseId";

    const result = parseWorkbookSheets(sheets);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ sheet: "Locations", message: "Kohustuslik leht puudub." }),
      expect.objectContaining({ sheet: "Patients", row: 1, column: "ExerciseId" }),
    ]));
  });

  test("requires at least one patient", () => {
    const sheets = createWorkbookSheets();
    sheets.find((sheet) => sheet.sheet === "Patients")!.data.splice(1);

    const result = parseWorkbookSheets(sheets);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ sheet: "Patients", column: "PatientId" }),
    ]));
  });
});
