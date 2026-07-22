import {
  mapWorkbookData,
  type WorkbookData,
  type WorkbookRow,
  type WorkbookRows,
  type WorkbookValidationError,
} from "@/providers/excel/WorkbookDataMapper";

export const workbookSheetNames = [
  "Patients",
  "Locations",
  "InterventionOptions",
  "Interventions",
  "MedicationOptions",
  "MedicationAdministrations",
  "Vitals",
  "Questions",
  "Labs",
  "Imaging",
  "Notes",
  "Orders",
] as const satisfies readonly (keyof WorkbookRows)[];

export type WorkbookSheetInput = {
  sheet: string;
  data: unknown[][];
};

export type WorkbookFileError = {
  sheet: string;
  row: number;
  column: string;
  message: string;
};

export type WorkbookFileResult =
  | { ok: true; data: WorkbookData }
  | { ok: false; errors: WorkbookFileError[] };

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

function mapSheetRows(
  sheetName: keyof WorkbookRows,
  data: unknown[][]
): { rows: WorkbookRow[]; errors: WorkbookFileError[] } {
  const headerRow = data[0] ?? [];
  const headers = headerRow.map((value) =>
    typeof value === "string" ? value.trim() : ""
  );
  const errors: WorkbookFileError[] = [];

  if (headers.length === 0 || headers.every((header) => header === "")) {
    return {
      rows: [],
      errors: [{
        sheet: sheetName,
        row: 1,
        column: "",
        message: "Veerupäised puuduvad.",
      }],
    };
  }

  const duplicateHeaders = headers.filter(
    (header, index) => header && headers.indexOf(header) !== index
  );

  duplicateHeaders.forEach((header) => {
    errors.push({
      sheet: sheetName,
      row: 1,
      column: header,
      message: `Veerupäis on korduv: ${header}.`,
    });
  });

  const rows = data.slice(1).flatMap((values) => {
    if (values.every(isBlank)) {
      return [];
    }

    const row: WorkbookRow = {};
    headers.forEach((header, index) => {
      if (header) {
        row[header] = values[index] ?? null;
      }
    });
    return [row];
  });

  return { rows, errors };
}

function convertValidationError(
  error: WorkbookValidationError
): WorkbookFileError {
  return error;
}

export function parseWorkbookSheets(
  sheets: WorkbookSheetInput[]
): WorkbookFileResult {
  const errors: WorkbookFileError[] = [];
  const workbookRows = {} as WorkbookRows;

  workbookSheetNames.forEach((sheetName) => {
    const matches = sheets.filter((sheet) => sheet.sheet === sheetName);

    if (matches.length === 0) {
      errors.push({
        sheet: sheetName,
        row: 1,
        column: "",
        message: "Kohustuslik leht puudub.",
      });
      workbookRows[sheetName] = [];
      return;
    }

    if (matches.length > 1) {
      errors.push({
        sheet: sheetName,
        row: 1,
        column: "",
        message: "Sama nimega leht esineb mitu korda.",
      });
    }

    const mapped = mapSheetRows(sheetName, matches[0].data);
    workbookRows[sheetName] = mapped.rows;
    errors.push(...mapped.errors);
  });

  if (workbookRows.Patients.length === 0) {
    errors.push({
      sheet: "Patients",
      row: 2,
      column: "PatientId",
      message: "Töövihikus peab olema vähemalt üks patsient.",
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const mapped = mapWorkbookData(workbookRows);
  return mapped.ok
    ? { ok: true, data: mapped.data }
    : { ok: false, errors: mapped.errors.map(convertValidationError) };
}
