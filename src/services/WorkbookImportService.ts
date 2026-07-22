import { File } from "expo-file-system";
import { readSheet } from "read-excel-file/universal";

import type { WorkbookData } from "@/providers/excel/WorkbookDataMapper";
import {
  parseWorkbookSheets,
  workbookSheetNames,
  type WorkbookFileError,
  type WorkbookFileResult,
} from "@/providers/excel/WorkbookFileParser";
import { clinicalDataProvider, dataProvider } from "@/providers/ProviderFactory";
import { installCurrentExercise } from "@/repositories/ExerciseRepository";
import { restoreExerciseSession } from "@/repositories/ExerciseSessionRepository";
import { installLocationZones } from "@/repositories/LocationRepository";
import { clearTimelineEvents } from "@/repositories/TimelineRepository";
import { clearAssignments } from "@/services/AssignmentRepository";
import { stopClockRunner } from "@/services/ClockRunner";
import { resetCaseManagerLocations } from "@/services/CurrentLocationService";
import { resetCurrentCaseManager } from "@/services/CurrentUserService";
import { notifySync } from "@/services/SyncService";

export type InstalledWorkbook = {
  fileName: string;
  data: WorkbookData;
};

let installedWorkbook: InstalledWorkbook | undefined;

function cloneWorkbookData(data: WorkbookData): WorkbookData {
  return JSON.parse(JSON.stringify(data)) as WorkbookData;
}

function exerciseNameFromFile(fileName: string): string {
  return fileName.replace(/\.xlsx$/i, "").replace(/[_-]+/g, " ").trim();
}

function applyWorkbookBaseline(data: WorkbookData, fileName: string): void {
  dataProvider.installPatients(data.patients);
  clinicalDataProvider.installData(data);
  installLocationZones(data.locations);
  installCurrentExercise(
    data.exerciseId,
    exerciseNameFromFile(fileName) || data.exerciseId
  );
  installedWorkbook = {
    fileName,
    data: cloneWorkbookData(data),
  };
}

export function installWorkbook(data: WorkbookData, fileName: string): void {
  stopClockRunner();
  applyWorkbookBaseline(data, fileName);
  restoreExerciseSession({
    exerciseId: data.exerciseId,
    state: "stopped",
    currentMinute: 0,
    speed: 1,
  });
  clearAssignments();
  clearTimelineEvents();
  resetCaseManagerLocations();
  resetCurrentCaseManager();
  notifySync();
}

export function restoreInstalledWorkbook(
  workbook: InstalledWorkbook | undefined
): void {
  if (!workbook) return;
  applyWorkbookBaseline(workbook.data, workbook.fileName);
}

export function getInstalledWorkbook(): InstalledWorkbook | undefined {
  if (!installedWorkbook) return undefined;
  return {
    fileName: installedWorkbook.fileName,
    data: cloneWorkbookData(installedWorkbook.data),
  };
}

export async function readWorkbookFile(
  uri: string
): Promise<WorkbookFileResult> {
  try {
    const buffer = await new File(uri).arrayBuffer();
    const sheets = await Promise.all(
      workbookSheetNames.map(async (sheetName) => {
        try {
          return {
            sheet: sheetName,
            data: await readSheet(buffer, sheetName, { trim: false }) as unknown[][],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (/sheet .* not found|no sheet/i.test(message)) {
            return undefined;
          }
          throw new Error(`${sheetName}: ${message || "lugemine ebaõnnestus"}`);
        }
      })
    );
    return parseWorkbookSheets(sheets.filter((sheet) => sheet !== undefined));
  } catch (error) {
    console.warn("Excel workbook could not be read.", error);
    const message = error instanceof Error ? error.message : "Tundmatu viga.";
    return {
      ok: false,
      errors: [{
        sheet: "Workbook",
        row: 0,
        column: "",
        message: `Faili ei saanud lugeda: ${message}`,
      }],
    };
  }
}

export function formatWorkbookErrors(errors: WorkbookFileError[]): string {
  const visible = errors.slice(0, 6).map((error) => {
    const location = [
      error.sheet,
      error.row > 0 ? `rida ${error.row}` : "",
      error.column,
    ].filter(Boolean).join(" · ");
    return `${location}: ${error.message}`;
  });

  if (errors.length > visible.length) {
    visible.push(`… ja veel ${errors.length - visible.length} viga.`);
  }

  return visible.join("\n");
}
