import type { ImagingModality, ImagingStatus, ImagingStudy } from "@/models/ImagingStudy";
import type { LabResult, LabStatus } from "@/models/LabResult";
import type { Note } from "@/models/Note";
import type { Order, OrderCategory, OrderStatus } from "@/models/Order";
import type { Patient, PatientStatus, TriageCategory } from "@/models/Patient";
import type { Question } from "@/models/Question";
import type { Visibility } from "@/models/Visibility";

export type WorkbookRow = Record<string, unknown>;

export type WorkbookRows = {
  Patients: WorkbookRow[];
  Questions: WorkbookRow[];
  Labs: WorkbookRow[];
  Imaging: WorkbookRow[];
  Notes: WorkbookRow[];
  Orders: WorkbookRow[];
};

export type WorkbookData = {
  patients: Patient[];
  questions: Question[];
  labs: LabResult[];
  imagingStudies: ImagingStudy[];
  notes: Note[];
  orders: Order[];
};

export type WorkbookValidationError = {
  sheet: keyof WorkbookRows;
  row: number;
  column: string;
  message: string;
};

export type WorkbookMappingResult =
  | { ok: true; data: WorkbookData; errors: [] }
  | { ok: false; errors: WorkbookValidationError[] };

const triageValues: TriageCategory[] = ["P1", "P2", "P3", "P4"];
const patientStatusValues: PatientStatus[] = [
  "Active",
  "Incoming",
  "Transferred",
  "Completed",
];
const visibilityValues: Visibility[] = ["hidden", "available", "revealed"];
const labStatusValues: LabStatus[] = ["processing", "available", "viewed"];
const imagingStatusValues: ImagingStatus[] = ["processing", "available", "viewed"];
const imagingModalityValues: ImagingModality[] = ["XR", "CT", "US", "ECG", "OTHER"];
const orderCategoryValues: OrderCategory[] = [
  "lab",
  "imaging",
  "medication",
  "consultation",
  "blood",
];
const orderStatusValues: OrderStatus[] = [
  "available",
  "ordered",
  "processing",
  "completed",
];
const resultActionValues = ["lab.available", "imaging.available"] as const;

type MappingContext = {
  sheet: keyof WorkbookRows;
  row: number;
  errors: WorkbookValidationError[];
};

function addError(context: MappingContext, column: string, message: string): void {
  context.errors.push({ ...context, column, message });
}

function requiredString(
  row: WorkbookRow,
  column: string,
  context: MappingContext
): string | undefined {
  const value = row[column];

  if (typeof value !== "string" || value.trim() === "") {
    addError(context, column, "Required text value is missing.");
    return undefined;
  }

  return value.trim();
}

