import { imagingStudies } from "@/data/imaging";
import { labs } from "@/data/labs";
import { notes } from "@/data/notes";
import { orders } from "@/data/orders";
import { questions } from "@/data/questions";
import { scenarioEvents } from "@/data/scenarioEvents";
import type { TimelineEvent } from "@/models/TimelineEvent";
import type { ClinicalDataProvider } from "@/providers/ClinicalDataProvider";
import { interventions } from "@/data/interventions";
import { interventionOptions } from "@/data/interventionOptions";
import {
  medicationAdministrations,
  medicationOptions,
} from "@/data/medications";

const timelineEvents: TimelineEvent[] = [];

export class DemoClinicalDataProvider implements ClinicalDataProvider {
  private readonly initialQuestions = questions.map((question) => ({ ...question }));
  private readonly initialLabs = labs.map((lab) => ({ ...lab }));
  private readonly initialImagingStudies = imagingStudies.map((study) => ({ ...study }));
  private readonly initialOrders = orders.map((order) => ({
    ...order,
    workflow: { ...order.workflow },
  }));

  getQuestions() {
    return questions;
  }

  getLabs() {
    return labs;
  }

  getImagingStudies() {
    return imagingStudies;
  }

  getOrders() {
    return orders;
  }

  getNotes() {
    return notes;
  }

  getScenarioEvents() {
    return scenarioEvents;
  }

  getTimelineEvents() {
    return timelineEvents;
  }

  getInterventions() {
    return interventions;
  }

  getInterventionOptions() {
    return interventionOptions;
  }

  getMedicationOptions() {
    return medicationOptions;
  }

  getMedicationAdministrations() {
    return medicationAdministrations;
  }

  resetQuestions(): void {
    questions.splice(
      0,
      questions.length,
      ...this.initialQuestions.map((question) => ({ ...question }))
    );
  }

  resetLabs(): void {
    labs.splice(
      0,
      labs.length,
      ...this.initialLabs.map((lab) => ({ ...lab }))
    );
  }

  resetImagingStudies(): void {
    imagingStudies.splice(
      0,
      imagingStudies.length,
      ...this.initialImagingStudies.map((study) => ({ ...study }))
    );
  }

  resetOrders(): void {
    orders.splice(
      0,
      orders.length,
      ...this.initialOrders.map((order) => ({
        ...order,
        workflow: { ...order.workflow },
      }))
    );
  }

  resetNotes(): void {
    notes.splice(0, notes.length);
  }

  resetScenarioEvents(): void {
    scenarioEvents.splice(0, scenarioEvents.length);
  }

  resetTimelineEvents(): void {
    timelineEvents.splice(0, timelineEvents.length);
  }

  resetInterventions(): void {
    interventions.splice(0, interventions.length);
  }

  resetMedicationAdministrations(): void {
    medicationAdministrations.splice(0, medicationAdministrations.length);
  }
}
