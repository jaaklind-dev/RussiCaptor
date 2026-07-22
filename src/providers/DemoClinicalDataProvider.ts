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
import { vitalSigns } from "@/data/vitalSigns";

const timelineEvents: TimelineEvent[] = [];

export class DemoClinicalDataProvider implements ClinicalDataProvider {
  private initialQuestions = questions.map((question) => ({ ...question }));
  private initialLabs = labs.map((lab) => ({ ...lab }));
  private initialImagingStudies = imagingStudies.map((study) => ({ ...study }));
  private initialOrders = orders.map((order) => ({
    ...order,
    workflow: { ...order.workflow },
  }));
  private initialNotes = notes.map((note) => ({ ...note }));
  private initialInterventions = interventions.map((item) => ({ ...item }));
  private initialMedicationAdministrations = medicationAdministrations.map(
    (item) => ({ ...item })
  );
  private initialVitalSigns = vitalSigns.map((item) => ({ ...item }));

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

  getVitalSigns() {
    return vitalSigns;
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
    notes.splice(
      0,
      notes.length,
      ...this.initialNotes.map((note) => ({ ...note }))
    );
  }

  resetScenarioEvents(): void {
    scenarioEvents.splice(0, scenarioEvents.length);
  }

  resetTimelineEvents(): void {
    timelineEvents.splice(0, timelineEvents.length);
  }

  resetInterventions(): void {
    interventions.splice(
      0,
      interventions.length,
      ...this.initialInterventions.map((item) => ({ ...item }))
    );
  }

  resetMedicationAdministrations(): void {
    medicationAdministrations.splice(
      0,
      medicationAdministrations.length,
      ...this.initialMedicationAdministrations.map((item) => ({ ...item }))
    );
  }

  resetVitalSigns(): void {
    vitalSigns.splice(
      0,
      vitalSigns.length,
      ...this.initialVitalSigns.map((item) => ({ ...item }))
    );
  }

  installData(data: {
    questions: typeof questions;
    labs: typeof labs;
    imagingStudies: typeof imagingStudies;
    orders: typeof orders;
    notes: typeof notes;
    interventions: typeof interventions;
    interventionOptions: typeof interventionOptions;
    medicationOptions: typeof medicationOptions;
    medicationAdministrations: typeof medicationAdministrations;
    vitalSigns: typeof vitalSigns;
  }): void {
    this.initialQuestions = data.questions.map((item) => ({ ...item }));
    this.initialLabs = data.labs.map((item) => ({ ...item }));
    this.initialImagingStudies = data.imagingStudies.map((item) => ({ ...item }));
    this.initialOrders = data.orders.map((item) => ({
      ...item,
      workflow: { ...item.workflow },
    }));
    this.initialNotes = data.notes.map((item) => ({ ...item }));
    this.initialInterventions = data.interventions.map((item) => ({ ...item }));
    this.initialMedicationAdministrations = data.medicationAdministrations.map(
      (item) => ({ ...item })
    );
    // Workbooks persisted by older app versions do not contain vitalSigns yet.
    this.initialVitalSigns = (data.vitalSigns ?? []).map((item) => ({ ...item }));

    interventionOptions.splice(
      0,
      interventionOptions.length,
      ...data.interventionOptions.map((item) => ({ ...item }))
    );
    medicationOptions.splice(
      0,
      medicationOptions.length,
      ...data.medicationOptions.map((item) => ({ ...item }))
    );
    this.resetQuestions();
    this.resetLabs();
    this.resetImagingStudies();
    this.resetOrders();
    this.resetNotes();
    this.resetInterventions();
    this.resetMedicationAdministrations();
    this.resetVitalSigns();
    this.resetScenarioEvents();
    this.resetTimelineEvents();
  }
}
