import type { ImagingStudy } from "@/models/ImagingStudy";
import type { LabResult } from "@/models/LabResult";
import type { Note } from "@/models/Note";
import type { Order } from "@/models/Order";
import type { Question } from "@/models/Question";
import type { ScenarioEvent } from "@/models/ScenarioEvent";
import type { TimelineEvent } from "@/models/TimelineEvent";
import type { Intervention } from "@/models/Intervention";

export interface ClinicalDataProvider {
  getQuestions(): Question[];
  getLabs(): LabResult[];
  getImagingStudies(): ImagingStudy[];
  getOrders(): Order[];
  getNotes(): Note[];
  getScenarioEvents(): ScenarioEvent[];
  getTimelineEvents(): TimelineEvent[];
  getInterventions(): Intervention[];
  resetQuestions(): void;
  resetLabs(): void;
  resetImagingStudies(): void;
  resetOrders(): void;
  resetNotes(): void;
  resetScenarioEvents(): void;
  resetTimelineEvents(): void;
  resetInterventions(): void;
}