function optionalString(row: WorkbookRow, column: string): string | undefined {
  const value = row[column];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function enumValue<T extends string>(
  row: WorkbookRow,
  column: string,
  allowed: readonly T[],
  context: MappingContext
): T | undefined {
  const value = requiredString(row, column, context);

  if (value && allowed.includes(value as T)) {
    return value as T;
  }

  if (value) {
    addError(context, column, `Expected one of: ${allowed.join(", ")}.`);
  }

  return undefined;
}

function nonNegativeNumber(
  row: WorkbookRow,
  column: string,
  context: MappingContext
): number | undefined {
  const rawValue = row[column];
  const value = typeof rawValue === "number" ? rawValue : Number(rawValue);

  if (!Number.isFinite(value) || value < 0) {
    addError(context, column, "Expected a non-negative number.");
    return undefined;
  }

  return value;
}

function mapRows<T>(
  sheet: keyof WorkbookRows,
  rows: WorkbookRow[],
  errors: WorkbookValidationError[],
  mapper: (row: WorkbookRow, context: MappingContext) => T | undefined
): T[] {
  return rows.flatMap((row, index) => {
    const mapped = mapper(row, { sheet, row: index + 2, errors });
    return mapped ? [mapped] : [];
  });
}

function allDefined(values: unknown[]): boolean {
  return values.every((value) => value !== undefined);
}

export function mapWorkbookData(rows: WorkbookRows): WorkbookMappingResult {
  const errors: WorkbookValidationError[] = [];

  const patients = mapRows("Patients", rows.Patients, errors, (row, context) => {
    const id = requiredString(row, "PatientId", context);
    const isikukood = requiredString(row, "NationalId", context);
    const name = requiredString(row, "Name", context);
    const triage = enumValue(row, "Triage", triageValues, context);
    const status = enumValue(row, "Status", patientStatusValues, context);
    const location = requiredString(row, "Location", context);
    const lastSeen = requiredString(row, "LastSeen", context);
    const mechanism = requiredString(row, "MistMechanism", context);
    const injuries = requiredString(row, "MistInjuries", context);
    const signs = requiredString(row, "MistSigns", context);
    const treatment = requiredString(row, "MistTreatment", context);

    if (!allDefined([id, isikukood, name, triage, status, location, lastSeen, mechanism, injuries, signs, treatment])) return undefined;
    return { id: id!, isikukood: isikukood!, name: name!, triage: triage!, status: status!, location: location!, lastSeen: lastSeen!, mist: { mechanism: mechanism!, injuries: injuries!, signs: signs!, treatment: treatment! } };
  });

  const questions = mapRows("Questions", rows.Questions, errors, (row, context) => {
    const exerciseId = requiredString(row, "ExerciseId", context);
    const patientId = requiredString(row, "PatientId", context);
    const id = requiredString(row, "QuestionId", context);
    const category = requiredString(row, "Category", context);
    const order = nonNegativeNumber(row, "Order", context);
    const prompt = requiredString(row, "Prompt", context);
    const answer = requiredString(row, "Answer", context);
    const visibility = enumValue(row, "Visibility", visibilityValues, context);

    if (!allDefined([exerciseId, patientId, id, category, order, prompt, answer, visibility])) return undefined;
    return { exerciseId: exerciseId!, patientId: patientId!, id: id!, category: category!, order: order!, prompt: prompt!, answer: answer!, visibility: visibility! };
  });

  const labs = mapRows("Labs", rows.Labs, errors, (row, context) => {
    const exerciseId = requiredString(row, "ExerciseId", context);
    const patientId = requiredString(row, "PatientId", context);
    const id = requiredString(row, "LabId", context);
    const panel = requiredString(row, "Panel", context);
    const name = requiredString(row, "Name", context);
    const value = requiredString(row, "Value", context);
    const unit = typeof row.Unit === "string" ? row.Unit.trim() : "";
    const referenceRange = requiredString(row, "ReferenceRange", context);
    const status = enumValue(row, "Status", labStatusValues, context);
    const visibility = enumValue(row, "Visibility", visibilityValues, context);

    if (!allDefined([exerciseId, patientId, id, panel, name, value, referenceRange, status, visibility])) return undefined;
    return { exerciseId: exerciseId!, patientId: patientId!, id: id!, panel: panel!, name: name!, value: value!, unit, referenceRange: referenceRange!, status: status!, visibility: visibility!, releasedAt: optionalString(row, "ReleasedAt") };
  });

  const imagingStudies = mapRows("Imaging", rows.Imaging, errors, (row, context) => {
    const exerciseId = requiredString(row, "ExerciseId", context);
    const patientId = requiredString(row, "PatientId", context);
    const id = requiredString(row, "ImagingId", context);
    const modality = enumValue(row, "Modality", imagingModalityValues, context);
    const title = requiredString(row, "Title", context);
    const report = requiredString(row, "Report", context);
    const status = enumValue(row, "Status", imagingStatusValues, context);
    const imageVisibility = enumValue(row, "ImageVisibility", visibilityValues, context);
    const reportVisibility = enumValue(row, "ReportVisibility", visibilityValues, context);

    if (!allDefined([exerciseId, patientId, id, modality, title, report, status, imageVisibility, reportVisibility])) return undefined;
    return { exerciseId: exerciseId!, patientId: patientId!, id: id!, modality: modality!, title: title!, report: report!, status: status!, imageVisibility: imageVisibility!, reportVisibility: reportVisibility!, attachment: optionalString(row, "Attachment") };
  });

  const notes = mapRows("Notes", rows.Notes, errors, (row, context) => {
    const exerciseId = requiredString(row, "ExerciseId", context);
    const patientId = requiredString(row, "PatientId", context);
    const id = requiredString(row, "NoteId", context);
    const author = requiredString(row, "Author", context);
    const text = requiredString(row, "Text", context);
    const createdAt = requiredString(row, "CreatedAt", context);

    if (!allDefined([exerciseId, patientId, id, author, text, createdAt])) return undefined;
    return { exerciseId: exerciseId!, patientId: patientId!, id: id!, author: author!, text: text!, createdAt: createdAt! };
  });

  const orders = mapRows<Order>("Orders", rows.Orders, errors, (row, context) => {
    const exerciseId = requiredString(row, "ExerciseId", context);
    const patientId = requiredString(row, "PatientId", context);
    const id = requiredString(row, "OrderId", context);
    const category = enumValue(row, "Type", orderCategoryValues, context);
    const title = requiredString(row, "Name", context);
    const status = enumValue(row, "Status", orderStatusValues, context);
    const resultAction = enumValue(row, "ResultAction", resultActionValues, context);
    const resultTargetId = requiredString(row, "ResultTargetId", context);
    const delayMinutes = nonNegativeNumber(row, "DelayMinutes", context);
    const resultTitle = requiredString(row, "ResultTitle", context);
    const resultDescription = requiredString(row, "ResultDescription", context);

    if (!allDefined([exerciseId, patientId, id, category, title, status, resultAction, resultTargetId, delayMinutes, resultTitle, resultDescription])) return undefined;
    return { exerciseId: exerciseId!, patientId: patientId!, id: id!, category: category!, title: title!, status: status!, visibility: "revealed", workflow: { resultAction: resultAction!, resultTargetId: resultTargetId!, delayMinutes: delayMinutes!, resultTitle: resultTitle!, resultDescription: resultDescription! }, createdAt: optionalString(row, "CreatedAt"), completedAt: optionalString(row, "CompletedAt") };
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, data: { patients, questions, labs, imagingStudies, notes, orders }, errors: [] };
}
