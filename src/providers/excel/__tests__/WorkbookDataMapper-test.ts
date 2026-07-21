import {
  mapWorkbookData,
  type WorkbookRows,
} from "@/providers/excel/WorkbookDataMapper";

function createWorkbookRows(): WorkbookRows {
  return {
    Patients: [{
      ExerciseId: "demo",
      PatientId: "PT-001",
      NationalId: "38701032343",
      Name: "Jüri Kask",
      Triage: "P2",
      Status: "Active",
      Location: "EMO",
      LastSeen: "09:22",
      MistMechanism: "Haigestus kodus",
      MistInjuries: "Nõrkus",
      MistSigns: "GCS 15",
      MistTreatment: "Ravi puudub",
    }],
    Interventions: [{
      ExerciseId: "demo",
      PatientId: "PT-001",
      InterventionId: "INT-001",
      Type: "airway",
      Label: "Hingamistee tagamine",
      Status: "completed",
      PerformedBy: "Jaak",
      PerformedAt: "2026-07-21T10:00:00.000Z",
    }],
    Questions: [{
      ExerciseId: "demo",
      PatientId: "PT-001",
      QuestionId: "Q-001",
      Category: "Toitumine",
      Order: "1",
      Prompt: "Kas patsient sõi?",
      Answer: "Jah",
      Visibility: "hidden",
    }],
    Labs: [{
      ExerciseId: "demo",
      PatientId: "PT-001",
      LabId: "LAB-001",
      Panel: "ABG",
      Name: "pH",
      Value: "7.36",
      Unit: "",
      ReferenceRange: "7.35–7.45",
      Status: "processing",
      Visibility: "hidden",
    }],
    Imaging: [{
      ExerciseId: "demo",
      PatientId: "PT-001",
      ImagingId: "IMG-001",
      Modality: "CT",
      Title: "KT pea",
      Report: "Leid puudub",
      Status: "processing",
      ImageVisibility: "hidden",
      ReportVisibility: "hidden",
    }],
    Notes: [{
      ExerciseId: "demo",
      PatientId: "PT-001",
      NoteId: "NOTE-001",
      Author: "EXCON",
      Text: "Kontrollmärge",
      CreatedAt: "2026-07-21T10:00:00.000Z",
    }],
    Orders: [{
      ExerciseId: "demo",
      PatientId: "PT-001",
      OrderId: "ORD-001",
      Type: "lab",
      Name: "Veregaasid",
      Status: "available",
      ResultAction: "lab.available",
      ResultTargetId: "ABG",
      DelayMinutes: "2",
      ResultTitle: "Veregaasid valmis",
      ResultDescription: "Tulemused on saadaval.",
    }],
  };
}

describe("Excel workbook data mapping", () => {
  test("maps valid workbook rows into domain records", () => {
    const result = mapWorkbookData(createWorkbookRows());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.patients[0]).toEqual(
      expect.objectContaining({ id: "PT-001", triage: "P2", status: "Active" })
    );
    expect(result.data.imagingStudies[0]).toEqual(
      expect.objectContaining({
        imageVisibility: "hidden",
        reportVisibility: "hidden",
      })
    );
    expect(result.data.interventions[0]).toEqual(
      expect.objectContaining({
        id: "INT-001",
        type: "airway",
        performedBy: "Jaak",
      })
    );
    expect(result.data.orders[0].workflow).toEqual(
      expect.objectContaining({ delayMinutes: 2, resultAction: "lab.available" })
    );
  });

  test("rejects the workbook instead of returning partial invalid data", () => {
    const rows = createWorkbookRows();
    rows.Patients[0].Triage = "P9";
    rows.Orders[0].DelayMinutes = "later";

    const result = mapWorkbookData(rows);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sheet: "Patients", row: 2, column: "Triage" }),
        expect.objectContaining({ sheet: "Orders", row: 2, column: "DelayMinutes" }),
      ])
    );
  });

  test("rejects broken workbook relationships and duplicate identifiers", () => {
    const rows = createWorkbookRows();
    rows.Labs.push({ ...rows.Labs[0] });
    rows.Questions[0].PatientId = "PT-UNKNOWN";
    rows.Orders[0].ResultTargetId = "MISSING-PANEL";
    rows.Notes[0].ExerciseId = "another-exercise";

    const result = mapWorkbookData(rows);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sheet: "Labs", row: 3, column: "LabId" }),
        expect.objectContaining({
          sheet: "Questions",
          column: "PatientId",
          message: "Unknown patient: PT-UNKNOWN.",
        }),
        expect.objectContaining({ sheet: "Orders", column: "ResultTargetId" }),
        expect.objectContaining({ sheet: "Notes", column: "ExerciseId" }),
      ])
    );
  });
});
