import type { ImagingStudy } from "@/models/ImagingStudy";
import type { LabResult } from "@/models/LabResult";
import type { Note } from "@/models/Note";
import type { Order } from "@/models/Order";
import type { Question } from "@/models/Question";
import type { ScenarioEvent } from "@/models/ScenarioEvent";
import type { TimelineEvent } from "@/models/TimelineEvent";

export interface ClinicalDataProvider {
  getQuestions(): Question[];
  getLabs(): LabResult[];
  getImagingStudies(): ImagingStudy[];
  getOrders(): Order[];
  getNotes(): Note[];
  getScenarioEvents(): ScenarioEvent[];
  getTimelineEvents(): TimelineEvent[];
  resetQuestions(): void;
  resetLabs(): void;
  resetImagingStudies(): void;
  resetOrders(): void;
  resetNotes(): void;
  resetScenarioEvents(): void;
  resetTimelineEvents(): void;
}
