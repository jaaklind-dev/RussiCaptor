import type { ImagingStudy } from "@/models/ImagingStudy";
import type { LabResult } from "@/models/LabResult";
import type { Note } from "@/models/Note";
import type { Order } from "@/models/Order";
import type { Question } from "@/models/Question";
import type { ScenarioEvent } from "@/models/ScenarioEvent";
import type { TimelineEvent } from "@/models/TimelineEvent";
import type { Intervention, InterventionOption } from "@/models/Intervention";
import type {
  MedicationAdministration,
  MedicationOption,
} from "@/models/Medication";
import type { VitalSigns } from "@/models/VitalSigns";

export interface ClinicalDataProvider {
  getQuestions(): Question[];
  getLabs(): LabResult[];
  getImagingStudies(): ImagingStudy[];
  getOrders(): Order[];
  getNotes(): Note[];
  getScenarioEvents(): ScenarioEvent[];
  getTimelineEvents(): TimelineEvent[];
  getInterventions(): Intervention[];
  getInterventionOptions(): InterventionOption[];
  getMedicationOptions(): MedicationOption[];
  getMedicationAdministrations(): MedicationAdministration[];
  getVitalSigns(): VitalSigns[];
  resetQuestions(): void;
  resetLabs(): void;
  resetImagingStudies(): void;
  resetOrders(): void;
  resetNotes(): void;
  resetScenarioEvents(): void;
  resetTimelineEvents(): void;
  resetInterventions(): void;
  resetMedicationAdministrations(): void;
  resetVitalSigns(): void;
  installData(data: {
    questions: Question[];
    labs: LabResult[];
    imagingStudies: ImagingStudy[];
    orders: Order[];
    notes: Note[];
    interventions: Intervention[];
    interventionOptions: InterventionOption[];
    medicationOptions: MedicationOption[];
    medicationAdministrations: MedicationAdministration[];
    vitalSigns: VitalSigns[];
  }): void;
}
